const { HocuspocusProvider } = require('@hocuspocus/provider');
const Y = require('yjs');
const WebSocket = require('ws');

const CONNECTIONS = parseInt(process.env.CONNECTIONS || '1000', 10);
const PAGES = parseInt(process.env.PAGES || '80', 10);
const TOKEN = process.env.TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc5MDA4MzExMywiZXhwIjoxNzkwMDg0OTEzfQ.6RnGlFwUhO8yDRDSRzy1fmPWNlcPs1U4MZNXtAmQ3lI';
const URL = process.env.URL || 'ws://localhost:8081';
const WORKSPACE_ID = process.env.WORKSPACE_ID || '5f5a6f59-c969-41ec-b5f2-677cb5efa30e';
const DB_PAGE_ID = process.env.DATABASE_PAGE_ID || 'f0daa9ff-f331-4786-81ec-edc1bdc26207';
const API_URL = 'http://127.0.0.1:3000/api/v1';

let inboundCount = 0;
let outboundCount = 0;
let connectedCount = 0;

async function start() {
  console.log(`Fetching real Page IDs from database...`);
  const res = await fetch(`${API_URL}/workspaces/${WORKSPACE_ID}/notes/pages?parentId=${DB_PAGE_ID}&limit=${PAGES}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
  const data = await res.json();
  const pageIds = data.data.map(p => p.id);
  if (pageIds.length === 0) throw new Error('No pages found');
  
  console.log(`Found ${pageIds.length} pages. Starting WS Burst Test: ${CONNECTIONS} connections.`);
  
  const providers = [];
  const docs = [];

  let connectionPromise = new Promise(resolve => {
    let synced = 0;
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
        onSynced: () => {
          synced++;
          if (synced === CONNECTIONS) resolve();
        },
        onMessage: () => {
          outboundCount++;
        }
      });

      providers.push(provider);
    }
  });

  console.log('Waiting for all connections to sync initially...');
  await connectionPromise;
  console.log('All connected and synced. Stabilizing for 5s...');
  
  await new Promise(r => setTimeout(r, 5000));
  
  console.log('\n--- SIMULATING MASSIVE NETWORK DROP (DISCONNECT ALL) ---');
  providers.forEach(p => p.disconnect());
  
  console.log('Waiting 3 seconds...');
  await new Promise(r => setTimeout(r, 3000));
  
  console.log('\n--- BURST RECONNECTION (CONNECT ALL AT ONCE) ---');
  let burstStartTime = Date.now();
  
  // reset counters
  inboundCount = 0;
  outboundCount = 0;
  let syncedAgain = 0;
  
  let burstResolve;
  let burstPromise = new Promise(r => burstResolve = r);
  
  providers.forEach(p => {
    p.on('synced', () => {
      syncedAgain++;
      if (syncedAgain === CONNECTIONS) {
         burstResolve();
      }
    });
    p.connect();
  });
  
  const monitorInterval = setInterval(() => {
    console.log(`[Burst Recovery] Synced: ${syncedAgain}/${CONNECTIONS} | Inbound: ${inboundCount}/s | Outbound: ${outboundCount}/s`);
    inboundCount = 0;
    outboundCount = 0;
  }, 1000);

  await burstPromise;
  clearInterval(monitorInterval);

  let duration = Date.now() - burstStartTime;
  console.log(`\n✅ Burst Recovery Completed in ${duration}ms!`);
  console.log(`Received ${outboundCount} sync messages during recovery.`);
  
  providers.forEach(p => p.destroy());
  process.exit(0);
}

start().catch(e => {
  console.error(e);
  process.exit(1);
});
