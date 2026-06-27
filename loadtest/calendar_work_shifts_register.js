const autocannon = require('autocannon');

/**
 * LOAD TEST: Bulk Register Work Shifts
 *
 * Mô phỏng admin/HR đăng ký ca làm việc hàng loạt cho 500 user cùng lúc.
 * Đây là write-heavy endpoint:
 *   - Upsert vào work_shifts (INSERT ON CONFLICT DO UPDATE)
 *   - Xóa + tạo lại reconciliation records nếu ca thay đổi
 *   - Đọc WorkspaceCalendarPolicy để validate
 *
 * ⚠️  SETUP: USER_IDS phải là UUID của các user thật trong workspace.
 * Chạy test này VÀO NGÀY MAI hoặc ngày chưa có ca để tránh conflict.
 *
 * KẾT QUẢ KỲ VỌNG:
 *   - p99 < 800ms (bulk upsert nặng hơn check-in đơn lẻ)
 *   - Non-2xx gần 0 (trừ duplicate shift nếu chạy lại nhiều lần)
 */

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjM2MTExOSwiZXhwIjoxNzgyMzYyOTE5fQ.grCtcDdPpkpZz7R9P_a5Ofq7jG2l5LPXLEubwOpu9nw';
const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';

// Thay bằng UUID thật — nếu user không tồn tại → 400/404
const USER_IDS = [
  '3c195b53-fee1-4ecc-8d0a-9e7d9238c5bb',
];

// Ngày mai (UTC) — tránh conflict với ca hôm nay
const tomorrow = new Date();
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const WORK_DATE = tomorrow.toISOString().slice(0, 10); // YYYY-MM-DD

const shifts = USER_IDS.map(userId => ({
  userId,
  workDate: WORK_DATE,
  startTime: `${WORK_DATE}T01:00:00.000Z`, // 08:00 UTC+7
  endTime:   `${WORK_DATE}T10:00:00.000Z`, // 17:00 UTC+7
  locationType: 'OFFICE',
}));

const instance = autocannon(
  {
    url: `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/calendar/work-shifts/bulk-register`,
    method: 'POST',
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ shifts }),
    connections: 100, // Write endpoint — giảm CCU xuống 100 để tránh DB deadlock trên upsert
    duration: 30,
    pipelining: 1,
  },
  (err, result) => {
    if (err) { console.error(err); return; }
    console.log('\n--- RESULTS: BULK REGISTER WORK SHIFTS STRESS TEST ---');
    console.log(`Requests/sec (avg):  ${result.requests.average}`);
    console.log(`Latency p50:         ${result.latency.p50} ms`);
    console.log(`Latency p99:         ${result.latency.p99} ms`);
    console.log(`Success (2xx):       ${result['2xx']}`);
    console.log(`Errors (non-2xx):    ${result.non2xx}`);
    console.log(`Timeouts:            ${result.timeouts}`);

    if (result.timeouts > 0) {
      console.warn('🔴 CRITICAL: Timeout — bulk upsert quá chậm, xem lại IDX_WORK_SHIFT_WS_USER_DATE.');
    } else if (result.latency.p99 > 2000) {
      console.warn('🟠 WARNING: p99 > 2000ms — bulk upsert đang scan full table.');
    } else if (result.latency.p99 > 800) {
      console.warn('🟡 WARNING: p99 > 800ms — kiểm tra transaction scope và index.');
    } else {
      console.log('✅ PASS: p99 < 800ms với 100 CCU write.');
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });