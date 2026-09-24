const { HocuspocusProvider } = require('@hocuspocus/provider');
const Y = require('yjs');
const WebSocket = require('ws');
const { Client } = require('pg');

const TOKEN = process.env.TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc5MDA4MzExMywiZXhwIjoxNzkwMDg0OTEzfQ.6RnGlFwUhO8yDRDSRzy1fmPWNlcPs1U4MZNXtAmQ3lI';
const URL = process.env.URL || 'ws://localhost:8081';
const DB_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/slack_db';
const WORKSPACE_ID = process.env.WORKSPACE_ID || '5f5a6f59-c969-41ec-b5f2-677cb5efa30e';
const DB_PAGE_ID = process.env.DATABASE_PAGE_ID || 'f0daa9ff-f331-4786-81ec-edc1bdc26207';
const API_URL = 'http://127.0.0.1:3000/api/v1';

const TARGET_UPDATES = 10000;

async function start() {
  console.log(`Starting YDoc Leak Test...`);
  // Get a single page ID to abuse
  const res = await fetch(`${API_URL}/workspaces/${WORKSPACE_ID}/notes/pages?parentId=${DB_PAGE_ID}&limit=1`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });
  if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
  const data = await res.json();
  const pageId = data.data[0].id;
  console.log(`Target Page ID: ${pageId}`);

  const doc = new Y.Doc();
  const ytext = doc.getText('default');
  
  // Measure DB before
  const pgClient = new Client({ connectionString: DB_URL });
  await pgClient.connect();
  const dbBefore = await getDbSize(pgClient, pageId);
  console.log(`Initial DB Size: ${dbBefore} bytes`);

  let resolveConnected;
  const connectedPromise = new Promise(r => resolveConnected = r);

  const provider = new HocuspocusProvider({
    url: URL,
    name: pageId,
    document: doc,
    WebSocketPolyfill: WebSocket,
    token: TOKEN,
    onConnect: () => {
      console.log('Connected to Hocuspocus.');
    },
    onSynced: () => {
      console.log('Synced.');
      resolveConnected();
    }
  });

  await connectedPromise;

  console.log(`Simulating ${TARGET_UPDATES} inserts/deletes to create tombstones...`);
  const startTime = Date.now();
  
  // We don't want to block the event loop entirely, yield occasionally
  for (let i = 0; i < TARGET_UPDATES; i++) {
    doc.transact(() => {
      // Insert a random character
      ytext.insert(0, String.fromCharCode(97 + Math.floor(Math.random() * 26)));
      // Delete the previous character to keep text short but history long
      if (ytext.length > 1) {
        ytext.delete(1, 1);
      }
    });

    if (i % 1000 === 0) {
      console.log(`Progress: ${i}/${TARGET_UPDATES}`);
      await new Promise(r => setTimeout(r, 10)); // let provider flush to WS
    }
  }

  const duration = (Date.now() - startTime) / 1000;
  console.log(`Completed in ${duration}s. Waiting 5s for final flush to DB...`);
  
  // Wait for the backend debounce autosave (usually 2-5 seconds)
  await new Promise(r => setTimeout(r, 5000));
  
  const dbAfter = await getDbSize(pgClient, pageId);
  console.log(`\n=== RESULTS ===`);
  console.log(`Target Page ID: ${pageId}`);
  console.log(`Updates: ${TARGET_UPDATES}`);
  console.log(`DB Size Before: ${dbBefore} bytes`);
  console.log(`DB Size After: ${dbAfter} bytes`);
  console.log(`Bloat Growth: ${dbAfter - dbBefore} bytes`);
  console.log(`Bytes per update: ${((dbAfter - dbBefore) / TARGET_UPDATES).toFixed(2)} bytes`);
  
  provider.disconnect();
  await pgClient.end();
  process.exit(0);
}

async function getDbSize(client, pageId) {
  const res = await client.query('SELECT OCTET_LENGTH(data) as size FROM page_documents WHERE page_id = $1', [pageId]);
  if (res.rows.length === 0 || !res.rows[0].size) return 0;
  return parseInt(res.rows[0].size, 10);
}

start().catch(e => {
  console.error(e);
  process.exit(1);
});
