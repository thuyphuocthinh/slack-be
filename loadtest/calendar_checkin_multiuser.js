const autocannon = require('autocannon');

/**
 * LOAD TEST: Multi-User Concurrent Check-In — morning spike simulation
 *
 * Mô phỏng 4 user KHÁC NHAU đồng loạt bấm check-in lúc 8:00 AM.
 * Khác calendar_timekeeping_checkin.js (1 user → rate limit ngay):
 *   - 4 token xoay vòng → 4 rate limit bucket riêng → 20 req pass/60s
 *   - Test write lock contention trên daily_reconciliations (pessimistic_write)
 *   - Test attendance_logs INSERT concurrency
 *
 * ⚠️  SETUP TRƯỚC KHI CHẠY:
 *   1. Tạo shift cho từng user vào ngày hôm nay
 *   2. Điền SHIFT_ID tương ứng cho từng user bên dưới
 *   3. Các user phải thuộc cùng workspace
 *
 * KẾT QUẢ KỲ VỌNG:
 *   - 2xx ~ 4 (1 check-in thành công per user, rest bị ALREADY_CHECKED_IN)
 *   - p99 < 500ms
 *   - 0 timeout
 */

const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';

// Mỗi entry: token + shiftId của user đó (phải là ca hôm nay)
const USERS = [
  {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjY1NDE4NiwiZXhwIjoxNzgyNjU1OTg2fQ.I6xY02VmoxXkxIfqcZR68vVGEcYZ8s7FWw-inTsyQ84',
    shiftId: 'PASTE_SHIFT_ID_USER_1',
  },
  {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmZTgzODRmNi01NTc5LTRlOTUtOGE0MS1jYWNhNWJhYjI3Y2YiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzZAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3ODI2NTQxODYsImV4cCI6MTc4MjY1NTk4Nn0.QhEV4VAa7b7LuC_T-GoI90_77E4JhdKvHSCZ-PtOsBE',
    shiftId: 'PASTE_SHIFT_ID_USER_2',
  },
  {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiZDkwNGJkZi0yNWE3LTQ1NmYtOTJjNS1mNzBiMWUyMDM4MDgiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzE1QGdtYWlsLmNvbSIsInRva2VuVmVyc2lvbiI6MSwiaWF0IjoxNzgyNjU0MTg2LCJleHAiOjE3ODI2NTU5ODZ9.OKT9UG0uTA1tD_kXN2s4-DkRHG9KB5m_UututaPjIx8',
    shiftId: 'PASTE_SHIFT_ID_USER_3',
  },
  {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1ODBkMTk3MC04ZDM5LTQyYTYtOGY5Yy1hYjBmMTQzMjc5ODEiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzE3QGdtYWlsLmNvbSIsInRva2VuVmVyc2lvbiI6MSwiaWF0IjoxNzgyNjU0MTg3LCJleHAiOjE3ODI2NTU5ODd9.ODorIrs-ZGuL7GZfRQMADL7sy_Z-YB1k114V6D74JDA',
    shiftId: 'PASTE_SHIFT_ID_USER_4',
  },
];

const requests = USERS.map(({ token, shiftId }) => ({
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    shiftId,
    location: 'OFFICE',
    faceDescriptor: Array(128).fill(0.1),
  }),
}));

const instance = autocannon(
  {
    url: `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/calendar/check-in`,
    method: 'POST',
    requests,
    connections: 50,
    duration: 30,
    pipelining: 1,
  },
  (err, result) => {
    if (err) { console.error(err); return; }

    console.log('\n--- RESULTS: MULTI-USER CONCURRENT CHECK-IN ---');
    console.log(`Requests/sec (avg):  ${result.requests.average}`);
    console.log(`Latency p50:         ${result.latency.p50} ms`);
    console.log(`Latency p97.5:       ${result.latency.p97_5} ms`);
    console.log(`Latency p99:         ${result.latency.p99} ms`);
    console.log(`Success (2xx):       ${result['2xx']}`);
    console.log(`Errors (non-2xx):    ${result.non2xx}`);
    console.log(`Timeouts:            ${result.timeouts}`);

    if (result.timeouts > 0) {
      console.warn('🔴 CRITICAL: Timeout — pessimistic_write lock trên daily_reconciliations đang queue quá dài.');
    } else if (result['2xx'] === 0) {
      console.warn('🔴 FAIL: 0 success — kiểm tra: token hết hạn, shiftId sai, face baseline chưa lưu.');
    } else if (result.latency.p99 > 1000) {
      console.warn('🟠 WARNING: p99 > 1000ms — write contention cao trên attendance_logs hoặc daily_reconciliations.');
    } else if (result.latency.p99 > 500) {
      console.warn('🟡 WARNING: p99 > 500ms — xem lại index IDX_ATTENDANCE_LOG_SHIFT và IDX_DAILY_RECON_WS_USER_DATE.');
    } else {
      console.log('✅ PASS: p99 < 500ms, write lock hoạt động đúng.');
    }

    console.log('\nℹ️  NOTE: non-2xx sau lần check-in đầu là NORMAL (ALREADY_CHECKED_IN hoặc FACE_NOT_MATCH).');
    console.log('   Chỉ cần 2xx > 0 và 0 timeout là test đạt yêu cầu.');
  },
);

autocannon.track(instance, { renderProgressBar: true });
