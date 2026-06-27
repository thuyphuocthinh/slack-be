const autocannon = require('autocannon');

/**
 * LOAD TEST: My Lock Status (Read-Heavy)
 *
 * Mô phỏng 500 user đồng loạt xem trạng thái khóa lịch của tháng hiện tại.
 * Được gọi mỗi khi user mở trang lịch cá nhân.
 *
 * Query plan:
 *   SELECT * FROM calendar_user_locks
 *   WHERE userId=? AND workspaceId=? AND targetMonth=?
 *   (IDX_USER_LOCK — unique index, single row lookup)
 *
 * Đây là endpoint đơn giản nhất — nếu p99 > 100ms thì có vấn đề nghiêm trọng.
 *
 * KẾT QUẢ KỲ VỌNG:
 *   - p99 < 100ms (single unique index lookup)
 *   - 0 timeout
 *   - req/s > 5000
 */

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjM2MTExOSwiZXhwIjoxNzgyMzYyOTE5fQ.grCtcDdPpkpZz7R9P_a5Ofq7jG2l5LPXLEubwOpu9nw';
const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';

// targetMonth mặc định là tháng hiện tại — truyền qua query param
const now = new Date();
const TARGET_MONTH = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

const instance = autocannon(
  {
    url: `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/calendar/my-lock-status?targetMonth=${TARGET_MONTH}`,
    method: 'GET',
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    connections: 500,
    duration: 30,
    pipelining: 20, // Lock status rất nhẹ — pipeline cao nhất để đo max throughput
  },
  (err, result) => {
    if (err) { console.error(err); return; }
    console.log('\n--- RESULTS: MY LOCK STATUS READ STRESS TEST ---');
    console.log(`Requests/sec (avg):  ${result.requests.average}`);
    console.log(`Latency p50:         ${result.latency.p50} ms`);
    console.log(`Latency p99:         ${result.latency.p99} ms`);
    console.log(`Success (2xx):       ${result['2xx']}`);
    console.log(`Errors (non-2xx):    ${result.non2xx}`);
    console.log(`Timeouts:            ${result.timeouts}`);

    // Threshold nghiêm vì đây là single-row unique index lookup
    if (result.timeouts > 0) {
      console.warn('🔴 CRITICAL: Timeout trên single-row lookup — DB connection pool cạn kiệt.');
    } else if (result.latency.p99 > 300) {
      console.warn('🟠 WARNING: p99 > 300ms — IDX_USER_LOCK không được sử dụng, kiểm tra EXPLAIN ANALYZE.');
    } else if (result.latency.p99 > 100) {
      console.warn('🟡 WARNING: p99 > 100ms — network latency hoặc pool size quá nhỏ.');
    } else {
      console.log('✅ PASS: p99 < 100ms với 500 CCU.');
    }

    if (result.requests.average < 3000) {
      console.warn(`⚠️  req/s thấp (${result.requests.average}) cho endpoint đơn giản này. ` +
        'Kiểm tra middleware overhead (auth/guard) có heavy không.');
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });