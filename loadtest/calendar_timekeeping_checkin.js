const autocannon = require('autocannon');

/**
 * LOAD TEST: Timekeeping Check-In
 *
 * Mô phỏng 500 nhân viên đồng loạt bấm Check-In lúc 8:00 AM.
 *
 * ⚠️  SETUP TRƯỚC KHI CHẠY:
 *   1. Tạo 1 ca làm việc hôm nay cho user test (qua API bulk-register hoặc trực tiếp DB).
 *   2. Paste shiftId vào SHIFT_ID bên dưới.
 *   3. Paste một access token còn hạn vào ACCESS_TOKEN.
 *   4. Face auth: cần pre-save face baseline cho user, sau đó dùng descriptor khớp.
 *      Nếu chưa setup face baseline → server trả 400 (expected), p99 vẫn đo được.
 *
 * KẾT QUẢ KỲ VỌNG (sau khi setup đúng):
 *   - Success (2xx): phải > 0 (ít nhất request đầu tiên của mỗi user)
 *   - Latency p99 < 500ms ở 500 CCU là acceptable
 *   - Non-2xx sau lần check-in đầu là NORMAL (ALREADY_CHECKED_IN)
 */

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjM2MTExOSwiZXhwIjoxNzgyMzYyOTE5fQ.grCtcDdPpkpZz7R9P_a5Ofq7jG2l5LPXLEubwOpu9nw';
const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';

// ID ca làm việc hôm nay của user test — thay bằng UUID thật
const SHIFT_ID = 'PASTE_VALID_SHIFT_ID_HERE';

// Face descriptor giả — khoảng cách Euclidean với baseline sẽ > threshold → 403 FACE_NOT_MATCH
// Để test 2xx, dùng descriptor khớp với baseline đã lưu
const FAKE_FACE_DESCRIPTOR = Array(128).fill(0.1);

const instance = autocannon(
  {
    url: `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/calendar/check-in`,
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
    connections: 500, // 500 CCU đồng loạt check-in lúc 8:00 AM
    duration: 30,
    pipelining: 1,
  },
  (err, result) => {
    if (err) {
      console.error(err);
      return;
    }
    console.log('\n--- RESULTS: TIMEKEEPING CHECK-IN STRESS TEST ---');
    console.log(`Requests/sec (avg):  ${result.requests.average}`);
    console.log(`Latency p50:         ${result.latency.p50} ms`);
    console.log(`Latency p97.5:       ${result.latency.p97_5} ms`);
    console.log(`Latency p99:         ${result.latency.p99} ms`);
    console.log(`Success (2xx):       ${result['2xx']}`);
    console.log(`Errors (non-2xx):    ${result.non2xx}`);
    console.log(`Timeouts:            ${result.timeouts}`);

    if (result.timeouts > 0) {
      console.warn('🔴 CRITICAL: Có request timeout — server bị overload hoặc DB lock quá lâu.');
    } else if (result.latency.p99 > 1000) {
      console.warn('🟠 WARNING: p99 > 1000ms — DB pessimistic lock đang gây queue dài.');
    } else if (result.latency.p99 > 500) {
      console.warn('🟡 WARNING: p99 > 500ms — cần xem lại index trên daily_reconciliations.');
    } else {
      console.log('✅ PASS: p99 < 500ms với 500 CCU.');
    }

    if (result.non2xx > 0 && result['2xx'] === 0) {
      console.warn(
        '⚠️  NOTE: 0 success — kiểm tra: (1) token hết hạn, (2) SHIFT_ID chưa tồn tại, ' +
        '(3) face baseline chưa được lưu cho user.',
      );
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });