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
  const u = data.users[5];
  const tag = crypto.randomUUID().slice(0, 6);
  const table = `OrdersQQ3_${tag}`;

  console.log(`\n========== QQ3: soft-delete — bảng ${table} ==========`);
  await ask(
    data,
    u,
    `Tạo bảng ${table} (OrderId INT IDENTITY(1,1) PRIMARY KEY, CustomerName NVARCHAR(50), IsDeleted BIT DEFAULT 0) trong SQL Server nếu chưa có, rồi chèn đúng 5 dòng: ('Cust1', 0), ('Cust2', 0), ('Cust3', 1), ('Cust4', 0), ('Cust5', 1)`,
    'QQ3-seed',
  );

  console.log('\n✅ Đã gửi QQ3-seed — CẦN duyệt DDL, kiểm tra checkpoint rồi approve thủ công, sau đó hỏi "Đếm số đơn hàng hiện có trong bảng ' + table + '"');
  console.log(`  table=${table}`);
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
