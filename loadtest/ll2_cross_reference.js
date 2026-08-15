/**
 * heavy_v3.md nhóm LL2 (ADAPTED) — bản gốc cần 2 hệ thống ngoài (VD SQL Server
 * + Google Sheets) có sai lệch biết trước, nhưng không có tích hợp Sheets
 * trong hệ thống này. Thay bằng 2 BẢNG trong CÙNG SQL Server (đúng "2 nguồn dữ
 * liệu" theo nghĩa AI phải JOIN/so sánh 2 bảng riêng biệt, không phải tự bịa),
 * seed sẵn N dòng mismatch biết trước theo Id.
 *
 * Ground truth lấy bằng 1 câu SQL JOIN đơn giản AI tự chạy (đọc, đáng tin,
 * không cần suy luận) — rồi so với câu hỏi phức tạp hơn (không chỉ định sẵn
 * cách viết SQL) để xem Supervisor tự viết đúng logic so sánh không.
 *
 * Chạy: node loadtest/ll2_cross_reference.js
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
const ROWS = 30;
const MISMATCH_IDS = [3, 7, 12, 18, 24, 29];

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
    return null;
  }
  const reply = await waitForFinalAnswer(data, user.token, t0, maxWaitMs);
  console.log('  bot reply:', reply ? String(reply.content).slice(0, 500) : '(timeout)');
  return reply;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u = data.users[4]; // loadtest_5 — riêng kênh, tránh nhiễu với JJ2/khác
  const tag = crypto.randomUUID().slice(0, 6);
  const tableA = `CustomersA_${tag}`;
  const tableB = `CustomersB_${tag}`;

  console.log(`\n========== LL2 (adapted): đối chiếu 2 bảng ${ROWS} dòng, ${MISMATCH_IDS.length} mismatch biết trước tại Id=[${MISMATCH_IDS.join(',')}] ==========`);

  const rowsA = Array.from({ length: ROWS }, (_, i) => {
    const id = i + 1;
    return `(${id}, 'Customer${id}', 'customer${id}@test.com')`;
  }).join(', ');
  await ask(
    data,
    u,
    `Tạo bảng ${tableA} (Id INT PRIMARY KEY, Name NVARCHAR(50), Email NVARCHAR(100)) trong SQL Server nếu chưa có, rồi chèn đúng ${ROWS} dòng: ${rowsA}`,
    'LL2-seed-A',
    60000,
  );
  await sleep(3000);

  const rowsB = Array.from({ length: ROWS }, (_, i) => {
    const id = i + 1;
    const email = MISMATCH_IDS.includes(id) ? `MISMATCH${id}@test.com` : `customer${id}@test.com`;
    return `(${id}, 'Customer${id}', '${email}')`;
  }).join(', ');
  await ask(
    data,
    u,
    `Tạo bảng ${tableB} (Id INT PRIMARY KEY, Name NVARCHAR(50), Email NVARCHAR(100)) trong SQL Server nếu chưa có, rồi chèn đúng ${ROWS} dòng: ${rowsB}`,
    'LL2-seed-B',
    60000,
  );
  await sleep(3000);

  const groundTruth = await ask(
    data,
    u,
    `Chạy đúng câu SQL sau và trả về kết quả nguyên văn: SELECT a.Id FROM ${tableA} a JOIN ${tableB} b ON a.Id = b.Id WHERE a.Email <> b.Email ORDER BY a.Id`,
    'LL2-ground-truth-raw-sql',
    45000,
  );

  const complexQuestion = await ask(
    data,
    u,
    `Đối chiếu dữ liệu khách hàng giữa bảng ${tableA} và ${tableB} (JOIN theo Id), liệt kê CHÍNH XÁC các Id có Email không khớp giữa 2 bảng`,
    'LL2-complex-nl-question',
    45000,
  );

  console.log('\n  → Kỳ vọng ground truth và câu hỏi phức tạp đều liệt kê ĐÚNG các Id:', MISMATCH_IDS.join(', '));
  const expectedIds = MISMATCH_IDS.map(String);
  function checkContainsAll(text) {
    if (!text) return { allFound: false, extraSuspect: false };
    const allFound = expectedIds.every((id) => new RegExp(`\\b${id}\\b`).test(text));
    return { allFound };
  }
  const gt = checkContainsAll(groundTruth ? String(groundTruth.content) : '');
  const cx = checkContainsAll(complexQuestion ? String(complexQuestion.content) : '');
  console.log(`  Ground truth (raw SQL) chứa đủ ${expectedIds.length} Id mismatch: ${gt.allFound}`);
  console.log(`  Câu hỏi phức tạp (NL) chứa đủ ${expectedIds.length} Id mismatch: ${cx.allFound}`);
  console.log(`  → LL2 kết quả: ${gt.allFound && cx.allFound ? 'PASS (cần soát lại thủ công xem có liệt kê THỪA Id nào không, script chỉ check thiếu)' : 'FAIL/CẦN XEM LẠI'}`);

  console.log(`\n  Bảng test: ${tableA}, ${tableB} — có thể xoá thủ công sau nếu cần dọn SQL Server.`);
  console.log('\n✅ Xong LL2.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
