/**
 * Nhóm EE (manual_test_bank_heavy.md) — EE2: approval hàng loạt ở NHIỀU
 * channel khác nhau gần như cùng lúc — kiểm tra approval hiện đúng channel,
 * không hiện nhầm/duyệt nhầm sang channel khác.
 *
 * Tạo thêm 2 channel mới (dùng admin, đã là owner workspace), add 1 user test
 * riêng vào mỗi channel mới, rồi bắn 3 prompt cần duyệt gần như đồng thời ở
 * 3 channel (1 channel có sẵn + 2 channel mới).
 *
 * Chạy: node loadtest/ee2_multi_channel_approval.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const ADMIN_TOKEN_FILE = path.join(__dirname, '_admin_token.json');
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

function sendAiMessage(workspaceId, channelId, botUserId, user, text) {
  const body = {
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            ...(botUserId ? [{ type: 'mention', attrs: { id: botUserId } }] : []),
            { type: 'text', text: ` ${text}` },
          ],
        },
      ],
    },
    mentions: botUserId ? [botUserId] : undefined,
  };
  return request('POST', `/workspaces/${workspaceId}/channels/${channelId}/messages`, body, user.token);
}

async function getLatestBotMessage(workspaceId, channelId, token) {
  const res = await request(
    'GET',
    `/workspaces/${workspaceId}/channels/${channelId}/messages?limit=5`,
    null,
    token,
  );
  const msgs = res.body?.data?.messages ?? [];
  return msgs.find((m) => m.sender?.isBot) ?? null;
}

async function waitForApprovalCard(workspaceId, channelId, token, maxWaitMs = 60000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const msg = await getLatestBotMessage(workspaceId, channelId, token);
    if (msg && typeof msg.content === 'object' && msg.content?.type === 'approval_request') return msg;
    await sleep(2000);
  }
  return null;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const { token: adminToken } = JSON.parse(fs.readFileSync(ADMIN_TOKEN_FILE, 'utf8'));

  console.log('\n=== Setup: tạo 2 channel mới trong workspace hiện có ===');
  const ch2Res = await request(
    'POST',
    `/workspaces/${data.workspaceId}/channels`,
    { title: 'ee2-test-channel-2', description: 'EE2 multi-channel approval test', type: 'group' },
    adminToken,
  );
  const ch3Res = await request(
    'POST',
    `/workspaces/${data.workspaceId}/channels`,
    { title: 'ee2-test-channel-3', description: 'EE2 multi-channel approval test', type: 'group' },
    adminToken,
  );
  const ch2Id = ch2Res.body?.data?.id;
  const ch3Id = ch3Res.body?.data?.id;
  console.log('  channel2:', ch2Res.status, ch2Id, '| channel3:', ch3Res.status, ch3Id);
  if (!ch2Id || !ch3Id) {
    console.error('❌ Không tạo được channel mới — abort.', JSON.stringify(ch2Res.body), JSON.stringify(ch3Res.body));
    process.exit(1);
  }

  const u2 = data.users[6];
  const u3 = data.users[7];
  console.log('\n=== Add user test vào 2 channel mới ===');
  const add2 = await request(
    'POST',
    `/workspaces/${data.workspaceId}/channels/${ch2Id}/batch-members`,
    { targetMembers: [{ email: u2.email, memberId: u2.userId }] },
    adminToken,
  );
  const add3 = await request(
    'POST',
    `/workspaces/${data.workspaceId}/channels/${ch3Id}/batch-members`,
    { targetMembers: [{ email: u3.email, memberId: u3.userId }] },
    adminToken,
  );
  console.log('  add2:', add2.status, '| add3:', add3.status);

  const u1 = data.users[8];
  const ch1Id = data.channelId; // channel gốc

  console.log('\n=== Bắn 3 prompt cần duyệt GẦN NHƯ ĐỒNG THỜI ở 3 channel khác nhau ===');
  const [r1, r2, r3] = await Promise.all([
    sendAiMessage(data.workspaceId, ch1Id, data.botUserId, u1, 'Xoá tất cả dòng trong bảng Products có giá dưới 10'),
    sendAiMessage(data.workspaceId, ch2Id, data.botUserId, u2, "Xoá hẳn bảng TempData đi"),
    sendAiMessage(data.workspaceId, ch3Id, data.botUserId, u3, 'Cập nhật giá bảng Products, sản phẩm Test Product thành 999'),
  ]);
  console.log('  send status ch1/ch2/ch3:', r1.status, r2.status, r3.status);

  console.log('\n=== Đợi approval card ở TỪNG channel, kiểm tra đúng nội dung/đúng channel ===');
  const [a1, a2, a3] = await Promise.all([
    waitForApprovalCard(data.workspaceId, ch1Id, u1.token),
    waitForApprovalCard(data.workspaceId, ch2Id, u2.token),
    waitForApprovalCard(data.workspaceId, ch3Id, u3.token),
  ]);
  console.log('  ch1 approval:', a1 ? JSON.stringify(a1.content).slice(0, 200) : '(không thấy)');
  console.log('  ch2 approval:', a2 ? JSON.stringify(a2.content).slice(0, 200) : '(không thấy)');
  console.log('  ch3 approval:', a3 ? JSON.stringify(a3.content).slice(0, 200) : '(không thấy)');

  console.log('\n=== Kiểm tra chéo: user2 xem channel1 có thấy approval của user1 lẫn vào không (không nên thấy tin nào của channel khác vì đã tách theo channelId) ===');
  const crossCheck = await getLatestBotMessage(data.workspaceId, ch1Id, u2.token);
  console.log('  (nếu user2 gọi API với channelId=ch1 nhưng không phải member, kỳ vọng lỗi 403, không đọc được):', crossCheck ? JSON.stringify(crossCheck.content).slice(0,150) : '(không đọc được — đúng)');

  console.log('\n✅ Xong EE2. Dọn dẹp: reject cả 3 approval để không để lại state treo.');
  for (const [a, u] of [[a1, u1], [a2, u2], [a3, u3]]) {
    if (a) await request('POST', `/ai-providers/approvals/${a.id}`, { action: 'reject' }, u.token);
  }
  console.log('Đã reject cả 3.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
