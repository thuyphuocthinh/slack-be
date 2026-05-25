const autocannon = require('autocannon');

// PASTE YOUR ACCESS TOKEN HERE
const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3Nzc0MTg5MzcsImV4cCI6MTc3NzQyMDczN30.VMlrkXtD64Kawet3lbH9htDaCdUVVksBd4oTEo8pT40';
// PASTE YOUR REFRESH TOKEN HERE
const REFRESH_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJqdGkiOiIwMTlkZDY2Yy1hNTY2LTc1NzMtYWQxYi1iMzczMzNhODc1YzgiLCJpYXQiOjE3Nzc0MTg5MzcsImV4cCI6MTc3ODAyMzczN30.fJAnXBrvzUG2b96gg44XvvbShmTtGWsrX8qiT0ZPcAY';

const instance = autocannon(
  {
    url: 'http://localhost:3000/api/v1/auth/logout',
    method: 'POST',
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      access_token: ACCESS_TOKEN,
      refresh_token: REFRESH_TOKEN,
    }),
    connections: 100,
    duration: 30,
    pipelining: 1,
  },
  (err, result) => {
    if (err) {
      console.error(err);
    } else {
      console.log('--- RESULTS: AUTH LOGOUT STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Success (2xx): ${result['2xx']}`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });

/*
Running 30s test @ http://localhost:3000/api/v1/auth/logout
100 connections


┌─────────┬───────┬────────┬────────┬────────┬───────────┬───────────┬────────┐
│ Stat    │ 2.5%  │ 50%    │ 97.5%  │ 99%    │ Avg       │ Stdev     │ Max    │
├─────────┼───────┼────────┼────────┼────────┼───────────┼───────────┼────────┤
│ Latency │ 11 ms │ 245 ms │ 395 ms │ 519 ms │ 159.98 ms │ 144.36 ms │ 668 ms │
└─────────┴───────┴────────┴────────┴────────┴───────────┴───────────┴────────┘
┌───────────┬────────┬────────┬────────┬────────┬────────┬─────────┬────────┐
│ Stat      │ 1%     │ 2.5%   │ 50%    │ 97.5%  │ Avg    │ Stdev   │ Min    │
├───────────┼────────┼────────┼────────┼────────┼────────┼─────────┼────────┤
│ Req/Sec   │ 281    │ 281    │ 674    │ 720    │ 621.97 │ 105.22  │ 281    │
├───────────┼────────┼────────┼────────┼────────┼────────┼─────────┼────────┤
│ Bytes/Sec │ 154 kB │ 154 kB │ 370 kB │ 396 kB │ 341 kB │ 57.8 kB │ 154 kB │
└───────────┴────────┴────────┴────────┴────────┴────────┴─────────┴────────┘

Req/Bytes counts sampled once per second.
# of samples: 30

0 2xx responses, 18659 non 2xx responses
19k requests in 30.12s, 10.2 MB read
--- RESULTS: AUTH LOGOUT STRESS TEST ---
Requests/sec: 621.97
Latency (p99): 519 ms
Success (2xx): 0
Errors (Non-2xx): 18659
*/
