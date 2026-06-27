const autocannon = require('autocannon');

/**
 * LOAD TEST: Today Attendance (Read-Heavy)
 *
 * Mô phỏng 500 user đồng loạt mở app xem trạng thái chấm công hôm nay.
 * Đây là read endpoint được hit nhiều nhất — mỗi lần mở app hoặc F5.
 * Endpoint trả về: ca hôm nay, check-in time, check-out time, status, actualWorkHours.
 *
 * Query plan:
 *   SELECT * FROM work_shifts WHERE workspaceId=? AND userId=? AND workDate=? (IDX_WORK_SHIFT_WS_USER_DATE)
 *   LEFT JOIN attendance_logs WHERE workShiftId=? ORDER BY recordedAt DESC LIMIT 2 (IDX_ATTENDANCE_LOG_SHIFT_RECENT)
 *   LEFT JOIN daily_reconciliations ...
 *
 * KẾT QUẢ KỲ VỌNG:
 *   - p99 < 200ms (pure read, no write lock)
 *   - 0 timeout ở 500 CCU
 */

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjM2MTExOSwiZXhwIjoxNzgyMzYyOTE5fQ.grCtcDdPpkpZz7R9P_a5Ofq7jG2l5LPXLEubwOpu9nw';
const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';

const instance = autocannon(
  {
    url: `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/calendar/today-attendance`,
    method: 'GET',
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    connections: 500,
    duration: 30,
    pipelining: 10, // Read endpoint thuần — pipeline cao để bão hòa throughput
  },
  (err, result) => {
    if (err) { console.error(err); return; }
    console.log('\n--- RESULTS: TODAY ATTENDANCE READ STRESS TEST ---');
    console.log(`Requests/sec (avg):  ${result.requests.average}`);
    console.log(`Throughput (MB/s):   ${(result.throughput.average / 1024 / 1024).toFixed(2)}`);
    console.log(`Latency p50:         ${result.latency.p50} ms`);
    console.log(`Latency p97.5:       ${result.latency.p97_5} ms`);
    console.log(`Latency p99:         ${result.latency.p99} ms`);
    console.log(`Success (2xx):       ${result['2xx']}`);
    console.log(`Errors (non-2xx):    ${result.non2xx}`);
    console.log(`Timeouts:            ${result.timeouts}`);

    // Read endpoint — threshold nghiêm hơn
    if (result.timeouts > 0) {
      console.warn('🔴 CRITICAL: Timeout trên read endpoint — index bị missing hoặc connection pool exhausted.');
    } else if (result.latency.p99 > 500) {
      console.warn('🟠 WARNING: p99 > 500ms — kiểm tra IDX_WORK_SHIFT_WS_USER_DATE và IDX_ATTENDANCE_LOG_SHIFT_RECENT.');
    } else if (result.latency.p99 > 200) {
      console.warn('🟡 WARNING: p99 > 200ms — xem xét query cache (Redis) cho today-attendance.');
    } else {
      console.log('✅ PASS: p99 < 200ms với 500 CCU — index đang hoạt động tốt.');
    }

    if (result.requests.average < 1000) {
      console.warn(`⚠️  Throughput thấp (${result.requests.average} req/s) — có thể do connection pool mặc định (10). ` +
        'Thử tăng DB_POOL_SIZE hoặc giảm pipelining.');
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });