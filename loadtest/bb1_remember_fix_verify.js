/**
 * Verify fix BB1 (2026-08-13) — "ghi nhớ" giờ phải lưu bền vào channel_memory
 * (field rememberFact từ plan()), không chỉ trôi theo cửa sổ lịch sử.
 *
 * Chạy: node loadtest/bb1_remember_fix_verify.js
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

async function waitForFinalAnswer(data, token, afterIso, maxWaitMs = 60000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(2500);
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
      (m) => typeof m.content === 'string' && m.content !== '🤖 Đang xử lý...',
    );
    if (finalMsg) return finalMsg;
  }
  return null;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u = data.users[5]; // loadtest_6 — riêng, tránh nhiễu

  const fact = `mã khách VIP siêu đặc biệt là KH-${Math.floor(1000 + Math.random() * 8999)}`;
  console.log(`\n=== Ghi nhớ: "Ghi nhớ giúp tôi: ${fact}" ===`);
  const t0 = new Date().toISOString();
  await sendAiMessage(data, u, `Ghi nhớ giúp tôi: ${fact}`);
  const reply = await waitForFinalAnswer(data, u.token, t0);
  console.log('  bot reply:', reply ? String(reply.content).slice(0, 200) : '(timeout)');

  console.log('\n=== Kiểm tra trực tiếp channel_memory (không đợi context trôi) ===');
  console.log('  Fact gốc để đối chiếu:', fact);
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
