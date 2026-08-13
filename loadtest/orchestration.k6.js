import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

// Hướng dẫn chạy (localhost):
// 1. docker-compose -f docker-compose.dev.yml up -d   (Postgres/Redis/BullMQ)
// 2. Mở CÁC terminal riêng, chạy từng app cần cho luồng AI trigger:
//    LOAD_TEST_MODE=true pnpm start:dev api-gateway
//    LOAD_TEST_MODE=true pnpm start:dev message
//    LOAD_TEST_MODE=true pnpm start:dev orchestration
//    LOAD_TEST_MODE=true pnpm start:dev socket-gateway
// 3. Chạy 1 LẦN: node loadtest/orchestration_full_setup_and_run.js
//    (tự tạo N user test + login + join workspace/channel, ghi ra
//    loadtest/loadtest-users.json — xem chi tiết trong file đó). Token có
//    TTL giới hạn, hết hạn thì chạy lại script này để lấy token mới.
// 4. Cài k6 (https://k6.io/docs/get-started/installation/) — đã có sẵn trên máy này.
// 5. Chạy: k6 run loadtest/orchestration.k6.js
//
// ==== VÌ SAO CẦN NHIỀU USER (không dùng 1 token duy nhất) ====
// 2 lớp rate limit CHỒNG NHAU, cả 2 đều THEO TỪNG USER — phải né CẢ 2 lớp,
// không chỉ 1:
//   (a) message.controller.ts: @RateLimit({limit:10, window:10}) — CHẶN NGAY
//       ở tầng API Gateway (trả 429), trước cả khi vào logic AI-trigger.
//   (b) message.service.ts maybeTriggerAiOrchestration(): tối đa 5 lượt
//       AI-trigger/60s/user (CACHE.MESSAGE.KEYS.AI_TRIGGER_RATE_LIMIT) — nếu
//       vượt, message vẫn tạo thành công (KHÔNG 429) nhưng bot chỉ trả lời
//       "Bạn đang hỏi hơi nhanh..." — KHÔNG hề enqueue vào BullMQ.
// (b) LUÔN chặt hơn (a): 5/60s ~ 5/60s < 10/10s ~ 60/60s — công thức sleep()
// bên dưới chỉ cần canh theo (b), (a) tự động thoả mãn theo.
//
// Script đọc N user THẬT từ loadtest-users.json, mỗi virtual user (__VU) dùng
// 1 token RIÊNG (round-robin) — trần enqueue-AI hợp lệ tối đa ~ N user × 5
// req/60s. `MAX_VUS`/`MIN_SLEEP_SECONDS` bên dưới tự TÍNH LẠI theo N thật đang
// có trong file (KHÔNG hardcode cho 1 N cụ thể) — chạy đúng dù N=10 hay N=100.

// USERS_FILE (env, tuỳ chọn) — trỏ sang loadtest-users-bulk.json (do
// seed_bulk_users.js sinh ra) khi ramp quy mô lớn (load-test-scale-plan.md
// Pha 2), mặc định vẫn dùng file 10-user cũ nếu không set.
const testUsers = new SharedArray('test users', function () {
  const data = JSON.parse(open(__ENV.USERS_FILE || './loadtest-users.json'));
  return data.users.map((u) => ({
    token: u.token,
    userId: u.userId,
    workspaceId: data.workspaceId,
    channelId: data.channelId,
    botUserId: data.botUserId,
  }));
});

// ==== CẤU HÌNH LOAD TEST — TỰ TÍNH theo N user thật (đọc từ loadtest-users.json) ====
const N = testUsers.length;
if (N === 0) {
  throw new Error(
    'loadtest-users.json rỗng — chạy node loadtest/orchestration_full_setup_and_run.js trước.',
  );
}

