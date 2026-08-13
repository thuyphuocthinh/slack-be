/**
 * Re-verify HH1 (manual_test_bank_heavy.md) sau Fix #3 — báo sai số lượng khi
 * guardrail dừng giữa chừng. Gửi lại ĐÚNG prompt gốc, kỳ vọng câu trả lời cuối
 * có disclaimer "⚠️ Yêu cầu cần xử lý đúng X, nhưng... chỉ xác nhận được Y"
 * nếu số lượng THẬT không khớp yêu cầu.
 *
 * Chạy: node loadtest/hh1_quantity_honesty.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');

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

async function waitForFinalAnswer(data, token, afterIso, maxWaitMs = 120000) {
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

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u = data.users[7]; // loadtest_8 — riêng, tránh nhiễu với BB1/GG1 vừa chạy

  console.log('\n=== HH1: "Chèn 12 sản phẩm ngẫu nhiên..., MỖI sản phẩm 1 lần gọi tool riêng" ===');
  const t0 = new Date().toISOString();
  const send = await sendAiMessage(
    data,
    u,
    "Chèn 12 sản phẩm ngẫu nhiên vào bảng Products, MỖI sản phẩm phải là 1 lần gọi tool riêng, không được gộp chung 1 câu lệnh",
  );
  console.log('  send status:', send.status);
  const reply = await waitForFinalAnswer(data, u.token, t0);
  console.log('  bot reply:\n ', reply ? String(reply.content) : '(timeout, không thấy reply)');
  if (reply) {
    const hasDisclaimer = String(reply.content).includes('⚠️ Yêu cầu cần xử lý đúng');
    console.log(`\n  → Disclaimer trung thực xuất hiện: ${hasDisclaimer ? 'CÓ ✅' : 'KHÔNG ❌ (chỉ đúng nếu số lượng thật KHỚP yêu cầu)'}`);
  }
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
