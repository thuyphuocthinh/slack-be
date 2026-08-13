/**
 * Nhóm DD (manual_test_bank_heavy.md) — Stop/Abort giữa chừng, không để lại state rác.
 *
 * DD1: Bấm Stop NGAY khi tool đang chạy (chưa có kết quả) — turn dừng sạch;
 *      nếu tool đã ghi thật trước khi Stop kịp huỷ, turn SAU không tự chèn lại lần 2.
 * DD2: Bấm Stop TRƯỚC khi Duyệt/Từ chối lúc đang chờ approval — chuyển "đã dừng"
 *      rõ ràng, không kẹt mãi "đang chờ duyệt".
 * DD3: (Tiếp DD2) Gõ tin mới ngay sau Stop — chạy như 1 turn sạch.
 *
 * Chạy: node loadtest/dd_stop_mid_turn.js
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

function stopTurn(data, user, messageId) {
  return request('POST', `/ai-providers/stop/${messageId}`, {}, user.token);
}

function resolveApproval(user, messageId, action) {
  return request('POST', `/ai-providers/approvals/${messageId}`, { action }, user.token);
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u1 = data.users[0];
  const u2 = data.users[1];

  console.log('\n=== DD1: Chèn Test Product Stop, bấm Stop NGAY khi tool đang chạy ===');
  await sendAiMessage(data, u1, "Chèn 1 dòng mới vào bảng Products với tên 'Test Product Stop', giá 100");
  await sleep(2500); // để turn kịp bắt đầu chạy tool (canh sớm, trước khi có kết quả)
  const botMsg1 = await getLatestBotMessage(data, u1.token);
  console.log('  bot message hiện tại (đang xử lý):', botMsg1 ? JSON.stringify(botMsg1.content).slice(0, 150) : '(không thấy)');
  if (botMsg1) {
    const stopRes = await stopTurn(data, u1, botMsg1.id);
    console.log('  stop() status:', stopRes.status, JSON.stringify(stopRes.body).slice(0, 200));
  }
  await sleep(5000);
  const afterStop1 = await getLatestBotMessage(data, u1.token);
  console.log('  bot message SAU stop:', afterStop1 ? JSON.stringify(afterStop1.content).slice(0, 200) : '(không thấy)');

  console.log('\n=== DD1 (tiếp) — gửi lại y hệt để xem có tự chèn lại lần 2 không nếu INSERT đã kịp chạy ===');
  await sendAiMessage(data, u1, 'Kiểm tra bảng Products có bao nhiêu dòng tên "Test Product Stop"?');
  await sleep(10000);
  const dupCheck = await getLatestBotMessage(data, u1.token);
  console.log('  kết quả kiểm tra trùng:', dupCheck ? JSON.stringify(dupCheck.content).slice(0, 300) : '(không thấy)');

  console.log('\n=== DD2: Xoá dòng giá <10 (cần duyệt), bấm Stop TRƯỚC khi Duyệt/Từ chối ===');
  await sendAiMessage(data, u2, 'Xoá tất cả dòng trong bảng Products có giá dưới 10');
  await sleep(6000);
  const approvalMsg = await getLatestBotMessage(data, u2.token);
  console.log('  bot message (chờ duyệt?):', approvalMsg ? JSON.stringify(approvalMsg.content).slice(0, 250) : '(không thấy)');
  if (approvalMsg) {
    const stopRes2 = await stopTurn(data, u2, approvalMsg.id);
    console.log('  stop() trên approval status:', stopRes2.status, JSON.stringify(stopRes2.body).slice(0, 200));
  }
  await sleep(4000);
  const afterStop2 = await getLatestBotMessage(data, u2.token);
  console.log('  bot message SAU stop (mong đợi: "đã dừng", không kẹt "đang chờ duyệt"):', afterStop2 ? JSON.stringify(afterStop2.content).slice(0, 250) : '(không thấy)');

  console.log('\n=== DD3: Gõ tin mới NGAY sau Stop DD2, kiểm tra turn sạch ===');
  await sendAiMessage(data, u2, 'Xem schema bảng Customers trên SQL Server');
  await sleep(10000);
  const dd3Reply = await getLatestBotMessage(data, u2.token);
  console.log('  bot reply DD3:', dd3Reply ? JSON.stringify(dd3Reply.content).slice(0, 300) : '(không thấy)');

  console.log('\n✅ Xong DD1-DD3 — đối chiếu thêm DB (orchestration_checkpoints, messages) và log orchestration nếu cần.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
