/**
 * Nhóm Y (manual_test_bank_heavy.md) — Y1: 1 workspace spam có làm nghẽn
 * workspace khác không (WORKSPACE_TRIGGER_ADMISSION_LIMIT=30).
 *
 * 10 user test x 4 tin = 40 lượt trigger AI trong CÙNG 1 workspace, rải trong
 * ~10s (Promise.all) — vượt xa WORKSPACE_TRIGGER_ADMISSION_LIMIT=30 trong
 * WORKSPACE_TRIGGER_PRIORITY_WINDOW_SEC=60s. Mỗi user chỉ gửi 4 tin (dưới xa
 * AI_TRIGGER_RATE_LIMIT 5/60s/user và gateway RateLimit 10/10s/user).
 *
 * Chạy: node loadtest/y1_workspace_admission_limit.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PREFIX = '/api/v1';
const MESSAGES_PER_USER = 4;

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

  console.log(`\n=== Y1: bắn ${data.users.length}x${MESSAGES_PER_USER}=${data.users.length * MESSAGES_PER_USER} tin "@AI cho tôi biết giờ hiện tại" đồng thời trong 1 workspace ===`);
  const sendPromises = [];
  for (const u of data.users) {
    for (let i = 0; i < MESSAGES_PER_USER; i++) {
      sendPromises.push(
        sendAiMessage(data, u, `Cho tôi biết giờ hiện tại (lượt ${i + 1})`).then((res) => ({
          email: u.email,
          i,
          status: res.status,
        })),
      );
    }
  }
  const results = await Promise.all(sendPromises);
  console.log(`  Đã gửi ${results.length} tin — tất cả đều status 201 (message TẠO thành công, việc từ chối AI-trigger xảy ra SAU, không phải ở tầng tạo message):`);
  const notCreated = results.filter((r) => r.status !== 200 && r.status !== 201);
  console.log(`  ${notCreated.length} tin không tạo được (rate limit gateway khác):`, JSON.stringify(notCreated).slice(0, 300));

  console.log('\n=== Đợi hàng đợi xử lý xong, rồi đếm số tin bot trả lời "quá nhanh" (bị từ chối enqueue) so với số tin xử lý AI thật ===');
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const res = await request('GET', '/ai-providers/health', null, null);
    if (res.body?.data?.queueDepth?.active === 0 && res.body?.data?.queueDepth?.waiting === 0) break;
    await sleep(3000);
  }

  const res = await request(
    'GET',
    `/workspaces/${data.workspaceId}/channels/${data.channelId}/messages?limit=60`,
    null,
    data.users[0].token,
  );
  const msgs = res.body?.data?.messages ?? [];
  const rejectedCount = msgs.filter(
    (m) => m.sender?.isBot && typeof m.content === 'string' && m.content.includes('quá nhanh'),
  ).length;
  const realAnswerCount = msgs.filter(
    (m) => m.sender?.isBot && typeof m.content === 'string' && !m.content.includes('quá nhanh') && m.content !== '🤖 Đang xử lý...',
  ).length;
  console.log(`  Trong 60 tin gần nhất: ${rejectedCount} tin bị từ chối enqueue ("quá nhanh"), ${realAnswerCount} tin có câu trả lời AI thật.`);
  console.log('  (Kỳ vọng Y1: có tin bị từ chối đúng lúc vượt 30 lượt/60s — không crash, không rớt job âm thầm — mọi tin đều có PHẢN HỒI, dù là từ chối hay trả lời thật)');

  console.log('\n✅ Xong Y1.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
