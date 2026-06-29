const autocannon = require('autocannon');

/**
 * LOAD TEST: Leave Request Review (Approve/Reject) — pessimistic_write contention
 *
 * Mô phỏng manager duyệt nhiều đơn nghỉ phép đồng loạt.
 * Critical path:
 *   - pessimistic_write lock trên leave_balance (1 row/user/year)
 *   - DELETE work_shifts trong range nghỉ
 *   - UPDATE calendar_requests status
 *
 * ⚠️  LƯU Ý QUAN TRỌNG:
 *   - Mỗi REQUEST_ID chỉ được duyệt 1 lần (status → APPROVED/REJECTED)
 *   - Lần chạy tiếp theo cần REQUEST_IDs mới (tạo qua calendar_leave_request_create.js)
 *   - Cần nhiều REQUEST_IDs khác nhau để test concurrency thật
 *   - Dùng 4 token khác nhau để bypass rate limit
 *
 * SETUP:
 *   1. Chạy calendar_leave_request_create.js nhiều lần với DATE_OFFSET_DAYS khác nhau
 *   2. Lấy request IDs từ DB: SELECT id FROM calendar_requests WHERE status='PENDING' LIMIT 20
 *   3. Điền vào REQUEST_IDS bên dưới
 *
 * KẾT QUẢ KỲ VỌNG:
 *   - 2xx = số lượng REQUEST_IDS (mỗi đơn được duyệt đúng 1 lần)
 *   - p99 < 800ms (có write lock + shift deletion)
 *   - 0 timeout
 */

const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';

const TOKENS = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjY1NTM5MywiZXhwIjoxNzgyNjU3MTkzfQ.kqs5Ln-W3lgTeNU6KyTtUYI1UEiMn1zOKoXGhqqYvcM', // tpt@gmail.com
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmZTgzODRmNi01NTc5LTRlOTUtOGE0MS1jYWNhNWJhYjI3Y2YiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzZAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3ODI2NTUzOTMsImV4cCI6MTc4MjY1NzE5M30.Mqbyv7x5M1vt8BP121iVQCGMySsycbXVQZ7QWjlvVk0', // +6
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiZDkwNGJkZi0yNWE3LTQ1NmYtOTJjNS1mNzBiMWUyMDM4MDgiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzE1QGdtYWlsLmNvbSIsInRva2VuVmVyc2lvbiI6MSwiaWF0IjoxNzgyNjU1MzkzLCJleHAiOjE3ODI2NTcxOTN9.nnDXRHZHBGD9qyPQXlHY3PG1_iC4y7Z4uKzGgDoqWrs', // +15
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1ODBkMTk3MC04ZDM5LTQyYTYtOGY5Yy1hYjBmMTQzMjc5ODEiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzE3QGdtYWlsLmNvbSIsInRva2VuVmVyc2lvbiI6MSwiaWF0IjoxNzgyNjU1MzkzLCJleHAiOjE3ODI2NTcxOTN9.r678sOj4j1eBgvXUXr2Wnw5UpD7nBt1P-FSqIW00hu8', // +17
];

// Điền REQUEST_IDs từ DB — cần ít nhất 4 IDs để test concurrency
const REQUEST_IDS = [
  '37d96940-8130-4f75-9420-ac34ffa1953f', // tpt@gmail.com
  '58f96053-e6e4-4940-8480-4f540fd7a035', // +6
  'fbb55033-6d64-4fc5-b138-b350fcdbf26e', // +15
];

// Mỗi request dùng token + requestId khác nhau
const requests = REQUEST_IDS.map((requestId, i) => ({
  path: `/api/v1/workspaces/${WORKSPACE_ID}/calendar/requests/${requestId}/review`,
  headers: {
    authorization: `Bearer ${TOKENS[i % TOKENS.length]}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ action: 'APPROVE' }),
  method: 'PUT',
}));

const instance = autocannon(
  {
    url: `https://api.tpt.io.vn`,
    requests,
    connections: Math.min(REQUEST_IDS.length, 20),
    duration: 30,
    pipelining: 1,
  },
  (err, result) => {
    if (err) { console.error(err); return; }

    console.log('\n--- RESULTS: LEAVE REVIEW (APPROVE) STRESS TEST ---');
    console.log(`Requests/sec (avg):  ${result.requests.average}`);
    console.log(`Latency p50:         ${result.latency.p50} ms`);
    console.log(`Latency p97.5:       ${result.latency.p97_5} ms`);
    console.log(`Latency p99:         ${result.latency.p99} ms`);
    console.log(`Success (2xx):       ${result['2xx']}`);
    console.log(`Errors (non-2xx):    ${result.non2xx}`);
    console.log(`Timeouts:            ${result.timeouts}`);

    if (result.timeouts > 0) {
      console.warn('🔴 CRITICAL: Timeout — leave_balance pessimistic_write lock hoặc shift deletion quá chậm.');
    } else if (result['2xx'] === 0) {
      console.warn('🔴 FAIL: 0 success — kiểm tra: token hết hạn, request IDs sai, user thiếu quyền MANAGER/ADMIN.');
    } else if (result.latency.p99 > 2000) {
      console.warn('🟠 WARNING: p99 > 2s — leave_balance lock đang gây queue. Xem xét optimistic locking.');
    } else if (result.latency.p99 > 800) {
      console.warn('🟡 WARNING: p99 > 800ms — shift deletion trong range có thể chậm nếu nhiều ca bị xóa.');
    } else {
      console.log('✅ PASS: p99 < 800ms — leave approval pipeline hoạt động tốt.');
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });
