/**
 * heavy_v3.md nhóm MM — 1 turn dài với NHIỀU approval liên tiếp, đếm bước có
 * lẫn lộn không (mở rộng W3). Dùng chung script cho cả MM1 (N nhỏ, delay dài
 * hơn giữa các lần duyệt) và MM2 (N gần chạm MAX_REAL_STEPS_PER_TURN=15).
 *
 * Vì mỗi DELETE chỉ tham chiếu ĐÚNG 1 tên sản phẩm (không phải payload nhiều
 * dòng), không dính bug "mất dữ liệu literal khi tóm tắt task" đã phát hiện ở
 * LL2/nhóm OO — tên sản phẩm đủ ngắn để giữ nguyên trong task description.
 *
 * Cách hoạt động: gửi 1 turn duy nhất yêu cầu xoá LẦN LƯỢT N sản phẩm, mỗi cái
 * xác nhận trước khi xoá cái tiếp theo. Sau đó POLL trực tiếp bảng
 * orchestration_checkpoints (không tin câu trả lời/UI) để tìm checkpoint MỚI
 * kế tiếp, approve, lặp lại N lần. Cuối cùng verify bằng 1 SELECT riêng xem
 * đã xoá đủ N sản phẩm chưa.
 *
 * Chạy: node loadtest/mm_sequential_approvals.js <label> <N> [delayMs=15000]
 *   VD: node loadtest/mm_sequential_approvals.js MM1 3 20000
 *       node loadtest/mm_sequential_approvals.js MM2 8 8000
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

async function pollNextCheckpoint(pg, userId, afterCreatedAt, maxWaitMs) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const r = await pg.query(
      `SELECT id, reply_message_id, status, pending_task, created_at
       FROM orchestration_checkpoints
       WHERE user_id = $1 AND status = 'pending' AND created_at > $2
       ORDER BY created_at ASC LIMIT 1`,
      [userId, afterCreatedAt],
    );
    if (r.rows.length) return r.rows[0];
    await sleep(3000);
  }
  return null;
}

(async () => {
  const label = process.argv[2] || 'MM1';
  const N = parseInt(process.argv[3] || '3', 10);
  const approveDelayMs = parseInt(process.argv[4] || '15000', 10);

  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u = data.users[6]; // loadtest_7
  const tag = crypto.randomUUID().slice(0, 6);
  const names = Array.from({ length: N }, (_, i) => `${label}-${String.fromCharCode(65 + i)}-${tag}`);

  const pg = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });
  await pg.connect();

  console.log(`\n========== ${label}: xoá lần lượt ${N} sản phẩm, duyệt cách nhau ~${approveDelayMs}ms ==========`);
  console.log(`  tag=${tag} names=${names.join(', ')}`);

  const seedRows = names.map((n) => `('${n}', 1, 1)`).join(', ');
  console.log('\n  Seed sản phẩm test (INSERT, không cần duyệt)...');
  const seedSend = await sendAiMessage(
    data,
    u,
    `Chèn ${N} dòng vào bảng Products (Name, Price, StockQuantity): ${seedRows}`,
  );
  console.log(`  seed send status=${seedSend.status}`);
  await sleep(15000);

  const t0 = new Date();
  console.log(`\n  [${t0.toISOString()}] Gửi turn duy nhất yêu cầu xoá lần lượt ${N} sản phẩm, xác nhận từng cái...`);
  const listText = names.map((n) => `'${n}'`).join(', ');
  const mainSend = await sendAiMessage(
    data,
    u,
    `Xoá lần lượt ${N} sản phẩm sau trong bảng Products, xác nhận với tôi từng cái trước khi xoá cái tiếp theo: ${listText}`,
  );
  console.log(`  main send status=${mainSend.status}`);

  let lastCheckpointAt = t0;
  let approvedCount = 0;
  for (let i = 0; i < N; i++) {
    console.log(`\n  --- Chờ checkpoint thứ ${i + 1}/${N} xuất hiện (poll orchestration_checkpoints)... ---`);
    const cp = await pollNextCheckpoint(pg, u.userId, lastCheckpointAt, 60000);
    if (!cp) {
      console.log(`  ❌ Không thấy checkpoint thứ ${i + 1} sau 60s — dừng lại, xem log orchestration.`);
      break;
    }
    console.log(`  Tìm thấy checkpoint id=${cp.id} task="${String(cp.pending_task).slice(0, 100)}" tạo lúc ${cp.created_at.toISOString()}`);
    lastCheckpointAt = cp.created_at;

    if (i > 0) {
      console.log(`  Đợi ${approveDelayMs}ms trước khi duyệt (mô phỏng user duyệt cách quãng, không bấm liền tay)...`);
      await sleep(approveDelayMs);
    }
    const approveRes = await request(
      'POST',
      `/ai-providers/approvals/${cp.reply_message_id}`,
      { action: 'approve' },
      u.token,
    );
    console.log(`  approve #${i + 1} status=${approveRes.status}`);
    approvedCount++;
    await sleep(5000);
  }

  console.log(`\n  Đã duyệt ${approvedCount}/${N} checkpoint. Đợi 15s cho xử lý xong, rồi verify bằng SELECT trực tiếp...`);
  await sleep(15000);

  const verifySend = await sendAiMessage(
    data,
    u,
    `Chạy SQL: SELECT Name FROM Products WHERE Name LIKE '${label}-%-${tag}'`,
  );
  console.log(`  verify send status=${verifySend.status} (xem log orchestration để lấy kết quả SELECT thật — script không poll UI vì kênh đông tin nhắn dễ timeout)`);

  await pg.end();
  console.log(`\n✅ Xong ${label} (đã duyệt ${approvedCount}/${N}) — đối chiếu chi tiết bằng log orchestration.`);
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
