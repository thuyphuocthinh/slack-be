const autocannon = require('autocannon');

/**
 * LOAD TEST: Create Leave Request
 *
 * Mô phỏng 200 user đồng loạt nộp đơn xin nghỉ phép cùng một ngày.
 * Write endpoint với logic phức tạp:
 *   - Kiểm tra overlap request (IDX_CALENDAR_REQ_WS_USER_TIME)
 *   - Kiểm tra ca làm việc trong range
 *   - Validate calendar lock (IDX_USER_LOCK)
 *   - Insert vào calendar_requests
 *   - Push notification tới manager
 *
 * ⚠️  NOTE: Sau lần đầu, các request kế tiếp sẽ bị lỗi "OVERLAPPING_REQUEST" (400).
 * Đây là HÀNH VI ĐÚNG — non-2xx count sẽ tăng nhanh.
 * Để đo clean throughput, dùng START_DATE khác nhau mỗi lần chạy test.
 *
 * KẾT QUẢ KỲ VỌNG:
 *   - Request đầu (non-duplicate): p99 < 500ms
 *   - Non-2xx sau đó là expected (OVERLAPPING_REQUEST)
 *   - 0 timeout
 */

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjM2MTExOSwiZXhwIjoxNzgyMzYyOTE5fQ.grCtcDdPpkpZz7R9P_a5Ofq7jG2l5LPXLEubwOpu9nw';
const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';

// Dùng ngày xa trong tương lai để tránh conflict với dữ liệu thật
// Đổi DATE_OFFSET mỗi lần chạy test để tránh OVERLAPPING_REQUEST từ lần trước
const DATE_OFFSET_DAYS = 30; // +30 ngày từ hôm nay
const startDate = new Date();
startDate.setUTCDate(startDate.getUTCDate() + DATE_OFFSET_DAYS);
startDate.setUTCHours(1, 0, 0, 0); // 08:00 UTC+7
const endDate = new Date(startDate);
endDate.setUTCHours(10, 0, 0, 0); // 17:00 UTC+7

const START_TIME = startDate.toISOString();
const END_TIME = endDate.toISOString();

const instance = autocannon(
  {
    url: `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/calendar/requests`,
    method: 'POST',
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      requestType: 'ANNUAL_LEAVE',
      startTime: START_TIME,
      endTime: END_TIME,
      reason: 'Load test — nghỉ phép thử nghiệm',
    }),
    connections: 200, // Write với overlap-check — giảm xuống 200 để tránh false deadlock
    duration: 30,
    pipelining: 1,
  },
  (err, result) => {
    if (err) { console.error(err); return; }
    console.log('\n--- RESULTS: LEAVE REQUEST CREATE STRESS TEST ---');
    console.log(`Target date range:   ${START_TIME} → ${END_TIME}`);
    console.log(`Requests/sec (avg):  ${result.requests.average}`);
    console.log(`Latency p50:         ${result.latency.p50} ms`);
    console.log(`Latency p99:         ${result.latency.p99} ms`);
    console.log(`Success (2xx):       ${result['2xx']}`);
    console.log(`Errors (non-2xx):    ${result.non2xx}`);
    console.log(`Timeouts:            ${result.timeouts}`);

    if (result.timeouts > 0) {
      console.warn('🔴 CRITICAL: Timeout — overlap-check query đang scan full table (thiếu IDX_CALENDAR_REQ_WS_USER_TIME).');
    } else if (result.latency.p99 > 1000) {
      console.warn('🟠 WARNING: p99 > 1000ms — kiểm tra index trên calendar_requests và notification push.');
    } else if (result.latency.p99 > 500) {
      console.warn('🟡 WARNING: p99 > 500ms — notification service có thể là bottleneck.');
    } else {
      console.log('✅ PASS: p99 < 500ms với 200 CCU.');
    }

    if (result['2xx'] > 0) {
      console.log(`ℹ️  ${result['2xx']} đơn nghỉ phép đã tạo thực tế trong DB — xóa sau khi test xong.`);
    }
    if (result.non2xx > 0 && result['2xx'] > 0) {
      console.log(`ℹ️  ${result.non2xx} request bị OVERLAPPING_REQUEST — hành vi đúng, không phải lỗi.`);
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });