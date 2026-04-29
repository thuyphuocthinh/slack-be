const autocannon = require('autocannon');

// PASTE YOUR ACCESS TOKEN HERE
const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3Nzc0MTk0ODcsImV4cCI6MTc3NzQyMTI4N30.mu0012ApRFUNqH2zGjWLVeSQ0vdU3ubonp7o_eB1hNg';

// PASTE A VALID GROUP ID HERE
const GROUP_ID = 'be4ddc70-0b6a-44c4-9bb7-0b1406d4ac2d';

const instance = autocannon(
  {
    url: `http://localhost:3000/api/v1/tasks?groupId=${GROUP_ID}&page=1&limit=20`,
    method: 'GET',
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    connections: 500,
    duration: 30,
    pipelining: 1,
  },
  (err, result) => {
    if (err) {
      console.error(err);
    } else {
      console.log('--- RESULTS: GET TASKS IN GROUP STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Success (2xx): ${result['2xx']}`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });

/*
Running 30s test @ http://localhost:3000/api/v1/tasks?groupId=be4ddc70-0b6a-44c4-9bb7-0b1406d4ac2d&page=1&limit=20
500 connections


┌─────────┬────────┬────────┬─────────┬─────────┬───────────┬───────────┬─────────┐
│ Stat    │ 2.5%   │ 50%    │ 97.5%   │ 99%     │ Avg       │ Stdev     │ Max     │
├─────────┼────────┼────────┼─────────┼─────────┼───────────┼───────────┼─────────┤
│ Latency │ 938 ms │ 977 ms │ 1061 ms │ 1625 ms │ 994.75 ms │ 117.26 ms │ 2014 ms │
└─────────┴────────┴────────┴─────────┴─────────┴───────────┴───────────┴─────────┘
┌───────────┬────────┬────────┬────────┬─────────┬────────┬────────┬────────┐
├───────────┼────────┼────────┼────────┼─────────┼────────┼────────┼────────┤
│ Bytes/Sec │ 358 kB │ 358 kB │ 1.3 MB │ 1.98 MB │ 1.3 MB │ 267 kB │ 357 kB │
└───────────┴────────┴────────┴────────┴─────────┴────────┴────────┴────────┘

Req/Bytes counts sampled once per second.
# of samples: 30

15k requests in 30.2s, 38.9 MB read
--- RESULTS: GET TASKS IN GROUP STRESS TEST ---
Requests/sec: 497.47
Latency (p99): 1625 ms
Success (2xx): 14924
Errors (Non-2xx): 0
*/
