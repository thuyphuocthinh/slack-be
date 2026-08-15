require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');

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
      { hostname: 'localhost', port: 3000, path: '/api/v1' + urlPath, method, headers },
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

async function ask(data, user, text, label) {
  const t0 = new Date().toISOString();
  console.log(`\n>>> [${label}] "${text}"`);
  const send = await sendAiMessage(data, user, text);
  if (send.status !== 201) {
    console.log(`  send FAILED status=${send.status}`, JSON.stringify(send.body).slice(0, 200));
    return null;
  }
  const reply = await waitForFinalAnswer(data, user.token, t0);
  console.log('  bot reply:', reply ? String(reply.content).slice(0, 600) : '(timeout)');
  return reply;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u = data.users[7]; // loadtest_8 — riêng, tránh nhiễu
  const tag = crypto.randomUUID().slice(0, 6);

  console.log(`\n========== OO1: xoá "sản phẩm bán ế" — không nói rõ tiêu chí ==========`);
  await ask(
    data,
    u,
    `Xoá mấy cái sản phẩm bán ế trong bảng Products giúp tôi`,
    'OO1',
  );

  await sleep(3000);
  console.log(`\n========== OO2: "doanh thu tháng trước" — không rõ định nghĩa khoảng thời gian ==========`);
  await ask(
    data,
    u,
    `Cho tôi xem doanh thu tháng trước`,
    'OO2',
  );

  await sleep(3000);
  console.log(`\n========== OO3: "khách hàng thân thiết" — tiêu chí không tồn tại ==========`);
  await ask(
    data,
    u,
    `Khách hàng thân thiết của mình là những ai nhỉ`,
    'OO3',
  );

  await sleep(3000);
  console.log(`\n========== OO4: "mấy sản phẩm áo thun", "lên chút" — 2 điểm mơ hồ (tag=${tag}) ==========`);
  await ask(
    data,
    u,
    `Chèn 3 dòng vào bảng Products (Name, Price, StockQuantity): ('AoThunOO4-${tag}-A', 100, 10), ('AoThunOO4-${tag}-B', 120, 10), ('AoThunOO4-${tag}-C', 90, 10)`,
    'OO4-seed',
  );
  await sleep(15000);
  await ask(
    data,
    u,
    `Cập nhật giá mấy sản phẩm áo thun OO4-${tag} lên chút đi`,
    'OO4',
  );

  console.log('\n✅ Xong nhóm OO — đối chiếu bằng log orchestration (plan() result, xem có step ghi bị tạo ra không dù chưa rõ tiêu chí).');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
