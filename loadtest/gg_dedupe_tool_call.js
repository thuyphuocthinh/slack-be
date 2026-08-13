/**
 * Nhóm GG (manual_test_bank_heavy.md) — dedupe tool call (MAX_SAME_TOOL_CALL_REPEATS=1)
 * có chặn nhầm case hợp lệ không.
 *
 * GG1: "Kiểm tra lại ... xong rồi kiểm tra lại lần nữa cho chắc" — ép model gọi
 *      LẶP LẠI Y HỆT 1 câu SELECT — lần 2 phải bị chặn ngay (WARN "bị chặn —
 *      lặp lại quá 1 lần" trong log orchestration).
 * GG2: "Chèn ... xong rồi đọc lại đúng dòng vừa chèn để xác nhận" — 2 lần gọi
 *      CÙNG tool nhưng SELECT/INSERT khác tham số — KHÔNG được chặn nhầm.
 *
 * Dùng user riêng (chưa dính burst credentials trước) để tránh nhiễu.
 *
 * Chạy: node loadtest/gg_dedupe_tool_call.js
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

// FE thật dùng Tiptap (editor.getJSON()), KHÔNG phải Quill Delta — xem bug đã
// phát hiện ngày 2026-08-11 (extractContentText() chỉ traverse cây Tiptap).
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

async function waitForBotReply(data, token, afterIso, maxWaitMs = 45000) {
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
      (m) => typeof m.content === 'string' && m.content !== '🤖 Đang xử lý...',
    );
    if (finalMsg) return finalMsg;
  }
  return null;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u1 = data.users[8]; // loadtest_9 — chưa dính burst credentials của nhóm X
  const u2 = data.users[9]; // loadtest_10

  console.log('\n=== GG1: "Kiểm tra lại bảng Products, xong rồi kiểm tra lại lần nữa cho chắc" ===');
  const t1 = new Date().toISOString();
  const send1 = await sendAiMessage(
    data,
    u1,
    'Kiểm tra lại bảng Products cho tôi, xong rồi kiểm tra lại lần nữa cho chắc',
  );
  console.log('  send status:', send1.status);
  const reply1 = await waitForBotReply(data, u1.token, t1);
  console.log('  bot reply:', reply1 ? String(reply1.content).slice(0, 300) : '(timeout, không thấy reply)');

  console.log('\n=== GG2: "Chèn 1 dòng Test Product GG, xong rồi đọc lại đúng dòng vừa chèn" ===');
  const t2 = new Date().toISOString();
  const send2 = await sendAiMessage(
    data,
    u2,
    "Chèn 1 dòng mới vào bảng Products với tên 'Test Product GG', giá 100, xong rồi đọc lại đúng dòng vừa chèn để xác nhận",
  );
  console.log('  send status:', send2.status);
  const reply2 = await waitForBotReply(data, u2.token, t2);
  console.log('  bot reply:', reply2 ? String(reply2.content).slice(0, 400) : '(timeout, không thấy reply)');

  console.log('\n✅ Xong GG1/GG2 — đối chiếu thêm log orchestration (pm2 logs orchestration) để xem WARN "bị chặn — lặp lại quá 1 lần" có xuất hiện ĐÚNG cho GG1 và KHÔNG xuất hiện cho GG2.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
