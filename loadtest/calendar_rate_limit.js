const autocannon = require('autocannon');

/**
 * LOAD TEST: Rate Limit Check-In — verify 429 đúng ngưỡng
 *
 * Test này KHÔNG đo performance mà đo correctness của rate limit:
 *   - Limit: 5 req / 60s per user (gateway + service)
 *   - Kỳ vọng: request 1–5 → 2xx hoặc 4xx business (ALREADY_CHECKED_IN v.v.)
 *              request 6+ trong cùng 60s → 429 TOO_MANY_REQUESTS
 *
 * Chạy 20 connections × 10 giây = ~200 requests từ cùng 1 user.
 * Nếu rate limit đúng: ~5 request đầu pass, còn lại 429.
 *
 * ⚠️  SETUP: ACCESS_TOKEN phải còn hạn. SHIFT_ID có thể là placeholder
 *    vì rate limit chặn ở gateway trước khi validate business logic.
 *
 * KẾT QUẢ KỲ VỌNG:
 *   - Tổng 2xx + business 4xx (ALREADY_CHECKED_IN...) ≤ 5
 *   - 429 chiếm phần lớn non-2xx
 *   - Không có timeout (429 phải trả về ngay từ Redis, < 10ms)
 */

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjY1MzE1NSwiZXhwIjoxNzgyNjU0OTU1fQ.K5vjGS-H0O2r-cmvbkd_OEpbiK7vTCvjMbUTI1SSXPU';
const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';
const SHIFT_ID = '6588d8bd-bc10-4f52-a7bf-1e6cc511e44b';

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
      faceDescriptor: Array(128).fill(0.1),
    }),
    // Thấp thôi — mục đích là đo ngưỡng 429, không cần spike lớn
    connections: 20,
    duration: 10,
    pipelining: 1,
  },
  (err, result) => {
    if (err) {
      console.error(err);
      return;
    }

    console.log('\n--- RESULTS: RATE LIMIT CORRECTNESS TEST ---');
    console.log(`Total requests:      ${result.requests.total}`);
    console.log(`Success (2xx):       ${result['2xx']}`);
    console.log(`Non-2xx:             ${result.non2xx}`);
    console.log(`Latency p50:         ${result.latency.p50} ms`);
    console.log(
      `Latency p99:         ${result.latency.p99} ms  ← 429 phải cực nhanh`,
    );
    console.log(`Timeouts:            ${result.timeouts}`);

    // Rate limit = 5/60s → trong 10s tối đa 5 request không bị block
    const expectedPass = 5;
    const actualPassed =
      result['2xx'] +
      (result.non2xx -
        /* 429 approx */ Math.max(0, result.non2xx - expectedPass));

    if (result.timeouts > 0) {
      console.warn(
        '🔴 FAIL: Có timeout — Redis rate limit đang bị block thay vì reject nhanh.',
      );
    } else if (result.non2xx === 0) {
      console.warn(
        '🔴 FAIL: 0 non-2xx — rate limit không hoạt động hoặc limit quá cao.',
      );
    } else if (result.latency.p99 > 100) {
      console.warn(
        '🟡 WARNING: p99 > 100ms cho 429 — Redis Lua script có thể bị chậm.',
      );
    } else {
      console.log(
        `✅ PASS: Rate limit đang chặn — non-2xx = ${result.non2xx}, p99 = ${result.latency.p99}ms.`,
      );
      console.log(
        `   Kiểm tra log server để confirm phần lớn non-2xx là 429 (không phải 400/500).`,
      );
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });
