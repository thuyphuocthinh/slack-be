const autocannon = require('autocannon');

/**
 * LOAD TEST: Concurrent Work Shift UPDATE — đo SERIALIZABLE contention
 *
 * Mô phỏng nhiều user cùng update 1 ca làm việc đồng thời.
 * Dùng 4 token khác nhau để bypass rate limit per-user (5 req/60s/user).
 * autocannon xoay vòng qua requests[] → mỗi request dùng token khác nhau.
 *
 * ⚠️  SETUP TRƯỚC KHI CHẠY:
 *   1. Tạo 1 work shift cho user tpt@gmail.com
 *   2. Paste shift UUID vào SHIFT_ID
 *   3. USER_ID phải là chủ của ca (tpt@gmail.com)
 *   4. Các user còn lại phải là ADMIN/MANAGER của workspace để được update
 *
 * KẾT QUẢ KỲ VỌNG:
 *   - Non-2xx = 0 nếu withSerializableRetry hoạt động đúng
 *   - p99 < 1000ms ở 50 CCU là acceptable (SERIALIZABLE có overhead)
 *   - Nếu non-2xx > 0 → retry chưa đủ (tăng maxAttempts trong db.util.ts)
 */

const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';
const USER_ID      = '3c195b53-fee1-4ecc-8d0a-9e7d9238c5bb'; // tpt@gmail.com

const SHIFT_ID = '6588d8bd-bc10-4f52-a7bf-1e6cc511e44b';

// 4 token từ 4 user khác nhau — mỗi user có quota 5 req/60s riêng
const TOKENS = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjY1NDE4NiwiZXhwIjoxNzgyNjU1OTg2fQ.I6xY02VmoxXkxIfqcZR68vVGEcYZ8s7FWw-inTsyQ84', // tpt@gmail.com
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmZTgzODRmNi01NTc5LTRlOTUtOGE0MS1jYWNhNWJhYjI3Y2YiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzZAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3ODI2NTQxODYsImV4cCI6MTc4MjY1NTk4Nn0.QhEV4VAa7b7LuC_T-GoI90_77E4JhdKvHSCZ-PtOsBE', // +6
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiZDkwNGJkZi0yNWE3LTQ1NmYtOTJjNS1mNzBiMWUyMDM4MDgiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzE1QGdtYWlsLmNvbSIsInRva2VuVmVyc2lvbiI6MSwiaWF0IjoxNzgyNjU0MTg2LCJleHAiOjE3ODI2NTU5ODZ9.OKT9UG0uTA1tD_kXN2s4-DkRHG9KB5m_UututaPjIx8', // +15
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1ODBkMTk3MC04ZDM5LTQyYTYtOGY5Yy1hYjBmMTQzMjc5ODEiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzE3QGdtYWlsLmNvbSIsInRva2VuVmVyc2lvbiI6MSwiaWF0IjoxNzgyNjU0MTg3LCJleHAiOjE3ODI2NTU5ODd9.ODorIrs-ZGuL7GZfRQMADL7sy_Z-YB1k114V6D74JDA', // +17
];

// autocannon xoay vòng qua requests[] theo thứ tự → 4 token luân phiên
const requests = TOKENS.map((token, i) => ({
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    userId: USER_ID,
    notes: `concurrent-edit-token-${i}`,
  }),
}));

const instance = autocannon(
  {
    url: `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/calendar/work-shifts/${SHIFT_ID}`,
    method: 'PUT',
    requests,
    connections: 50,
    duration: 30,
    pipelining: 1,
  },
  (err, result) => {
    if (err) { console.error(err); return; }

    console.log('\n--- RESULTS: CONCURRENT WORK SHIFT UPDATE (SERIALIZABLE CONTENTION) ---');
    console.log(`Requests/sec (avg):  ${result.requests.average}`);
    console.log(`Latency p50:         ${result.latency.p50} ms`);
    console.log(`Latency p97.5:       ${result.latency.p97_5} ms`);
    console.log(`Latency p99:         ${result.latency.p99} ms`);
    console.log(`Success (2xx):       ${result['2xx']}`);
    console.log(`Errors (non-2xx):    ${result.non2xx}`);
    console.log(`Timeouts:            ${result.timeouts}`);

    const total = result['2xx'] + result.non2xx;
    const errorRate = total > 0 ? ((result.non2xx / total) * 100).toFixed(1) : '0.0';
    console.log(`Error rate:          ${errorRate}%`);

    if (result.non2xx > 0) {
      console.warn(`🔴 FAIL: ${result.non2xx} lỗi — withSerializableRetry chưa đủ hoặc user thiếu quyền. `
        + `Tăng maxAttempts trong libs/common/src/utils/db.util.ts.`);
    } else if (result.timeouts > 0) {
      console.warn('🔴 CRITICAL: Timeout — SERIALIZABLE lock gây queue quá dài.');
    } else if (result.latency.p99 > 2000) {
      console.warn('🟠 WARNING: p99 > 2000ms — retry backoff quá dài hoặc DB thiếu index.');
    } else if (result.latency.p99 > 1000) {
      console.warn('🟡 WARNING: p99 > 1000ms — SERIALIZABLE overhead cao, xem xét REPEATABLE READ.');
    } else {
      console.log('✅ PASS: 0 lỗi, p99 < 1000ms với 50 CCU concurrent update.');
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });
