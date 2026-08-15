/**
 * heavy_v3.md nhóm LL2 (bản 2, tránh CREATE TABLE) — lần chạy đầu
 * (ll2_cross_reference.js) phát hiện 1 bug MỚI nghiêm trọng hơn mục tiêu gốc:
 * INSERT đi kèm CREATE TABLE (DDL) bị buộc qua HITL approval, và khi RESUME
 * sau approval, ReactLoop KHÔNG dùng lại dữ liệu literal gốc user cung cấp —
 * mà tự bịa dữ liệu placeholder khác hẳn (xem log 78650/78635, bảng A ra
 * "Nguyễn Văn A..AD", bảng B ra "Customer1..30" chứ không phải danh sách 30
 * dòng + 6 MISMATCH đã yêu cầu). Xem heavy_v3.md nhóm OO để biết chi tiết.
 *
 * Bản 2 này né hẳn đường CREATE TABLE (né luôn confound đó) bằng cách chèn 2
 * tập dữ liệu vào bảng `Customers` CÓ SẴN (INSERT thường không cần duyệt) —
 * vẫn đúng tinh thần LL2 gốc: 2 tập dữ liệu tách biệt, có N mismatch biết
 * trước, AI phải tự JOIN/so sánh đúng.
 *
 * Chạy: node loadtest/ll2_cross_reference_v2.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PREFIX = '/api/v1';
const ROWS = 20;
const MISMATCH_IDX = [3, 7, 12, 16];

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

async function waitForFinalAnswer(data, token, afterIso, maxWaitMs = 60000) {
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
    return null;
  }
  const reply = await waitForFinalAnswer(data, user.token, t0, maxWaitMs);
  console.log('  bot reply:', reply ? String(reply.content).slice(0, 600) : '(timeout)');
  return reply;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u = data.users[4];
  const tag = crypto.randomUUID().slice(0, 6);
  const baseTag = `LL2B-${tag}`;
  const mirrorTag = `LL2M-${tag}`;

  console.log(`\n========== LL2 v2: chèn thẳng vào bảng Customers có sẵn (né CREATE TABLE), ${ROWS} dòng, mismatch tại idx=[${MISMATCH_IDX.join(',')}] ==========`);

  const rowsBase = Array.from({ length: ROWS }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return `('${baseTag}-${n}', 'llcust${n}@test.com', '000${n}', 'Test City')`;
  }).join(', ');
  await ask(
    data,
    u,
    `Chèn đúng ${ROWS} dòng vào bảng Customers (FullName, Email, Phone, City): ${rowsBase}`,
    'LL2v2-seed-base',
    30000,
  );
  await sleep(3000);

  const rowsMirror = Array.from({ length: ROWS }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    const idx = i + 1;
    const email = MISMATCH_IDX.includes(idx) ? `MISMATCH${n}@test.com` : `llcust${n}@test.com`;
    return `('${mirrorTag}-${n}', '${email}', '000${n}', 'Test City')`;
  }).join(', ');
  await ask(
    data,
    u,
    `Chèn đúng ${ROWS} dòng vào bảng Customers (FullName, Email, Phone, City): ${rowsMirror}`,
    'LL2v2-seed-mirror',
    30000,
  );
  await sleep(3000);

  const groundTruth = await ask(
    data,
    u,
    `Chạy đúng câu SQL sau và trả về kết quả nguyên văn: SELECT RIGHT(a.FullName, 2) AS Idx FROM Customers a JOIN Customers b ON RIGHT(a.FullName, 2) = RIGHT(b.FullName, 2) WHERE a.FullName LIKE '${baseTag}-%' AND b.FullName LIKE '${mirrorTag}-%' AND a.Email <> b.Email ORDER BY Idx`,
    'LL2v2-ground-truth-raw-sql',
    30000,
  );

  const complexQuestion = await ask(
    data,
    u,
    `Trong bảng Customers, so sánh Email của các khách hàng có tên bắt đầu bằng '${baseTag}-' với các khách hàng tương ứng (cùng 2 số cuối tên) có tên bắt đầu bằng '${mirrorTag}-'. Liệt kê CHÍNH XÁC các số thứ tự có Email không khớp giữa 2 nhóm.`,
    'LL2v2-complex-nl-question',
    30000,
  );

  const expectedIdx = MISMATCH_IDX.map((i) => String(i).padStart(2, '0'));
  console.log(`\n  → Kỳ vọng cả 2 đều liệt kê ĐÚNG các số thứ tự mismatch: ${expectedIdx.join(', ')} (và KHÔNG THỪA số nào khác)`);
  function checkContainsAll(text) {
    if (!text) return false;
    return expectedIdx.every((idx) => text.includes(idx) || text.includes(String(parseInt(idx, 10))));
  }
  const gtOk = checkContainsAll(groundTruth ? String(groundTruth.content) : '');
  const cxOk = checkContainsAll(complexQuestion ? String(complexQuestion.content) : '');
  console.log(`  Ground truth (raw SQL) chứa đủ mismatch: ${gtOk}`);
  console.log(`  Câu hỏi phức tạp (NL) chứa đủ mismatch: ${cxOk}`);
  console.log(`  → LL2 v2 kết quả: ${gtOk && cxOk ? 'PASS (soát thêm thủ công xem có liệt kê THỪA không)' : 'FAIL/CẦN XEM LẠI — xem log orchestration để biết SQL AI tự viết'}`);

  console.log(`\n  Tag đã dùng: base=${baseTag}, mirror=${mirrorTag} — có thể xoá thủ công sau (DELETE FROM Customers WHERE FullName LIKE 'LL2%-${tag}-%').`);
  console.log('\n✅ Xong LL2 v2.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
