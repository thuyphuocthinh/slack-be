import http from 'k6/http';
import { check, sleep } from 'k6';

// Hướng dẫn chạy:
// 1. Chạy BE với cờ LOAD_TEST_MODE=true
//    Ví dụ: LOAD_TEST_MODE=true pnpm start:dev orchestration
// 2. Cài đặt k6 (https://k6.io/docs/get-started/installation/)
// 3. Chạy script này: k6 run loadtest/orchestration.k6.js

// ==== CẤU HÌNH LOAD TEST ====
export const options = {
  stages: [
    { duration: '10s', target: 50 },  // Ramp-up lên 50 users trong 10s
    { duration: '30s', target: 50 },  // Giữ mức 50 users trong 30s
    { duration: '10s', target: 200 }, // Spike lên 200 users để test BullMQ queue
    { duration: '10s', target: 0 },   // Ramp-down về 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% request phải hoàn thành dưới 1s
    http_req_failed: ['rate<0.01'],    // Tỉ lệ lỗi phải nhỏ hơn 1%
  },
};

// ==== THÔNG TIN TEST ====
// Thay thế bằng dữ liệu thật ở môi trường local của bác
const API_URL = 'http://localhost:3000/api/v1/messages'; 
const AUTH_TOKEN = 'Bearer YOUR_JWT_TOKEN_HERE';
const CHANNEL_ID = 'YOUR_CHANNEL_ID_HERE';
// Workspace ID (nếu cần thiết cho API)
const WORKSPACE_ID = 'YOUR_WORKSPACE_ID_HERE';

export default function () {
  // Payload giả lập việc gửi 1 tin nhắn tag thẳng @AI để trigger Orchestration
  const payload = JSON.stringify({
    channelId: CHANNEL_ID,
    workspaceId: WORKSPACE_ID,
    content: `[{"insert":"@AI "},{"attributes":{"mention":{"id":"ai-bot"}},"insert":"\uFEFF"},{"insert":" Hãy load test hệ thống bằng mock LLM!\n"}]`,
    textPreview: '@AI Hãy load test hệ thống bằng mock LLM!',
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': AUTH_TOKEN,
    },
  };

  const res = http.post(API_URL, payload, params);

  // K6 check: API phải trả về 2xx
  check(res, {
    'status is 200 or 201': (r) => r.status === 200 || r.status === 201,
  });

  // Nghỉ 1-3s giữa các vòng lặp của user (giả lập thao tác người thật)
  sleep(Math.random() * 2 + 1);
}
