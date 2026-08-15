/**
 * plan.md nhóm JJ — race condition trên state dùng chung trong CÙNG 1 channel.
 * Khác load test (mỗi user 1 turn độc lập) — nhóm này cố tình cho 2 user CÙNG
 * channel tranh chấp CÙNG 1 dữ liệu GẦN NHƯ ĐỒNG THỜI (Promise.all, không tuần tự).
 *
 * JJ1: 2 user cùng lúc "ghi nhớ mã khách VIP" nhưng khác giá trị — hỏi lại phải
 *      nhất quán (1 trong 2 giá trị), không lẫn lộn/bịa giá trị thứ 3.
 * JJ3: 2 user cùng lúc đọc-rồi-trừ tồn kho CÙNG 1 sản phẩm — đối chiếu bằng 1
 *      SELECT đọc riêng SAU CÙNG (không tin câu văn tổng hợp của AI ở 2 lượt
 *      trừ kho) xem có bị lost-update không (giảm đúng 2, không phải 1).
 *      Products nằm ở SQL Server (qua MCP), KHÔNG PHẢI Postgres — không có kết
 *      nối trực tiếp (mssql) từ script, nên seed/verify đều đi qua chính AI
 *      (đúng pattern AA1 đã dùng) — SELECT riêng cuối cùng vẫn đáng tin hơn
 *      hẳn câu văn tổng hợp, vì đó là 1 tool call ĐỌC đơn giản, không cần suy
 *      luận/tổng hợp gì thêm.
 * (JJ2 — 2 checkpoint approval cùng lúc — cần thao tác tay Approve, xem
 *  hướng dẫn in ra cuối script, không tự động hoá được phần duyệt.)
 *
 * Chạy: node loadtest/jj_race_condition.js
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

async function waitForFinalAnswer(data, token, afterIso, maxWaitMs = 60000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    await sleep(2500);
    const res = await request(
      'GET',
      `/workspaces/${data.workspaceId}/channels/${data.channelId}/messages?limit=15`,
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

async function ask(data, user, text) {
  const t0 = new Date().toISOString();
  const send = await sendAiMessage(data, user, text);
  if (send.status !== 201) return { send, reply: null };
  const reply = await waitForFinalAnswer(data, user.token, t0);
  return { send, reply };
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const uA = data.users[7]; // loadtest_8
  const uB = data.users[8]; // loadtest_9

  console.log('\n========== JJ1: 2 user CÙNG LÚC ghi nhớ CÙNG 1 fact, KHÁC giá trị ==========');
  const t0 = new Date().toISOString();
  const [sendA, sendB] = await Promise.all([
    sendAiMessage(data, uA, 'Ghi nhớ giúp tôi: mã khách VIP tranh chấp là KH-AAAA'),
    sendAiMessage(data, uB, 'Ghi nhớ giúp tôi: mã khách VIP tranh chấp là KH-BBBB'),
  ]);
  console.log('  send A status:', sendA.status, '| send B status:', sendB.status);
  await sleep(8000);
  const { reply: recall } = await ask(data, uA, 'Mã khách VIP tranh chấp là gì nhỉ?');
  console.log('  recall reply:', recall ? String(recall.content).slice(0, 250) : '(timeout)');
  const hasA = recall && String(recall.content).includes('KH-AAAA');
  const hasB = recall && String(recall.content).includes('KH-BBBB');
  console.log(
    `  → JJ1: chứa KH-AAAA=${hasA}, chứa KH-BBBB=${hasB} — ${
      (hasA || hasB) && !(hasA && hasB)
        ? 'PASS (nhất quán 1 giá trị)'
        : 'FAIL (lẫn cả 2 hoặc không giá trị nào — cần xem log)'
    }`,
  );

  console.log('\n========== JJ3: 2 user CÙNG LÚC đọc-rồi-trừ tồn kho CÙNG 1 sản phẩm ==========');
  console.log('  Dọn + seed sản phẩm "JJ3 Race Product" tồn kho=50 (qua chính AI, giống pattern AA1)...');
  await ask(data, uA, "Xoá tất cả sản phẩm có tên 'JJ3 Race Product' trong bảng Products nếu có, không cần hỏi lại vì đây là dữ liệu test");
  await sleep(3000);
  const seed = await ask(
    data,
    uA,
    "Chèn 1 dòng mới vào bảng Products: tên 'JJ3 Race Product', giá 100, tồn kho (StockQuantity) đúng 50",
  );
  console.log('  seed reply:', seed.reply ? String(seed.reply.content).slice(0, 200) : '(timeout)');
  await sleep(3000);

  const [resA, resB] = await Promise.all([
    ask(data, uA, "Lấy tồn kho sản phẩm 'JJ3 Race Product' hiện tại rồi trừ đi 1, cập nhật lại vào bảng Products"),
    ask(data, uB, "Lấy tồn kho sản phẩm 'JJ3 Race Product' hiện tại rồi trừ đi 1, cập nhật lại vào bảng Products"),
  ]);
  console.log('  A reply:', resA.reply ? String(resA.reply.content).slice(0, 150) : '(timeout)');
  console.log('  B reply:', resB.reply ? String(resB.reply.content).slice(0, 150) : '(timeout)');
  await sleep(5000);

  // SELECT riêng, ĐƠN GIẢN, sau cùng — đáng tin hơn câu văn tổng hợp của 2 lượt trừ kho ở trên.
  const verify = await ask(data, uA, "Cho tôi biết CHÍNH XÁC giá trị StockQuantity hiện tại của sản phẩm 'JJ3 Race Product' trong bảng Products, chỉ trả về con số");
  console.log('  verify reply (SELECT riêng, đáng tin nhất):', verify.reply ? String(verify.reply.content).slice(0, 200) : '(timeout)');
  console.log('  → Tồn kho ban đầu: 50. Kỳ vọng SAU 2 lần trừ đồng thời: 48. Nếu ra 49 → lost-update (đọc-cũ-ghi-đè). Đối chiếu thêm bằng grep log orchestration cho chắc (2 dòng UPDATE thật có chạy đủ không).');

  console.log('\n========== JJ2 (thao tác tay) ==========');
  console.log('  Gửi 2 yêu cầu cần duyệt gần như đồng thời ở CÙNG channel để test cô lập checkpoint:');
  console.log('  - User A: "Xoá tất cả sản phẩm có giá dưới 5 trong bảng Products"');
  console.log('  - User B: "Cập nhật giá sản phẩm JJ3 Race Product thành 999"');
  console.log('  Rồi vào FE/API bấm Approve ĐÚNG 1 trong 2 checkpoint, kiểm tra checkpoint còn lại vẫn "pending" — không tự động hoá được bước bấm Approve nên để làm tay.');

  console.log('\n✅ Xong JJ1/JJ3 (tự động). JJ2 cần thao tác tay theo hướng dẫn trên.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
