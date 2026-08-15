/**
 * heavy_v3.md nhóm JJ2 — 2 checkpoint HITL cùng channel, kích hoạt GẦN NHƯ ĐỒNG
 * THỜI (Promise.all), approve ĐÚNG 1 cái, verify cái còn lại vẫn "pending"
 * nguyên vẹn — không tự động hoá được bằng UI nên gọi thẳng API approve +
 * đối chiếu trực tiếp bảng `orchestration_checkpoints` (Postgres) thay vì tin
 * lời văn AI, đúng nguyên tắc đã dùng ở JJ3.
 *
 * Chạy: node loadtest/jj2_approval_isolation.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PREFIX = '/api/v1';

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
      { hostname: API_HOST, port: API_PORT, path: API_PREFIX + urlPath, method, headers },
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

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const A = data.users[8]; // loadtest_9
  const B = data.users[9]; // loadtest_10
  const tag = crypto.randomUUID().slice(0, 6);
  const deleteTarget = `JJ2-DeleteMe-${tag}`;
  const updateTarget = `JJ2-UpdateMe-${tag}`;

  const pg = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });
  await pg.connect();

  console.log(`\n========== JJ2: 2 checkpoint HITL đồng thời, approve đúng 1, verify cô lập ==========`);
  console.log(`  tag=${tag} A=${A.email} B=${B.email}`);

  console.log('  Seed 2 sản phẩm test (INSERT, không cần duyệt)...');
  await sendAiMessage(
    data,
    A,
    `Chèn 2 dòng vào bảng Products: (1) Tên '${deleteTarget}' Giá 1 TonKho 5, (2) Tên '${updateTarget}' Giá 100 TonKho 5`,
  );
  await sleep(15000);

  const t0 = new Date();
  console.log(`  [${t0.toISOString()}] Gửi ĐỒNG THỜI: A xoá '${deleteTarget}', B cập nhật giá '${updateTarget}' thành 999...`);
  const [sendA, sendB] = await Promise.all([
    sendAiMessage(data, A, `Xoá sản phẩm tên '${deleteTarget}' trong bảng Products`),
    sendAiMessage(data, B, `Cập nhật giá sản phẩm '${updateTarget}' trong bảng Products thành 999`),
  ]);
  console.log(`  send A status=${sendA.status} | send B status=${sendB.status}`);

  console.log('  Đợi 20s để checkpoint được tạo, rồi đọc trực tiếp orchestration_checkpoints...');
  await sleep(20000);

  const cpRes = await pg.query(
    `SELECT id, reply_message_id, user_id, pending_task, status, created_at
     FROM orchestration_checkpoints
     WHERE user_id = ANY($1) AND created_at > $2
     ORDER BY created_at ASC`,
    [[A.userId, B.userId], t0],
  );
  console.log(`  Tìm thấy ${cpRes.rows.length} checkpoint mới:`);
  cpRes.rows.forEach((r) =>
    console.log(`    - id=${r.id} user=${r.user_id === A.userId ? 'A' : r.user_id === B.userId ? 'B' : r.user_id} status=${r.status} task="${String(r.pending_task).slice(0, 80)}"`),
  );

  const cpA = cpRes.rows.find((r) => r.user_id === A.userId);
  const cpB = cpRes.rows.find((r) => r.user_id === B.userId);

  if (!cpA || !cpB) {
    console.log('  ❌ Không tìm đủ 2 checkpoint — không thể tiếp tục test cô lập. Kiểm tra log orchestration.');
  } else {
    console.log(`\n  Approve CHỈ checkpoint của A (replyMessageId=${cpA.reply_message_id})...`);
    const approveRes = await request(
      'POST',
      `/ai-providers/approvals/${cpA.reply_message_id}`,
      { action: 'approve' },
      A.token,
    );
    console.log(`  approve A status=${approveRes.status}`, JSON.stringify(approveRes.body).slice(0, 200));

    console.log('  Đợi 15s cho job approval chạy xong, rồi đọc lại status của CẢ 2 checkpoint...');
    await sleep(15000);
    const recheck = await pg.query(
      `SELECT id, status FROM orchestration_checkpoints WHERE id = ANY($1)`,
      [[cpA.id, cpB.id]],
    );
    const statusA = recheck.rows.find((r) => r.id === cpA.id)?.status;
    const statusB = recheck.rows.find((r) => r.id === cpB.id)?.status;
    console.log(`  → Checkpoint A (đã approve) status=${statusA} (kỳ vọng: approved)`);
    console.log(`  → Checkpoint B (KHÔNG đụng vào) status=${statusB} (kỳ vọng: VẪN pending)`);
    const pass = statusA === 'approved' && statusB === 'pending';
    console.log(`  → JJ2 kết quả: ${pass ? 'PASS — cô lập đúng, approve A không ảnh hưởng B' : 'FAIL — có dấu hiệu lẫn checkpoint, cần điều tra'}`);

    console.log('\n  Dọn dẹp: reject checkpoint B để không treo pending...');
    const rejectRes = await request(
      'POST',
      `/ai-providers/approvals/${cpB.reply_message_id}`,
      { action: 'reject' },
      B.token,
    );
    console.log(`  reject B status=${rejectRes.status}`);
  }

  await pg.end();
  console.log('\n✅ Xong JJ2.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
