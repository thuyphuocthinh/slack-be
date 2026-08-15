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
  console.log('  bot reply:', reply ? String(reply.content).slice(0, 400) : '(timeout)');
  return reply;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u = data.users[8]; // loadtest_9 — riêng
  const tag = crypto.randomUUID().slice(0, 6);

  console.log(`\n========== RR1: sửa ý NGAY trong 1 câu (tag=${tag}) ==========`);
  await ask(
    data,
    u,
    `Ghi nhớ giúp tôi: mã kho chính RR-${tag} là A100... à khoan, nhầm, mã kho chính RR-${tag} là A200 mới đúng`,
    'RR1-remember-with-correction',
  );
  await sleep(3000);
  const rr1 = await ask(data, u, `Mã kho chính RR-${tag} là gì nhỉ?`, 'RR1-recall');
  const rr1HasNew = rr1 && String(rr1.content).includes('A200');
  const rr1HasOld = rr1 && String(rr1.content).includes('A100');
  console.log(`  → RR1: có A200(mới)=${rr1HasNew}, có A100(cũ)=${rr1HasOld} — ${rr1HasNew && !rr1HasOld ? 'PASS' : 'FAIL/CẦN XEM LẠI'}`);

  console.log(`\n========== RR2: đại từ mơ hồ sau 20 tin nhắn không liên quan ==========`);
  await ask(data, u, `Ghi nhớ giúp tôi: dự án đang chạy RR-${tag} là Aurora-${tag}`, 'RR2-remember');
  await sleep(3000);
  const fillers = [
    'hôm nay trời đẹp nhỉ',
    'bạn khoẻ không',
    '1 với 1 bằng mấy',
    'giờ Việt Nam là mấy giờ',
    'kể 1 câu vui đi',
    'màu xanh dương tiếng Anh là gì',
    'thủ đô nước Pháp là gì',
    '2 cộng 2 bằng mấy',
    'con mèo kêu thế nào',
    'nói xin chào bằng tiếng Nhật',
  ];
  for (let i = 0; i < fillers.length; i++) {
    await ask(data, u, fillers[i], `RR2-filler-${i + 1}`);
    await sleep(1500);
  }
  const rr2 = await ask(data, u, `dự án RR-${tag} đó tới đâu rồi nhỉ`, 'RR2-recall-pronoun');
  const rr2Correct = rr2 && String(rr2.content).includes(`Aurora-${tag}`);
  console.log(`  → RR2: nhận ra "dự án đó" = dự án RR-${tag} đã ghi nhớ, trả đúng Aurora-${tag}=${rr2Correct}`);

  console.log(`\n========== RR3: hỏi lại bằng từ ngữ khác hẳn cách đã ghi nhớ ==========`);
  await ask(data, u, `Ghi nhớ giúp tôi: mã kho hàng chủ lực RR-${tag} là WH-${tag}`, 'RR3-remember');
  await sleep(3000);
  const rr3 = await ask(data, u, `kho hàng chủ lực RR-${tag} có mã số bao nhiêu nhỉ`, 'RR3-recall-paraphrase');
  const rr3Correct = rr3 && String(rr3.content).includes(`WH-${tag}`);
  console.log(`  → RR3: nhận ra "kho hàng chủ lực" = "mã kho hàng chủ lực" đã ghi nhớ, trả đúng WH-${tag}=${rr3Correct}`);

  console.log('\n✅ Xong nhóm RR.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
