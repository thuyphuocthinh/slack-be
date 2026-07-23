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
// Dùng CHUNG 1 token cho mọi virtual user (bug đã sửa) khiến TẤT CẢ request
// cùng 1 rateLimitKey — dù k6 ramp tới bao nhiêu "users" cũng chỉ tối đa 5
// request/60s THẬT SỰ chạm tới BullMQ queue, còn lại vô nghĩa. Script này đọc
// N user THẬT từ loadtest-users.json, mỗi virtual user (__VU) dùng 1 token
// RIÊNG (round-robin) — trần enqueue-AI hợp lệ tối đa ~ N users x 5 req/60s.
// Với N=10 user hiện có, `sleep()` bên dưới được canh (~24-32s/vòng, ~2-3 VU
// chia nhau 1 token) để MỖI token ở dưới CẢ 2 ngưỡng — ưu tiên đo sạch tầng
// BullMQ/Supervisor thay vì đo tiếng ồn của rate limiter. Muốn spike THẬT
// (VD 200 users) phải tăng N (chạy lại orchestration_full_setup_and_run.js
// với NUM_TEST_USERS lớn hơn — tốn thêm thời gian do rate limit register/login).

const testUsers = new SharedArray('test users', function () {
  const data = JSON.parse(open('./loadtest-users.json'));
  return data.users.map((u) => ({
    token: u.token,
    userId: u.userId,
    workspaceId: data.workspaceId,
    channelId: data.channelId,
    botUserId: data.botUserId,
  }));
});

// ==== CẤU HÌNH LOAD TEST — canh theo N=10 user thật hiện có (xem giải thích ở trên) ====
// Test KÉO DÀI hơn (~4 phút, không phải 60s) dù rate/user không đổi — sleep()
// dài (24-32s/vòng) nghĩa là mỗi VU chỉ lặp được 1-2 lần trong 60s, mẫu quá ít
// để có ý nghĩa thống kê. Rate limit tính theo TỐC ĐỘ/user, không phụ thuộc
// TỔNG thời lượng test, nên kéo dài không vi phạm gì thêm, chỉ cho nhiều mẫu hơn.
export const options = {
  stages: [
    { duration: '15s', target: 15 }, // Ramp-up lên 15 VU (~1.5 VU/token)
    { duration: '3m', target: 15 }, // Giữ mức 15 VU trong 3 phút — đủ mẫu để đo percentile thật
    { duration: '30s', target: 25 }, // Spike lên 25 VU (~2.5 VU/token) để vẫn thấy chút áp lực queue
    { duration: '15s', target: 0 }, // Ramp-down về 0
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
  // "mentions" (field RIÊNG, không phải nhúng trong "content") CHỈ cần khi
  // channel là GROUP (không phải DIRECT với bot) — xem
  // maybeTriggerAiOrchestration(): "!isDirect && !isMentioned) return".
  const body = {
    content: `[{"insert":"@AI "},{"attributes":{"mention":{"id":"ai-bot"}},"insert":"﻿"},{"insert":" Hãy load test hệ thống bằng mock LLM!\n"}]`,
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

  // 24-32s/vòng (không phải 1-3s) — CỐ Ý chậm để MỖI token (chia sẻ bởi ~2-3
  // VU ở đỉnh spike) vẫn ở dưới ngưỡng 5 AI-trigger/60s VÀ 10 message/10s —
  // xem giải thích ở đầu file.
  sleep(24 + Math.random() * 8);
}
