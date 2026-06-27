const autocannon = require('autocannon');

/**
 * LOAD TEST: Timekeeping Check-Out
 *
 * Mô phỏng 500 nhân viên đồng loạt bấm Check-Out lúc 17:00.
 * Check-out nặng hơn check-in vì:
 *   - Tính toán actualWorkHours (cộng dồn)
 *   - Re-evaluate status LATE_EARLY/NORMAL dựa trên grace period từ policy
 *   - Pessimistic write lock trên daily_reconciliations
 *
 * ⚠️  SETUP: Cần đã check-in trước (nếu chưa check-in → MISSING_CHECK_IN 400).
 * SHIFT_ID phải là ca có endTime trong vòng ±4h từ bây giờ.
 */

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjM2MTExOSwiZXhwIjoxNzgyMzYyOTE5fQ.grCtcDdPpkpZz7R9P_a5Ofq7jG2l5LPXLEubwOpu9nw';
const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';
const SHIFT_ID = 'PASTE_VALID_SHIFT_ID_HERE';
const FAKE_FACE_DESCRIPTOR = Array(128).fill(0.1);

const instance = autocannon(
  {
    url: `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/calendar/check-out`,
    method: 'POST',
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      shiftId: SHIFT_ID,
      location: 'OFFICE',
      faceDescriptor: FAKE_FACE_DESCRIPTOR,
    }),
    connections: 500,
    duration: 30,
    pipelining: 1,
  },
  (err, result) => {
    if (err) { console.error(err); return; }
    console.log('\n--- RESULTS: TIMEKEEPING CHECK-OUT STRESS TEST ---');
    console.log(`Requests/sec (avg):  ${result.requests.average}`);
    console.log(`Latency p50:         ${result.latency.p50} ms`);
    console.log(`Latency p99:         ${result.latency.p99} ms`);
    console.log(`Success (2xx):       ${result['2xx']}`);
    console.log(`Errors (non-2xx):    ${result.non2xx}`);
    console.log(`Timeouts:            ${result.timeouts}`);

    // Check-out giữ pessimistic write lock lâu hơn check-in → threshold cao hơn
    if (result.timeouts > 0) {
      console.warn('🔴 CRITICAL: Timeout — DB write lock gây deadlock/queue.');
    } else if (result.latency.p99 > 1500) {
      console.warn('🟠 WARNING: p99 > 1500ms — DB contention ở daily_reconciliations.');
    } else if (result.latency.p99 > 800) {
      console.warn('🟡 WARNING: p99 > 800ms — kiểm tra index IDX_UNIQUE_RECONCILIATION_PER_DAY.');
    } else {
      console.log('✅ PASS: p99 < 800ms với 500 CCU.');
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });