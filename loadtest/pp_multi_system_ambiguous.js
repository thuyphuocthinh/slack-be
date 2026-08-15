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

async function ask(data, user, text, label) {
  console.log(`\n>>> [${label}] "${text}"`);
  const send = await sendAiMessage(data, user, text);
  console.log(`  send status=${send.status}`);
  return send;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u1 = data.users[0]; // PP1
  const u2 = data.users[1]; // PP2
  const u3 = data.users[2]; // PP3
  const tag = crypto.randomUUID().slice(0, 6);

  console.log(`\n========== PP1: 3 bước nối tiếp, mỗi bước mơ hồ (tag=${tag}) ==========`);
  await ask(
    data,
    u1,
    `Lấy danh sách khách VIP, đối chiếu xem ai chưa mua gì lâu rồi, rồi ghi log cảnh báo vào bảng Logs`,
    'PP1',
  );

  await sleep(5000);
  console.log(`\n========== PP2: đối chiếu kho vs báo cáo bán hàng, tự sửa nếu lệch ==========`);
  await ask(
    data,
    u2,
    `Kiểm tra kho hàng bên SQL Server có khớp với báo cáo bán hàng không, cái nào lệch thì sửa lại cho đúng`,
    'PP2',
  );

  await sleep(5000);
  console.log(`\n========== PP3: đọc rồi gửi email — action cuối phải qua HITL ==========`);
  await ask(
    data,
    u3,
    `Gửi email nhắc mấy khách VIP chưa mua lại sang tháng sau`,
    'PP3',
  );

  console.log('\n✅ Đã gửi cả 3 case PP — đối chiếu bằng log orchestration (plan() steps, có tạo checkpoint HITL đúng chỗ không).');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
