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
  const uA = data.users[5];
  const uB = data.users[6];
  const uC = data.users[7];
  const tag = crypto.randomUUID().slice(0, 6);

  console.log(`\n========== SS1: 2 cách gọi khác nhau tới CÙNG 1 sản phẩm, đồng thời (tag=${tag}) ==========`);
  await ask(
    data,
    uA,
    `Chèn 1 dòng vào bảng Products (Name, Price, StockQuantity): ('Ao thun xanh size M SS1-${tag}', 100, 50)`,
    'SS1-seed',
  );
  await sleep(20000);
  const productIdReply = await ask(
    data,
    uA,
    `Chạy SQL: SELECT ProductId FROM Products WHERE Name = 'Ao thun xanh size M SS1-${tag}'`,
    'SS1-get-id',
  );
  await sleep(8000);

  console.log(`\n  [${new Date().toISOString()}] Gửi ĐỒNG THỜI: A dùng TÊN, B dùng SQL trực tiếp theo tên (mô phỏng "mã") để trừ tồn kho cùng lúc...`);
  const t0 = new Date().toISOString();
  await Promise.all([
    sendAiMessage(data, uA, `Trừ tồn kho sản phẩm ao thun xanh size M SS1-${tag} đi 1`),
    sendAiMessage(data, uB, `Chạy SQL cập nhật: UPDATE Products SET StockQuantity = StockQuantity - 1 WHERE Name = 'Ao thun xanh size M SS1-${tag}'`),
  ]);
  console.log(`  đã gửi cả 2 lúc ${t0}`);

  await sleep(5000);
  console.log(`\n========== SS2: 2 sản phẩm tên GẦN GIỐNG, yêu cầu mơ hồ không rõ size (tag=${tag}) ==========`);
  await ask(
    data,
    uC,
    `Chèn 2 dòng vào bảng Products (Name, Price, StockQuantity): ('Ao thun xanh size M SS2-${tag}', 100, 20), ('Ao thun xanh size L SS2-${tag}', 100, 20)`,
    'SS2-seed',
  );
  await sleep(20000);
  await ask(
    data,
    uC,
    `Trừ tồn kho ao thun xanh SS2-${tag} đi 1`,
    'SS2-ambiguous-trigger',
  );

  console.log('\n✅ Đã gửi nhóm SS — đối chiếu bằng log orchestration + SELECT trực tiếp tồn kho cuối cùng (cả SS1 và SS2 đều cần duyệt HITL, nhớ approve/reject đúng).');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
