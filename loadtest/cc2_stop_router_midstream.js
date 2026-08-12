/**
 * Nhóm CC — CC2: cắt LLM provider giữa lúc ĐANG STREAM chữ ra, kiểm tra KHÔNG
 * tự retry (vì đã streamedAnything=true theo comment code), trả lời dừng
 * nửa chừng, không lặp lại/không tự bịa tiếp.
 *
 * AI_ROUTER_URL=http://localhost:20128/v1 trỏ vào container Docker
 * `slack-9router-dev` — dừng NGAY container này lúc đang stream để giả lập
 * provider chết giữa chừng (không cần công cụ mạng riêng).
 *
 * Chạy (MAI, không chạy hôm nay): node loadtest/cc2_stop_router_midstream.js
 * SAU KHI CHẠY XONG nhớ: docker start slack-9router-dev (để không ảnh hưởng
 * các test group khác cần LLM thật).
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
const ROUTER_CONTAINER = 'slack-9router-dev';
// Ngưỡng độ dài coi là "đã bắt đầu stream ra chữ thật" (không phải placeholder rỗng)
const STREAM_STARTED_MIN_LEN = 20;

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

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u = data.users[0];

  console.log('\n=== CC2: gửi câu KHÔNG CẦN TOOL, buộc trả lời DÀI (nhiều token) để có thời gian bắt stream đang chạy ===');
  const sendAt = new Date().toISOString();
  await sendAiMessage(
    data,
    u,
    'Xem toàn bộ dữ liệu bảng Products rồi viết 1 bài phân tích dài ít nhất 500 từ về xu hướng giá, chia nhiều đoạn chi tiết',
  );

  // Không thể bắt "đang stream" bằng cách poll nội dung message trong DB — đã
  // xác nhận qua thực nghiệm 2026-08-12: DB CHỈ lưu content 1 LẦN lúc trả lời
  // xong (không tăng dần theo từng token dù client FE nhận qua WebSocket
  // tăng dần) — poll DB không thấy bước trung gian nào. Dùng delay CỐ ĐỊNH
  // ngắn (canh theo latency thật quan sát được: generateStructured() ~1s,
  // token đầu của câu trả lời dài thường bắt đầu sau ~1.5-2.5s) để đảm bảo
  // cắt ĐANG LÚC model sinh chữ, trước khi kịp lưu xong toàn bộ.
  const STREAM_CUT_DELAY_MS = 4800; // plan() ~1s + tool call thật ~1-2s + bắt đầu synthesize/stream câu trả lời dài
  console.log(`  Đợi ${STREAM_CUT_DELAY_MS}ms cố định (ước lượng model đang sinh chữ giữa câu, chưa lưu xong) rồi cắt ngay...`);
  await sleep(STREAM_CUT_DELAY_MS);
  const contentBeforeCut = '(không đọc được — DB chỉ lưu lúc xong, xem log orchestration để biết model đã sinh bao nhiêu token trước khi bị cắt)';

  console.log(`  >>> docker stop ${ROUTER_CONTAINER} NGAY BÂY GIỜ (giả lập LLM provider chết giữa lúc stream) ...`);
  execSync(`docker stop ${ROUTER_CONTAINER}`, { encoding: 'utf8' });
  const cutAt = Date.now();

  console.log('  Đợi 15s xem nội dung có dừng hẳn không (KHÔNG được tự nối tiếp/lặp lại)...');
  await sleep(15000);
  const afterCut = await getLatestBotMessage(data, u.token);
  console.log('  Nội dung SAU khi cắt provider:', afterCut ? String(afterCut.content).slice(0, 400) : '(không thấy)');
  console.log(`  So sánh: nội dung TRƯỚC cắt (${contentBeforeCut.length} ký tự) vs SAU cắt (${afterCut ? String(afterCut.content).length : 0} ký tự)`);
  console.log('  Kỳ vọng: nội dung dừng lại, KHÔNG lặp lại từ đầu, KHÔNG tự bịa thêm để hoàn thành câu trả lời.');

  console.log(`\n  >>> docker start ${ROUTER_CONTAINER} (khôi phục cho các test khác) ...`);
  execSync(`docker start ${ROUTER_CONTAINER}`, { encoding: 'utf8' });
  console.log('  Đợi router healthy lại...');
  await sleep(5000);

  console.log('\n✅ Xong CC2.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
