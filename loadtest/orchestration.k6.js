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
    { duration: '10s', target: 50 }, // Ramp-up lên 50 users trong 10s
    { duration: '30s', target: 50 }, // Giữ mức 50 users trong 30s
    { duration: '10s', target: 200 }, // Spike lên 200 users để test BullMQ queue
    { duration: '10s', target: 0 }, // Ramp-down về 0
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'], // 95% request phải hoàn thành dưới 1s
    http_req_failed: ['rate<0.01'], // Tỉ lệ lỗi phải nhỏ hơn 1%
  },
};

const WORKSPACE_ID = '16c2e327-af40-457c-b361-245c86cf5198';
const CHANNEL_ID = 'ccb7e0f6-35e3-4ce0-b30c-8c1dedd05208';
const AUTH_TOKEN =
  'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MzUwNDI4NywiZXhwIjoxNzgzNTA2MDg3fQ.90hi5HEAK0XG0VNoqj6jY8Oqe99f9Yb3hNF0QhoCepg';
const API_URL = `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID}/messages`;

export default function () {
  // Payload giả lập việc gửi 1 tin nhắn tag thẳng @AI để trigger Orchestration
  const payload = JSON.stringify({
    content: `[{"insert":"@AI "},{"attributes":{"mention":{"id":"ai-bot"}},"insert":"\uFEFF"},{"insert":" Hãy load test hệ thống bằng mock LLM!\n"}]`,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: AUTH_TOKEN,
    },
  };

  const res = http.post(API_URL, payload, params);

  // K6 check: API phải trả về 2xx
  const isSuccess = check(res, {
    'status is 200 or 201': (r) => r.status === 200 || r.status === 201,
  });

  if (!isSuccess) {
    console.log(`Failed with status ${res.status}: ${res.body}`);
  }

  // Nghỉ 1-3s giữa các vòng lặp của user (giả lập thao tác người thật)
  sleep(Math.random() * 2 + 1);
}
