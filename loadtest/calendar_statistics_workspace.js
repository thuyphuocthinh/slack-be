const autocannon = require('autocannon');

/**
 * LOAD TEST: Workspace Statistics — heavy aggregation read
 *
 * Mô phỏng manager/admin mở trang thống kê toàn workspace đồng loạt.
 * Đây là query nặng nhất trong calendar:
 *   - JOIN work_shifts + attendance_logs + daily_reconciliations + leave_balances
 *   - GROUP BY userId cho toàn bộ member trong workspace
 *   - Không có Redis cache (real-time stats)
 *
 * Nếu endpoint này chậm → bottleneck khi scale lên vài trăm user/workspace.
 *
 * KẾT QUẢ KỲ VỌNG:
 *   - p99 < 1000ms (aggregation nặng hơn read thông thường)
 *   - 0 timeout ở 50 CCU
 *   - Nếu p99 > 2000ms → cần thêm materialized view hoặc Redis cache
 */

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjY1NDE4NiwiZXhwIjoxNzgyNjU1OTg2fQ.I6xY02VmoxXkxIfqcZR68vVGEcYZ8s7FWw-inTsyQ84';
const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';
const MONTH = '2026-06'; // Tháng cần thống kê — đổi nếu cần

const instance = autocannon(
  {
    url: `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/calendar/statistics/workspace/members?month=${MONTH}`,
    method: 'GET',
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    // Giảm connections — đây là heavy aggregation, không cần nhiều CCU để saturate DB
    connections: 50,
    duration: 30,
    pipelining: 1,
  },
  (err, result) => {
    if (err) { console.error(err); return; }

    console.log('\n--- RESULTS: WORKSPACE STATISTICS STRESS TEST ---');
    console.log(`Month:               ${MONTH}`);
    console.log(`Requests/sec (avg):  ${result.requests.average}`);
    console.log(`Latency p50:         ${result.latency.p50} ms`);
    console.log(`Latency p97.5:       ${result.latency.p97_5} ms`);
    console.log(`Latency p99:         ${result.latency.p99} ms`);
    console.log(`Latency max:         ${result.latency.max} ms`);
    console.log(`Success (2xx):       ${result['2xx']}`);
    console.log(`Errors (non-2xx):    ${result.non2xx}`);
    console.log(`Timeouts:            ${result.timeouts}`);

    if (result.timeouts > 0) {
      console.warn('🔴 CRITICAL: Timeout — aggregation query quét full table, cần index hoặc cache.');
    } else if (result.latency.p99 > 3000) {
      console.warn('🔴 WARNING: p99 > 3s — cần Redis cache hoặc materialized view cho workspace stats.');
    } else if (result.latency.p99 > 1000) {
      console.warn('🟠 WARNING: p99 > 1000ms — chấp nhận được ở quy mô nhỏ, cần cache khi > 100 user/workspace.');
    } else if (result.latency.p99 > 500) {
      console.warn('🟡 WARNING: p99 > 500ms — xem xét cache kết quả 1-5 phút (stats không cần real-time).');
    } else {
      console.log('✅ PASS: p99 < 500ms — aggregation nhanh, index đang hoạt động tốt.');
    }

    if (result.requests.average < 10) {
      console.warn(`⚠️  Throughput rất thấp (${result.requests.average} req/s) — DB đang serializing queries. `
        + 'Cần cache layer cho endpoint này khi số user/workspace tăng.');
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });
