const autocannon = require('autocannon');

// PASTE YOUR ACCESS TOKEN HERE
const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3NzY5NTY1NjQsImV4cCI6MTc3Njk1ODM2NH0.JJj9oY4MR-oquEGzS0-PX6LjLqkuhFMyjSL-WZayfkM';

const instance = autocannon(
  {
    url: 'http://localhost:3000/api/v1/workspaces',
    method: 'GET',
    headers: {
      authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    connections: 400, // Read can handle more connections
    duration: 30,
    pipelining: 1,
  },
  (err, result) => {
    if (err) {
      console.error(err);
    } else {
      console.log('--- RESULTS: GET WORKSPACES LIST STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Success (2xx): ${result['2xx']}`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });

/**
Running 30s test @ http://localhost:3000/api/v1/workspaces
100 connections


┌─────────┬────────┬────────┬────────┬────────┬───────────┬──────────┬────────┐
│ Stat    │ 2.5%   │ 50%    │ 97.5%  │ 99%    │ Avg       │ Stdev    │ Max    │
├─────────┼────────┼────────┼────────┼────────┼───────────┼──────────┼────────┤
│ Latency │ 130 ms │ 147 ms │ 242 ms │ 359 ms │ 156.23 ms │ 36.66 ms │ 478 ms │
└─────────┴────────┴────────┴────────┴────────┴───────────┴──────────┴────────┘
┌───────────┬─────────┬─────────┬─────────┬─────────┬─────────┬────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%     │ 97.5%   │ Avg     │ Stdev  │ Min     │
├───────────┼─────────┼─────────┼─────────┼─────────┼─────────┼────────┼─────────┤
│ Req/Sec   │ 400     │ 400     │ 679     │ 788     │ 640.17  │ 93.19  │ 400     │
├───────────┼─────────┼─────────┼─────────┼─────────┼─────────┼────────┼─────────┤
│ Bytes/Sec │ 1.47 MB │ 1.47 MB │ 2.49 MB │ 2.89 MB │ 2.35 MB │ 342 kB │ 1.47 MB │
└───────────┴─────────┴─────────┴─────────┴─────────┴─────────┴────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 30

19k requests in 30.21s, 70.5 MB read
--- RESULTS: GET WORKSPACES LIST STRESS TEST ---
Requests/sec: 640.17
Latency (p99): 359 ms
Success (2xx): 19205
Errors (Non-2xx): 0
PS E:\Career\Software_Engineer\Projects\Slack\slack-be\loadtest> 
 */
