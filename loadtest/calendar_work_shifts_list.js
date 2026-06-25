const autocannon = require('autocannon');

// PASTE YOUR ACCESS TOKEN HERE
const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjM2MTExOSwiZXhwIjoxNzgyMzYyOTE5fQ.grCtcDdPpkpZz7R9P_a5Ofq7jG2l5LPXLEubwOpu9nw';
// PASTE A VALID WORKSPACE ID HERE
const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';
const START_DATE = '2026-06-01';
const END_DATE = '2026-06-30';

const instance = autocannon(
  {
    url: `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/calendar/work-shifts?startDate=${START_DATE}&endDate=${END_DATE}`,
    method: 'GET',
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    connections: 500, // Mô phỏng 500 CCU đồng loạt tải Lịch làm việc
    duration: 30, // Chạy trong 30 giây
    pipelining: 1,
  },
  (err, result) => {
    if (err) {
      console.error(err);
    } else {
      console.log('--- RESULTS: CALENDAR WORK SHIFTS GET STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Success (2xx): ${result['2xx']}`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);

      if (result.latency.p99 > 300) {
        console.warn(
          '⚠️ WARNING: p99 Latency exceeds 300ms. Consider optimizing the database query or adding cache.',
        );
      } else {
        console.log('✅ PASS: p99 Latency is under 300ms.');
      }
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });
