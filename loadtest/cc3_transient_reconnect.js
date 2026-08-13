/**
 * Nhóm CC — CC3: giả lập DB tạm mất kết nối ĐÚNG 2 LẦN liên tiếp, kiểm tra
 * `MAX_TRANSIENT_TOOL_RETRY_ATTEMPTS=2` — retry đúng 2 lần rồi dừng, báo lỗi
 * thật, không lặp vô hạn/không âm thầm bỏ qua.
 *
 * mcp_server_mssql là container Docker thật (mcr.microsoft.com/mssql/server)
 * — dùng `docker stop`/`docker start` để giả lập mất/có kết nối, KHÔNG cần
 * công cụ mạng riêng.
 *
 * LƯU Ý TIMING (cần canh tay khi chạy thật, số dưới đây là ước lượng dựa
 * theo TRANSIENT_RETRY_BACKOFF_MS=500 + độ trễ LLM/round thực tế quan sát
 * được trong session hôm nay, ~2-8s/round) — có thể cần tinh chỉnh:
 *   1. Gửi tin ngay khi mssql đang DOWN (để lần gọi ĐẦU TIÊN đã fail).
 *   2. docker start mssql sau ~2s (kịp cho lần retry 1 vẫn thấy DOWN).
 *   3. docker stop mssql lại ngay sau ~1s rồi docker start lại sau ~2s nữa
 *      (kịp cho lần retry 2 cũng thấy DOWN 1 lần, rồi lần thử thứ 3 mới OK
 *      hoặc đã hết attempts).
 * Nếu tool đã trả lỗi rồi mới lên lại thì coi như "quan sát được retry đúng
 * 2 lần rồi dừng" — vẫn là kết quả hợp lệ (thậm chí RÕ hơn quan sát này).
 *
 * Chạy (MAI, không chạy hôm nay): node loadtest/cc3_transient_reconnect.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PREFIX = '/api/v1';
const MSSQL_CONTAINER = 'mcp_server_mssql';

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

async function getLatestBotMessage(data, token) {
  const res = await request(
    'GET',
    `/workspaces/${data.workspaceId}/channels/${data.channelId}/messages?limit=5`,
    null,
    token,
  );
  const msgs = res.body?.data?.messages ?? [];
  return msgs.find((m) => m.sender?.isBot) ?? null;
}

async function waitContainerHealthy(container, maxWaitMs = 30000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const out = execSync(`docker inspect --format="{{.State.Health.Status}}" ${container}`, { encoding: 'utf8' }).trim();
      if (out === 'healthy') return true;
    } catch {}
    await sleep(1000);
  }
  return false;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u = data.users[0];

  console.log('\n=== CC3: dừng mssql, gửi tin NGAY, rồi bật/tắt 2 lần theo timing ước lượng ===');
  console.log(`  >>> docker stop ${MSSQL_CONTAINER} ...`);
  execSync(`docker stop ${MSSQL_CONTAINER}`, { encoding: 'utf8' });

  await sendAiMessage(data, u, "Cập nhật giá bảng Products, sản phẩm Test Product thành 500");
  console.log('  Đã gửi tin lúc mssql đang DOWN.');

  await sleep(2000);
  console.log(`  >>> docker start ${MSSQL_CONTAINER} (mở lại lần 1, ngắn) ...`);
  execSync(`docker start ${MSSQL_CONTAINER}`, { encoding: 'utf8' });
  await sleep(1000);
  console.log(`  >>> docker stop ${MSSQL_CONTAINER} (đóng lại lần 2) ...`);
  execSync(`docker stop ${MSSQL_CONTAINER}`, { encoding: 'utf8' });
  await sleep(2000);
  console.log(`  >>> docker start ${MSSQL_CONTAINER} (mở lại LẦN CUỐI, để healthy ổn định) ...`);
  execSync(`docker start ${MSSQL_CONTAINER}`, { encoding: 'utf8' });
  const healthy = await waitContainerHealthy(MSSQL_CONTAINER);
  console.log('  mssql healthy trở lại:', healthy);

  console.log('\n=== Đợi kết quả cuối, đối chiếu log orchestration để đếm số lần retry thật ===');
  const deadline = Date.now() + 60000;
  let finalMsg = null;
  while (Date.now() < deadline) {
    const msg = await getLatestBotMessage(data, u.token);
    if (msg && typeof msg.content === 'string' && msg.content !== '🤖 Đang xử lý...') {
      finalMsg = msg;
      break;
    }
    await sleep(3000);
  }
  console.log('  Kết quả cuối:', finalMsg ? String(finalMsg.content).slice(0, 300) : '(timeout)');
  console.log('  ĐỐI CHIẾU THÊM: pm2 logs orchestration | grep -i "MAX_TRANSIENT\\|attempt\\|reconnect" để đếm CHÍNH XÁC số lần retry thật đã xảy ra.');

  console.log('\n✅ Xong CC3.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
