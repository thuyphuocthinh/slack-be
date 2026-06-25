const autocannon = require('autocannon');

// PASTE YOUR ACCESS TOKEN HERE
const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MjM2MTExOSwiZXhwIjoxNzgyMzYyOTE5fQ.grCtcDdPpkpZz7R9P_a5Ofq7jG2l5LPXLEubwOpu9nw';
// PASTE A VALID WORKSPACE ID HERE
const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';

const instance = autocannon(
  {
    url: `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/calendar/check-in`,
    method: 'POST',
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      location: 'OFFICE', // 'WFH' or 'OFFICE'
    }),
    connections: 500, // Mô phỏng 500 CCU đồng loạt Check-in lúc 8:00 AM
    duration: 30, // Chạy trong 30 giây
    pipelining: 1,
  },
  (err, result) => {
    if (err) {
      console.error(err);
    } else {
      console.log('--- RESULTS: TIMEKEEPING CHECK-IN STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Success (2xx): ${result['2xx']}`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);

      // Because check-in modifies the database and checks IP, we want to ensure it doesn't timeout
      if (result.non2xx > result['2xx']) {
        console.warn(
          '⚠️ WARNING: Too many errors. The database might be locked or overloaded (Row locking).',
        );
      }
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });

/*
Running 30s test @ https://api.tpt.io.vn/api/v1/workspaces/57558aac-97ec-43b8-9512-94b76de7455a/calendar/timekeeping/check-in
500 connections


┌─────────┬───────┬────────┬────────┬────────┬───────────┬───────────┬─────────┐
│ Stat    │ 2.5%  │ 50%    │ 97.5%  │ 99%    │ Avg       │ Stdev     │ Max     │
├─────────┼───────┼────────┼────────┼────────┼───────────┼───────────┼─────────┤
│ Latency │ 66 ms │ 126 ms │ 326 ms │ 367 ms │ 153.64 ms │ 127.34 ms │ 1752 ms │
└─────────┴───────┴────────┴────────┴────────┴───────────┴───────────┴─────────┘
┌───────────┬─────┬──────┬─────────┬─────────┬─────────┬────────┬────────┐
│ Stat      │ 1%  │ 2.5% │ 50%     │ 97.5%   │ Avg     │ Stdev  │ Min    │
├───────────┼─────┼──────┼─────────┼─────────┼─────────┼────────┼────────┤
│ Req/Sec   │ 0   │ 0    │ 3,263   │ 4,767   │ 3,275.1 │ 882.67 │ 2,077  │
├───────────┼─────┼──────┼─────────┼─────────┼─────────┼────────┼────────┤
│ Bytes/Sec │ 0 B │ 0 B  │ 1.15 MB │ 1.68 MB │ 1.15 MB │ 310 kB │ 734 kB │
└───────────┴─────┴──────┴─────────┴─────────┴─────────┴────────┴────────┘

Req/Bytes counts sampled once per second.
# of samples: 30

0 2xx responses, 98243 non 2xx responses
99k requests in 30.68s, 34.6 MB read
--- RESULTS: TIMEKEEPING CHECK-IN STRESS TEST ---
Requests/sec: 3275.1
Latency (p99): 367 ms
Success (2xx): 0
Errors (Non-2xx): 98243
⚠️ WARNING: Too many errors. The database might be locked or overloaded (Row locking).
*/