// load-test-scale-plan.md Pha 2 — cap ở 1000 (mốc trần cao nhất của kế
// hoạch), không phải 120 như bản gốc (quá thấp để ramp thật tới 300/1000).
// Oversubscription (nhiều VU chia sẻ 1 token) vẫn OK ở mức vừa phải — phản
// ánh đúng "1 user gửi nhiều tin liên tục".
const MAX_VUS = Math.min(N, 1000);
const HOLD_VUS = Math.max(1, Math.floor(MAX_VUS * 0.6));
// Đỉnh spike, mỗi token bị chia sẻ bởi tối đa ceil(MAX_VUS/N) VU cùng lúc.
const VUS_PER_TOKEN_AT_PEAK = Math.ceil(MAX_VUS / N);
// Rate limit (b) đòi mỗi token giãn tối thiểu 60/5=12s giữa 2 lần gọi — nhân
// thêm số VU chia sẻ CÙNG 1 token, +20% biên an toàn (jitter/network).
const MIN_SLEEP_SECONDS = VUS_PER_TOKEN_AT_PEAK * 12 * 1.2;

// Test KÉO DÀI ~4 phút (không phải 60s) dù rate/user không đổi — sleep() dài
// nghĩa là mỗi VU chỉ lặp được vài lần/phút, cần đủ thời lượng mới có mẫu ý
// nghĩa thống kê. Rate limit tính theo TỐC ĐỘ/user, không phụ thuộc TỔNG thời
// lượng test, nên kéo dài không vi phạm gì thêm, chỉ cho nhiều mẫu hơn.
export const options = {
  stages: [
    { duration: '20s', target: HOLD_VUS }, // Ramp-up
    { duration: '3m', target: HOLD_VUS }, // Giữ mức — đủ mẫu để đo percentile thật
    { duration: '30s', target: MAX_VUS }, // Spike — vẫn thấy áp lực queue
    { duration: '20s', target: 0 }, // Ramp-down về 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% request phải hoàn thành dưới 1s
    http_req_failed: ['rate<0.01'], // Tỉ lệ lỗi phải nhỏ hơn 1%
  },
};

export default function () {
  // Rải virtual user hiện tại (__VU, đếm từ 1) qua từng user test theo vòng
  // tròn — mỗi user test chỉ chịu 1 phần nhỏ traffic, không dồn hết vào 1 người.
  const u = testUsers[(__VU - 1) % testUsers.length];
  const API_URL = `http://localhost:3000/api/v1/workspaces/${u.workspaceId}/channels/${u.channelId}/messages`;

  // Payload giả lập việc gửi 1 tin nhắn tag thẳng @AI để trigger Orchestration.
  // FE thật dùng Tiptap (editor.getJSON()), KHÔNG phải Quill Delta cũ — xem
  // bug đã phát hiện 2026-08-11 (extractContentText() chỉ traverse cây
  // Tiptap). Không ảnh hưởng khi LOAD_TEST_MODE=true (mock không đọc
  // originalPrompt) nhưng sửa cho đúng để script còn dùng lại được với LLM
  // thật. "mentions" (field RIÊNG, không phải nhúng trong "content") CHỈ cần
  // khi channel là GROUP (không phải DIRECT với bot) — xem
  // maybeTriggerAiOrchestration(): "!isDirect && !isMentioned) return".
  const body = {
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            ...(u.botUserId ? [{ type: 'mention', attrs: { id: u.botUserId } }] : []),
            { type: 'text', text: ' Hãy load test hệ thống bằng mock LLM!' },
          ],
        },
      ],
    },
  };
  if (u.botUserId) {
    body.mentions = [u.botUserId];
  }

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${u.token}`,
    },
  };

  const res = http.post(API_URL, JSON.stringify(body), params);

  // K6 check: API phải trả về 2xx
  const isSuccess = check(res, {
    'status is 200 or 201': (r) => r.status === 200 || r.status === 201,
  });

  if (!isSuccess) {
    console.log(`Failed with status ${res.status}: ${res.body}`);
  }

  // CỐ Ý chậm (không phải 1-3s như user thật gõ tay) — MIN_SLEEP_SECONDS tự
  // tính theo N thật (xem đầu file) để MỖI token luôn ở dưới ngưỡng rate limit
  // chặt nhất (AI-trigger 5/60s/user), dù N=10 hay N=100.
  sleep(MIN_SLEEP_SECONDS + Math.random() * (MIN_SLEEP_SECONDS * 0.3));
}
