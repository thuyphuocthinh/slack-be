/**
 * Nhóm BB (manual_test_bank_heavy.md) — lịch sử hội thoại rất dài, compress
 * có giữ đúng thông tin không (Memory Manager tự tóm tắt bằng LLM khi vượt
 * ngân sách ký tự, thay vì cắt rule-based).
 *
 * BB1: Lượt 3 "Ghi nhớ giúp tôi: mã khách VIP đặc biệt là KH-9981", chat linh
 *      tinh ≥30-40 lượt để chắc chắn chạm ngưỡng nén (CHAT_HISTORY_LIMIT=10 +
 *      memory-manager.service.ts), rồi hỏi lại "Mã khách VIP đặc biệt lúc
 *      trước là gì nhỉ?" — PHẢI trả lời đúng "KH-9981".
 * BB2: (Tiếp BB1) "Xem schema bảng Customers trên SQL Server" — routing vẫn
 *      phải đúng sql_server, không bị nén làm lệch hướng.
 *
 * Rải filler message qua NHIỀU user khác nhau (round-robin) để né rate limit
 * AI-trigger 5/60s/user — 10 user x ~4 lượt = 40 lượt trong ~2 phút.
 *
 * Chạy (MAI, không chạy hôm nay): node loadtest/bb_long_history_compression.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PREFIX = '/api/v1';
const NUM_FILLER_TURNS = 14; // CHAT_HISTORY_LIMIT=10 msg, 14 lượt = 28 msg filler — dư margin, chạy nhanh hơn
const FILLER_PROMPTS = [
  'Bây giờ là mấy giờ?',
  'Kể 1 câu vui ngắn cho tôi nghe đi.',
  'Hôm nay bạn thấy thế nào?',
  '1 với 1 là mấy?',
  'Chào bạn.',
];

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

async function waitForFinalAnswer(data, token, maxWaitMs = 60000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const msg = await getLatestBotMessage(data, token);
    if (msg && typeof msg.content === 'string' && msg.content !== '🤖 Đang xử lý...') return msg;
    await sleep(2000);
  }
  return null;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const mainUser = data.users[0]; // người "ghi nhớ" và hỏi lại — cố định 1 user cho rõ mạch

  console.log('\n=== BB1 (lượt sớm): "Ghi nhớ giúp tôi: mã khách VIP đặc biệt là KH-9981" ===');
  await sendAiMessage(data, mainUser, 'Ghi nhớ giúp tôi: mã khách VIP đặc biệt là KH-9981');
  const rememberReply = await waitForFinalAnswer(data, mainUser.token);
  console.log('  bot reply:', rememberReply ? String(rememberReply.content).slice(0, 200) : '(timeout)');

  console.log(`\n=== Chat linh tinh ${NUM_FILLER_TURNS} lượt (round-robin ${data.users.length} user, để chạm ngưỡng nén lịch sử) ===`);
  for (let i = 0; i < NUM_FILLER_TURNS; i++) {
    const u = data.users[i % data.users.length];
    const prompt = FILLER_PROMPTS[i % FILLER_PROMPTS.length];
    await sendAiMessage(data, u, prompt);
    process.stdout.write(`  [${i + 1}/${NUM_FILLER_TURNS}] ${u.email}: "${prompt}"\r`);
    await sleep(1500); // rải đều, mỗi user chỉ nhận 1 tin mỗi ~15s (10 user) — dưới xa 5/60s
  }
  console.log('\n  Đợi hàng đợi xử lý xong hết filler...');
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const res = await request('GET', '/ai-providers/health', null, null);
    if (res.body?.data?.queueDepth?.active === 0 && res.body?.data?.queueDepth?.waiting === 0) break;
    await sleep(3000);
  }

  console.log('\n=== BB1 (lượt muộn): "Mã khách VIP đặc biệt lúc trước là gì nhỉ?" ===');
  await sendAiMessage(data, mainUser, 'Mã khách VIP đặc biệt lúc trước là gì nhỉ?');
  const recallReply = await waitForFinalAnswer(data, mainUser.token);
  console.log('  bot reply (kỳ vọng PHẢI có "KH-9981"):');
  console.log('  ', recallReply ? String(recallReply.content).slice(0, 300) : '(timeout)');

  console.log('\n=== BB2: "Xem schema bảng Customers trên SQL Server" (routing vẫn phải đúng) ===');
  await sendAiMessage(data, mainUser, 'Xem schema bảng Customers trên SQL Server');
  const routingReply = await waitForFinalAnswer(data, mainUser.token);
  console.log('  bot reply (kỳ vọng: đúng schema sql_server, không lạc hướng):');
  console.log('  ', routingReply ? String(routingReply.content).slice(0, 300) : '(timeout)');

  console.log('\n✅ Xong BB1/BB2.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
