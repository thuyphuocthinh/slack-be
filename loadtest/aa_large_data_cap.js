/**
 * Nhóm AA (manual_test_bank_heavy.md) — cap dữ liệu khổng lồ có hoạt động mà
 * không làm mất số liệu quan trọng không.
 *
 * Precondition: bảng Orders cần ≥5000 dòng. KHÔNG cần cài driver SQL Server
 * riêng (mssql) — seed bằng chính AI (nó đã biết tự viết 1 câu SQL CTE sinh
 * đủ N dòng thay vì liệt kê thủ công, xem ORCHESTRATION_SYSTEM_PROMPT + đã
 * xác nhận qua EE1 ngày 2026-08-11: 100 dòng chỉ cần 1 approval).
 *
 * AA2 (Google Sheet "Dữ liệu lớn" ≥5000 dòng) do USER tự tạo trước (đã xác
 * nhận) — script chỉ cần đúng TÊN sheet, không cần ID cụ thể (để AI tự tìm
 * qua tool list/search).
 *
 * Chạy (MAI, không chạy hôm nay): node loadtest/aa_large_data_cap.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PREFIX = '/api/v1';
const SHEET_NAME = 'Dữ liệu lớn'; // đổi nếu user đặt tên khác

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

async function getLatestBotMessage(data, token) {
  const res = await request(
    'GET',
    `/workspaces/${data.workspaceId}/channels/${data.channelId}/messages?limit=5`,
    null,
    token,
  );
  const msgs = res.body?.data?.messages ?? [];
  return msgs.find((m) => m.sender?.isBot) ?? null;
}

async function waitForApprovalCard(data, token, maxWaitMs = 60000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const msg = await getLatestBotMessage(data, token);
    if (msg && typeof msg.content === 'object' && msg.content?.type === 'approval_request') return msg;
    await sleep(2000);
  }
  return null;
}

async function waitForFinalAnswer(data, token, maxWaitMs = 90000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const msg = await getLatestBotMessage(data, token);
    if (msg && typeof msg.content === 'string' && msg.content !== '🤖 Đang xử lý...') return msg;
    await sleep(3000);
  }
  return null;
}

function resolveApproval(user, messageId, action) {
  return request('POST', `/ai-providers/approvals/${messageId}`, { action }, user.token);
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u = data.users[0];

  console.log('\n=== SEED: tạo 5000 đơn hàng ngẫu nhiên vào bảng Orders (1 câu SQL, qua chính AI) ===');
  await sendAiMessage(
    data,
    u,
    'Tạo 5000 đơn hàng (Orders) ngẫu nhiên cho các khách hàng ĐÃ CÓ trong bảng Customers (CustomerId hợp lệ), OrderDate trong 1 năm qua, Status ngẫu nhiên (Pending/Completed/Cancelled), TotalAmount ngẫu nhiên. Dùng ĐÚNG 1 câu SQL duy nhất tự sinh đủ 5000 dòng trong database (CTE + NEWID/CHECKSUM), không liệt kê thủ công.',
  );
  const seedApproval = await waitForApprovalCard(data, u.token);
  if (seedApproval) {
    console.log('  seed cần duyệt — tự approve...');
    await resolveApproval(u, seedApproval.id, 'approve');
  }
  const seedResult = await waitForFinalAnswer(data, u.token, 120000);
  console.log('  seed kết quả:', seedResult ? String(seedResult.content).slice(0, 300) : '(timeout)');

  console.log('\n=== Xác nhận số dòng thật trong Orders ===');
  await sendAiMessage(data, u, 'Đếm xem bảng Orders hiện có bao nhiêu dòng, trả về đúng 1 số');
  const countResult = await waitForFinalAnswer(data, u.token);
  console.log('  số dòng Orders:', countResult ? String(countResult.content).slice(0, 200) : '(timeout)');

  console.log('\n=== AA1: "Lấy toàn bộ dữ liệu bảng Orders, không lọc gì cả, hiện hết cho tôi" ===');
  await sendAiMessage(data, u, 'Lấy toàn bộ dữ liệu bảng Orders, không lọc gì cả, hiện hết cho tôi');
  const aa1Result = await waitForFinalAnswer(data, u.token, 120000);
  console.log('  AA1 reply (kỳ vọng: nói rõ đã cắt bớt/chỉ xử lý được 1 phần, KHÔNG báo như đã xem hết):');
  console.log('  ', aa1Result ? String(aa1Result.content).slice(0, 500) : '(timeout)');

  console.log('\n=== AA3: (ngay sau AA1) "Ở dòng số 4000, giá trị cột đầu tiên là gì?" ===');
  await sendAiMessage(data, u, 'Ở dòng số 4000 trong dữ liệu Orders vừa lấy, giá trị cột đầu tiên (OrderId) là gì?');
  const aa3Result = await waitForFinalAnswer(data, u.token);
  console.log('  AA3 reply (kỳ vọng: THỪA NHẬN không đủ dữ liệu, KHÔNG bịa số):');
  console.log('  ', aa3Result ? String(aa3Result.content).slice(0, 400) : '(timeout)');

  console.log('\n=== AA2: "Đọc toàn bộ nội dung sheet \'' + SHEET_NAME + '\' cho tôi" ===');
  await sendAiMessage(data, u, `Đọc toàn bộ nội dung sheet '${SHEET_NAME}' cho tôi`);
  const aa2Result = await waitForFinalAnswer(data, u.token, 120000);
  console.log('  AA2 reply (kỳ vọng tương tự AA1 — cap đúng chỗ, không cắt giữa 1 số/tên):');
  console.log('  ', aa2Result ? String(aa2Result.content).slice(0, 500) : '(timeout — có thể user chưa connect google_sheets hoặc chưa tạo sheet, xem hướng dẫn đầu file)');

  console.log('\n✅ Xong AA1-AA3 (SQL) + AA2 (Sheet). Đối chiếu thêm log orchestration nếu cần xem chi tiết capToolResultSize.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
