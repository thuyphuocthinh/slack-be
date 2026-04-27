const autocannon = require('autocannon');

// NOTE: You need a valid refresh token from a previous login to test this effectively.
const VALID_REFRESH_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJqdGkiOiIwMTlkYmFiMC1lZjk3LTc2ZTktYjBkMy01MWY2YmMyMWJkMGIiLCJpYXQiOjE3NzY5NTM2NTEsImV4cCI6MTc3NzU1ODQ1MX0.G2LbWsRmsZX_pdOjPHy2GF6giQyX5yFci1P0GS6Jwv8';

const instance = autocannon(
  {
    url: 'http://localhost:3000/api/v1/auth/refresh',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      refreshToken: VALID_REFRESH_TOKEN,
    }),
    connections: 50,
    duration: 20,
    pipelining: 1,
  },
  (err, result) => {
    if (err) {
      console.error(err);
    } else {
      console.log('--- RESULTS: REFRESH TOKEN STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });

/*
Running 20s test @ http://localhost:3000/api/v1/auth/refresh
50 connections


┌─────────┬───────┬───────┬────────┬────────┬──────────┬──────────┬────────┐
│ Stat    │ 2.5%  │ 50%   │ 97.5%  │ 99%    │ Avg      │ Stdev    │ Max    │
├─────────┼───────┼───────┼────────┼────────┼──────────┼──────────┼────────┤
│ Latency │ 68 ms │ 82 ms │ 108 ms │ 115 ms │ 83.58 ms │ 10.64 ms │ 164 ms │
└─────────┴───────┴───────┴────────┴────────┴──────────┴──────────┴────────┘
┌───────────┬────────┬────────┬────────┬────────┬────────┬─────────┬────────┐
│ Stat      │ 1%     │ 2.5%   │ 50%    │ 97.5%  │ Avg    │ Stdev   │ Min    │
├───────────┼────────┼────────┼────────┼────────┼────────┼─────────┼────────┤
│ Req/Sec   │ 454    │ 454    │ 600    │ 649    │ 595.15 │ 41.39   │ 454    │
├───────────┼────────┼────────┼────────┼────────┼────────┼─────────┼────────┤
│ Bytes/Sec │ 222 kB │ 222 kB │ 294 kB │ 318 kB │ 292 kB │ 20.3 kB │ 222 kB │
└───────────┴────────┴────────┴────────┴────────┴────────┴─────────┴────────┘

Req/Bytes counts sampled once per second.
# of samples: 20

0 2xx responses, 11903 non 2xx responses
12k requests in 20.1s, 5.83 MB read
--- RESULTS: REFRESH TOKEN STRESS TEST ---
Requests/sec: 595.15
Latency (p99): 115 ms
Errors (Non-2xx): 11903
*/
