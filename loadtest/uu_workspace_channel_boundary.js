require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const EXTRA_WS_FILE = path.join(__dirname, 'extra-workspaces.json');

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

function sendAiMessageTo(workspaceId, channelId, botUserId, user, text) {
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

async function ask(workspaceId, channelId, botUserId, user, text, label) {
  console.log(`\n>>> [${label}] "${text.slice(0, 150)}"`);
  const send = await sendAiMessageTo(workspaceId, channelId, botUserId, user, text);
  console.log(`  send status=${send.status}`, send.status !== 201 ? JSON.stringify(send.body).slice(0, 200) : '');
  return send;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const extra = JSON.parse(fs.readFileSync(EXTRA_WS_FILE, 'utf8'));
  const wsB = extra.workspaces[0];
  const tag = crypto.randomUUID().slice(0, 6);

  const uMain1 = data.users[0];
  const uMain2 = data.users[1];

  console.log(`\n========== UU1 setup: tạo channel B thứ 2 trong CÙNG workspace chính (tag=${tag}) ==========`);
  const createCh = await request(
    'POST',
    `/workspaces/${data.workspaceId}/channels`,
    { title: `uu1-channel-b-${tag}`, description: 'UU1 channel boundary test', type: 'group' },
    uMain1.token,
  );
  console.log('  create channel status', createCh.status, JSON.stringify(createCh.body).slice(0, 200));
  const channelB = createCh.body?.data?.id;

  if (channelB && data.botUserId) {
    const addBot = await request(
      'POST',
      `/workspaces/${data.workspaceId}/channels/${channelB}/members`,
      { targetMember: { email: `ai-assistant+${data.workspaceId}@internal.bot`, memberId: data.botUserId } },
      uMain1.token,
    );
    console.log('  add bot to channel B status', addBot.status, JSON.stringify(addBot.body).slice(0, 200));
  }

  console.log(`\n========== UU1: ghi nhớ ở channel A, hỏi lại ở channel B (cùng workspace) ==========`);
  await ask(data.workspaceId, data.channelId, data.botUserId, uMain1, `Ghi nhớ giúp tôi: mã bí mật dự án UU1-${tag} là SECRET-${tag}`, 'UU1-remember-channelA');
  await sleep(20000);

  if (channelB) {
    await ask(data.workspaceId, channelB, data.botUserId, uMain1, `Mã bí mật dự án UU1-${tag} là gì`, 'UU1-recall-channelB');
  } else {
    console.log('  ⚠️ Không tạo được channel B — skip UU1 phần hỏi lại.');
  }

  await sleep(5000);
  console.log(`\n========== UU2: skill workspace A có bị gợi ý sang workspace B không (tag=${tag}) ==========`);
  await ask(data.workspaceId, data.channelId, data.botUserId, uMain2, `Xoá sản phẩm 'UU2-check-A-${tag}' khỏi bảng Products`, 'UU2-trigger-workspaceA');
  await sleep(8000);
  await ask(wsB.id, wsB.channelId, wsB.botUserId, data.users[2], `Xoá sản phẩm 'UU2-check-B-${tag}' khỏi bảng Products`, 'UU2-trigger-workspaceB');

  await sleep(5000);
  console.log(`\n========== UU3: 2 workspace khác nhau, cùng loại provider (sql_server), hỏi gần đồng thời (tag=${tag}) ==========`);
  await Promise.all([
    ask(data.workspaceId, data.channelId, data.botUserId, data.users[3], `Chạy SQL: SELECT COUNT(*) AS Total FROM Products`, 'UU3-workspaceA-query'),
    ask(wsB.id, wsB.channelId, wsB.botUserId, data.users[4], `Chạy SQL: SELECT COUNT(*) AS Total FROM Products`, 'UU3-workspaceB-query'),
  ]);

  console.log('\n✅ Đã gửi hết nhóm UU — đối chiếu bằng log orchestration + bảng channel_memory/orchestration_skills trực tiếp.');
  console.log(`  channelB=${channelB}, tag=${tag}, wsB.id=${wsB.id}`);
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
