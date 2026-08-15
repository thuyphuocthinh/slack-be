require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
      (m) =>
        typeof m.content === 'string' &&
        m.content !== '🤖 Đang xử lý...' &&
        !m.content.startsWith('⏸️ Cần bạn duyệt'),
    );
    if (finalMsg) return finalMsg;
  }
  return null;
}

async function ask(data, user, text, label) {
  const t0 = new Date().toISOString();
  console.log(`\n>>> [${label}] "${text.slice(0, 200)}"`);
  const send = await sendAiMessage(data, user, text);
  if (send.status !== 201) {
    console.log(`  send FAILED status=${send.status}`, JSON.stringify(send.body).slice(0, 200));
    return null;
  }
  const reply = await waitForFinalAnswer(data, user.token, t0);
  console.log('  bot reply:', reply ? String(reply.content).slice(0, 500) : '(timeout)');
  return reply;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u = data.users[1];
  const tag = crypto.randomUUID().slice(0, 6);

  console.log(`\n========== VERIFY FIX #2: dữ liệu literal có sống sót qua bước plan() tóm tắt không (tag=${tag}) ==========`);

  const rows = [
    [`FixVerify-${tag}-01`, `fv01-${tag}@test.com`],
    [`FixVerify-${tag}-02`, `fv02-${tag}@test.com`],
    [`FixVerify-${tag}-03`, `fv03-${tag}@test.com`],
    [`FixVerify-${tag}-04`, `fv04-${tag}@test.com`],
    [`FixVerify-${tag}-05`, `fv05-${tag}@test.com`],
  ];
  const rowsText = rows.map(([name, email]) => `('${name}', '${email}')`).join(', ');

  await ask(
    data,
    u,
    `Kiểm tra bảng Customers có tồn tại không, sau đó chèn đúng 5 dòng vào bảng Customers (FullName, Email): ${rowsText}`,
    'insert-literal-multi-row',
  );

  await sleep(3000);

  const verify = await ask(
    data,
    u,
    `Chạy SQL: SELECT FullName, Email FROM Customers WHERE FullName LIKE 'FixVerify-${tag}-%' ORDER BY FullName`,
    'verify-select',
  );

  const text = verify ? String(verify.content) : '';
  const allMatch = rows.every(([name, email]) => text.includes(name) && text.includes(email));
  console.log(`\n  → Kỳ vọng thấy đủ cả 5 tên/email ĐÚNG NHƯ đã yêu cầu (FixVerify-${tag}-01..05, fv01-${tag}@test.com..fv05-${tag}@test.com).`);
  console.log(`  → ${allMatch ? '✅ PASS — dữ liệu literal sống sót đúng qua bước plan(), không bị bịa' : '❌ FAIL — vẫn còn bug, xem log orchestration để đối chiếu câu SQL thật đã chạy'}`);
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
