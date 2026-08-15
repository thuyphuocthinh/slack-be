require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const ROWS = 20;
const MISMATCH_IDX = [3, 8, 14, 19];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (bodyStr) headers['content-length'] = Buffer.byteLength(bodyStr);
    const req = http.request(
      { hostname: 'localhost', port: 3000, path: '/api/v1' + urlPath, method, headers },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sendAiMessage(data, user, text) {
  const body = {
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            ...(data.botUserId ? [{ type: 'mention', attrs: { id: data.botUserId } }] : []),
            { type: 'text', text: ` ${text}` },
          ],
        },
      ],
    },
    mentions: data.botUserId ? [data.botUserId] : undefined,
  };
  return request(
    'POST',
    `/workspaces/${data.workspaceId}/channels/${data.channelId}/messages`,
    body,
    user.token,
  );
}

async function waitForFinalAnswer(data, token, afterIso, maxWaitMs = 90000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(3000);
    const res = await request(
      'GET',
      `/workspaces/${data.workspaceId}/channels/${data.channelId}/messages?limit=10`,
      null,
      token,
    );
    const msgs = res.body?.data?.messages ?? [];
    const botMsgs = msgs
      .filter((m) => m.sender?.isBot && new Date(m.createdAt) > new Date(afterIso))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const finalMsg = botMsgs.find(
      (m) =>
        typeof m.content === 'string' &&
        m.content !== '🤖 Đang xử lý...' &&
        !m.content.startsWith('⏸️ Cần bạn duyệt'),
    );
    if (finalMsg) return finalMsg;
  }
  return null;
}

async function ask(data, user, text, label, maxWaitMs) {
  const t0 = new Date().toISOString();
  console.log(`\n>>> [${label}] "${text.slice(0, 150)}"`);
  const send = await sendAiMessage(data, user, text);
  if (send.status !== 201) {
    console.log(`  send FAILED status=${send.status}`, JSON.stringify(send.body).slice(0, 200));
    return { reply: null, t0 };
  }
  const reply = await waitForFinalAnswer(data, user.token, t0, maxWaitMs);
  console.log('  bot reply:', reply ? String(reply.content).slice(0, 400) : '(timeout)');
  return { reply, t0 };
}

async function approveWhenPending(pg, data, userId, afterIso, label, maxWaitMs = 45000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const r = await pg.query(
      `SELECT id, reply_message_id, status FROM orchestration_checkpoints
       WHERE user_id = $1 AND created_at > $2 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [userId, afterIso],
    );
    if (r.rows.length) {
      const cp = r.rows[0];
      const user = data.users.find((u) => u.userId === userId);
      const res = await request('POST', `/ai-providers/approvals/${cp.reply_message_id}`, { action: 'approve' }, user.token);
      console.log(`  [${label}] approved checkpoint ${cp.id} -> status=${res.status}`);
      return true;
    }
    await sleep(3000);
  }
  console.log(`  [${label}] không thấy checkpoint nào cần duyệt trong ${maxWaitMs}ms.`);
  return false;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u = data.users[5];
  const tag = crypto.randomUUID().slice(0, 6);
  const tableA = `CustomersA_r2_${tag}`;
  const tableB = `CustomersB_r2_${tag}`;

  const pg = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });
  await pg.connect();

  console.log(`\n========== LL2 RERUN (sau khi fix bug literal-data) — ${ROWS} dòng, mismatch tại idx=[${MISMATCH_IDX.join(',')}] ==========`);

  const rowsA = Array.from({ length: ROWS }, (_, i) => {
    const n = i + 1;
    return `(${n}, 'Customer${n}', 'customer${n}@test.com')`;
  }).join(', ');
  const { t0: t0A } = await ask(
    data,
    u,
    `Tạo bảng ${tableA} (Id INT PRIMARY KEY, Name NVARCHAR(50), Email NVARCHAR(100)) trong SQL Server nếu chưa có, rồi chèn đúng ${ROWS} dòng: ${rowsA}`,
    'LL2r-seed-A-send',
    20000,
  );
  await approveWhenPending(pg, data, u.userId, t0A, 'LL2r-seed-A-approve-DDL');
  await sleep(20000);

  const rowsB = Array.from({ length: ROWS }, (_, i) => {
    const n = i + 1;
    const email = MISMATCH_IDX.includes(n) ? `MISMATCH${n}@test.com` : `customer${n}@test.com`;
    return `(${n}, 'Customer${n}', '${email}')`;
  }).join(', ');
  const { t0: t0B } = await ask(
    data,
    u,
    `Tạo bảng ${tableB} (Id INT PRIMARY KEY, Name NVARCHAR(50), Email NVARCHAR(100)) trong SQL Server nếu chưa có, rồi chèn đúng ${ROWS} dòng: ${rowsB}`,
    'LL2r-seed-B-send',
    20000,
  );
  await approveWhenPending(pg, data, u.userId, t0B, 'LL2r-seed-B-approve-DDL');
  await sleep(20000);

  const groundTruth = await ask(
    data,
    u,
    `Chạy đúng câu SQL sau và trả về kết quả nguyên văn: SELECT a.Id FROM ${tableA} a JOIN ${tableB} b ON a.Id = b.Id WHERE a.Email <> b.Email ORDER BY a.Id`,
    'LL2r-ground-truth-raw-sql',
    45000,
  );

  const complexQuestion = await ask(
    data,
    u,
    `Đối chiếu dữ liệu khách hàng giữa bảng ${tableA} và ${tableB} (JOIN theo Id), liệt kê CHÍNH XÁC các Id có Email không khớp giữa 2 bảng`,
    'LL2r-complex-nl-question',
    45000,
  );

  const expectedIds = MISMATCH_IDX.map(String);
  function containsAll(text) {
    if (!text) return false;
    return expectedIds.every((id) => new RegExp(`\\b${id}\\b`).test(text));
  }
  const gtText = groundTruth.reply ? String(groundTruth.reply.content) : '';
  const cxText = complexQuestion.reply ? String(complexQuestion.reply.content) : '';
  console.log(`\n  → Kỳ vọng cả 2 liệt kê ĐÚNG các Id mismatch: ${expectedIds.join(', ')}`);
  console.log(`  Ground truth chứa đủ: ${containsAll(gtText)}`);
  console.log(`  Câu hỏi phức tạp chứa đủ: ${containsAll(cxText)}`);
  console.log(`  → LL2 rerun: ${containsAll(gtText) && containsAll(cxText) ? 'PASS' : 'FAIL/timeout — xem log orchestration để lấy ground truth thật'}`);
  console.log(`\n  Bảng: ${tableA}, ${tableB}`);

  await pg.end();
  console.log('\n✅ Xong LL2 rerun.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
