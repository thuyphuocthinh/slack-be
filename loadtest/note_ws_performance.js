const { HocuspocusProvider } = require('@hocuspocus/provider');
const Y = require('yjs');
const WebSocket = require('ws');
const crypto = require('crypto');

// Target config
const CONNECTIONS = parseInt(process.env.CONNECTIONS || '400', 10);
const PAGES = parseInt(process.env.PAGES || '80', 10);
const TOKEN = process.env.TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc5MDA4MzExMywiZXhwIjoxNzkwMDg0OTEzfQ.6RnGlFwUhO8yDRDSRzy1fmPWNlcPs1U4MZNXtAmQ3lI';
const URL = process.env.URL || 'ws://localhost:8081';

const UPDATE_INTERVAL = 500; // ms (2 updates per second)

// Stats
let inboundCount = 0; // messages sent by us
let outboundCount = 0; // messages received by us (fan-out)
let connectedCount = 0;

const WORKSPACE_ID = process.env.WORKSPACE_ID || '5f5a6f59-c969-41ec-b5f2-677cb5efa30e';
const DB_PAGE_ID = process.env.DATABASE_PAGE_ID || 'f0daa9ff-f331-4786-81ec-edc1bdc26207';
const API_URL = 'http://127.0.0.1:3000/api/v1';

async function start() {
  console.log(`Fetching real Page IDs from database...`);
  const res = await fetch(`${API_URL}/workspaces/${WORKSPACE_ID}/notes/pages?parentId=${DB_PAGE_ID}&limit=${PAGES}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
  const data = await res.json();
  const pageIds = data.data.map(p => p.id);
  if (pageIds.length === 0) throw new Error('No pages found');
  
  console.log(`Found ${pageIds.length} pages. Starting WS Load Test: ${CONNECTIONS} connections.`);
  
  const providers = [];
  const docs = [];

for (let i = 0; i < CONNECTIONS; i++) {
  const pageId = pageIds[i % PAGES];
  const doc = new Y.Doc();
  docs.push(doc);

  const provider = new HocuspocusProvider({
    url: URL,
    name: pageId,
    document: doc,
    WebSocketPolyfill: WebSocket,
    token: TOKEN,
    onConnect: () => {
      // connected
    },
    onDisconnect: () => {
      // disconnected
    },
    onAuthenticationFailed: ({ reason }) => {
      console.error('Auth failed:', reason);
    },
    onClose: ({ event }) => {
      if (event.code !== 1000) {
        // console.error('Connection closed:', event.code, event.reason);
      }
    }
  });

  doc.on('update', (update, origin) => {
    // If the origin is the provider, it means it's an inbound message from the server (outbound from server's perspective, fan-out to us)
    if (origin === provider) {
      outboundCount++;
    }
  });

  providers.push(provider);
}

// Start spamming updates
let updateInterval;
setTimeout(() => {
  console.log(`\nAll clients initiated. Waiting for connections to establish...`);
  
  updateInterval = setInterval(() => {
    providers.forEach((provider, idx) => {
      const doc = docs[idx];
      const text = doc.getText('content');
      
      // Trigger update (which sets origin to null or local)
      // This sends a message to the server
      text.insert(0, 'a');
      inboundCount++;
    });
  }, UPDATE_INTERVAL);
}, 2000);

// Report stats
setInterval(() => {
  console.clear();
  const activeConnections = providers.filter(p => p.status === 'connected').length;
  console.log(`=== NOTE SERVICE WS LOAD TEST ===`);
  console.log(`Connections: ${activeConnections} / ${CONNECTIONS}`);
  console.log(`Inbound Rate:  ${inboundCount} msgs/sec (Target: 800)`);
  console.log(`Outbound Rate: ${outboundCount} msgs/sec (Target: 4000)`);
  console.log(`=================================`);
  console.log(`Press Ctrl+C to stop.`);
  
  inboundCount = 0;
  outboundCount = 0;
}, 1000);

process.on('SIGINT', () => {
  clearInterval(updateInterval);
  providers.forEach(p => p.destroy());
  process.exit(0);
});

} // end start()
start().catch(console.error);
