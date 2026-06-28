const autocannon = require('autocannon');

/**
 * LOAD TEST: Concurrent Work Shift UPDATE — đo SERIALIZABLE contention
 *
 * Mô phỏng nhiều manager/user cùng update 1 ca làm việc đồng thời.
 * Đây là scenario trigger SERIALIZABLE retry (error code 40001):
 *   - N connections cùng gọi PUT /work-shifts/:id với data khác nhau
 *   - DB phải serialize → một số transaction retry → đo p99 và timeout
 *
 * ⚠️  SETUP TRƯỚC KHI CHẠY:
 *   1. Tạo 1 work shift cho user test: POST /calendar/work-shifts/bulk-register
 *   2. Paste shift UUID vào SHIFT_ID
 *   3. Paste access token của manager/admin vào ACCESS_TOKEN
 *   4. USER_ID phải là chủ của ca đó
 *
 * KẾT QUẢ KỲ VỌNG:
 *   - Tất cả request phải 2xx (SERIALIZABLE retry transparent với client)
 *   - Non-2xx = 0 nếu withSerializableRetry hoạt động đúng
 *   - p99 < 1000ms ở 50 CCU là acceptable (SERIALIZABLE có overhead)
 *   - Nếu non-2xx > 0 → retry chưa đủ (tăng maxAttempts trong db.util.ts)
 */

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjM2MTExOSwiZXhwIjoxNzgyMzYyOTE5fQ.grCtcDdPpkpZz7R9P_a5Ofq7jG2l5LPXLEubwOpu9nw';
const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';
const USER_ID      = '3c195b53-fee1-4ecc-8d0a-9e7d9238c5bb';

// ID của ca cần update — thay bằng UUID thật
const SHIFT_ID = 'PASTE_VALID_SHIFT_ID_HERE';

// Ngày của ca (phải còn trong lock window)
const WORK_DATE = new Date(Date.now() + 86400_000).toISOString().slice(0, 10); // ngày mai

// Body update — notes thay đổi mỗi request (simulate real concurrent edits)
let requestCount = 0;
const makeBody = () => {
  requestCount++;
  return JSON.stringify({
    userId: USER_ID,
    notes: `concurrent-edit-${requestCount % 100}`,
  });
};

const instance = autocannon(
  {
    url: `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/calendar/work-shifts/${SHIFT_ID}`,
    method: 'PUT',
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: makeBody(),
    // 50 CCU đủ để trigger SERIALIZABLE conflict, không cần cao hơn
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
      console.warn(`🔴 FAIL: ${result.non2xx} request trả lỗi — withSerializableRetry chưa đủ. `
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
