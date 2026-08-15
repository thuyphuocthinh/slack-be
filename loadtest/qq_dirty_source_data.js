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
  console.log(`\n>>> [${label}] "${text.slice(0, 150)}"`);
  const send = await sendAiMessage(data, user, text);
  console.log(`  send status=${send.status}`);
  return send;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u1 = data.users[3]; // QQ1
  const u2 = data.users[4]; // QQ2
  const tag = crypto.randomUUID().slice(0, 6);

  console.log(`\n========== QQ1: AVG() với NULL trộn lẫn (tag=${tag}) ==========`);
  await ask(
    data,
    u1,
    `Chèn 5 dòng vào bảng Products (Name, Price, StockQuantity): ('QQ1-${tag}-A', 100, 5), ('QQ1-${tag}-B', NULL, 5), ('QQ1-${tag}-C', 200, 5), ('QQ1-${tag}-D', NULL, 5), ('QQ1-${tag}-E', 300, 5)`,
    'QQ1-seed',
  );
  await sleep(20000);
  await ask(
    data,
    u1,
    `Tính giá trung bình các sản phẩm có tên bắt đầu bằng 'QQ1-${tag}' trong bảng Products`,
    'QQ1-ask',
  );
  await sleep(3000);
  await ask(
    data,
    u1,
    `Chạy SQL: SELECT AVG(Price) AS RealAvg, COUNT(*) AS TotalRows, COUNT(Price) AS NonNullRows FROM Products WHERE Name LIKE 'QQ1-${tag}%'`,
    'QQ1-ground-truth',
  );

  await sleep(5000);
  console.log(`\n========== QQ2: 2 dòng "gần khớp" nhưng khác nhau thật (tag=${tag}) ==========`);
  await ask(
    data,
    u2,
    `Chèn 2 dòng vào bảng Customers (FullName, Email): ('QQ2-${tag}-Nguyen Van A', 'qq2-${tag}-a@test.com'), ('QQ2-${tag}-Nguyen Van A ', 'qq2-${tag}-a2@test.com')`,
    'QQ2-seed',
  );
  await sleep(20000);
  await ask(
    data,
    u2,
    `Khách hàng tên QQ2-${tag}-Nguyen Van A có trong hệ thống chưa`,
    'QQ2-ask',
  );

  console.log('\n✅ Đã gửi nhóm QQ — đối chiếu bằng log orchestration + ground truth SQL riêng.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
