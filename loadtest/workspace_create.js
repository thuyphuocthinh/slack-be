const autocannon = require('autocannon');
const { v4: uuidv4 } = require('uuid');

// PASTE YOUR ACCESS TOKEN HERE
const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3NzY5NTUzOTMsImV4cCI6MTc3Njk1NzE5M30.jgiNmDaJEZ9x7uzpOMf59fXEAI96x-TuLHeZcc4ckbc';

const instance = autocannon(
  {
    url: 'http://localhost:3000/api/v1/workspaces',
    connections: 500,
    duration: 30,
    pipelining: 1,
    requests: [
      {
        method: 'POST',
        path: '/api/v1/workspaces',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        setupRequest: (request) => {
          const uniqueId = uuidv4();
          request.body = JSON.stringify({
            name: `Stress Workspace ${uniqueId}`,
            description: 'Load testing workspace creation',
          });
          return request;
        },
      },
    ],
  },
  (err, result) => {
    if (err) {
      console.error(err);
    } else {
      console.log('--- RESULTS: CREATE WORKSPACE STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Success (2xx): ${result['2xx']}`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });

/*
Running 30s test @ http://localhost:3000/api/v1/workspaces
500 connections with 10 pipelining factor


┌─────────┬─────────┬──────────┬──────────┬──────────┬─────────────┬────────────┬──────────┐
│ Stat    │ 2.5%    │ 50%      │ 97.5%    │ 99%      │ Avg         │ Stdev      │ Max      │      ──────┼─────────┼──────────┼──────────┼──────────┼─────────────┼────────────┼──────────┤
├─────────┼─────────┼──────────┼──────────┼──────────┼─────────────┼────────────┼──────────┤      ──────┴─────────┴──────────┴──────────┴──────────┴─────────────┴────────────┴──────────┘
│ Stat    │ 2.5%    │ 50%      │ 97.5%    │ 99%      │ Avg         │ Stdev      │ Max      │
├─────────┼─────────┼──────────┼──────────┼──────────┼─────────────┼────────────┼──────────┤
│ Latency │ 8091 ms │ 11064 ms │ 18541 ms │ 18542 ms │ 12262.36 ms │ 4063.59 ms │ 18544 ms │
└─────────┴─────────┴──────────┴──────────┴──────────┴─────────────┴────────────┴──────────┘
┌───────────┬─────┬──────┬─────┬────────┬─────────┬────────┬───────┐
│ Stat      │ 1%  │ 2.5% │ 50% │ 97.5%  │ Avg     │ Stdev  │ Min   │
├───────────┼─────┼──────┼─────┼────────┼─────────┼────────┼───────┤
│ Req/Sec   │ 0   │ 0    │ 0   │ 769    │ 105.52  │ 228.18 │ 50    │
├───────────┼─────┼──────┼─────┼────────┼─────────┼────────┼───────┤
│ Bytes/Sec │ 0 B │ 0 B  │ 0 B │ 585 kB │ 80.2 kB │ 173 kB │ 38 kB │
└───────────┴─────┴──────┴─────┴────────┴─────────┴────────┴───────┘

Req/Bytes counts sampled once per second.
# of samples: 29

195k requests in 30.2s, 2.33 MB read
25k errors (7k timeouts)
--- RESULTS: CREATE WORKSPACE STRESS TEST ---
Requests/sec: 105.52
Latency (p99): 18542 ms
Success (2xx): 3060
Errors (Non-2xx): 0

500 connections with 10 pipelining factor


┌─────────┬─────────┬─────────┬─────────┬─────────┬────────────┬────────────┬─────────┐
│ Stat    │ 2.5%    │ 50%     │ 97.5%   │ 99%     │ Avg        │ Stdev      │ Max     │
├─────────┼─────────┼─────────┼─────────┼─────────┼────────────┼────────────┼─────────┤
│ Latency │ 4294 ms │ 6557 ms │ 9977 ms │ 9983 ms │ 6391.92 ms │ 1298.91 ms │ 9989 ms │
└─────────┴─────────┴─────────┴─────────┴─────────┴────────────┴────────────┴─────────┘
┌───────────┬─────┬──────┬─────┬─────────┬────────┬────────┬─────────┐
│ Stat      │ 1%  │ 2.5% │ 50% │ 97.5%   │ Avg    │ Stdev  │ Min     │
├───────────┼─────┼──────┼─────┼─────────┼────────┼────────┼─────────┤
│ Req/Sec   │ 0   │ 0    │ 0   │ 1,570   │ 333.34 │ 562.5  │ 46      │
├───────────┼─────┼──────┼─────┼─────────┼────────┼────────┼─────────┤
│ Bytes/Sec │ 0 B │ 0 B  │ 0 B │ 1.18 MB │ 251 kB │ 424 kB │ 34.6 kB │
└───────────┴─────┴──────┴─────┴─────────┴────────┴────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 30

219k requests in 30.57s, 7.53 MB read
26k errors (7k timeouts)
--- RESULTS: CREATE WORKSPACE STRESS TEST ---
Requests/sec: 333.34
Latency (p99): 9983 ms
Success (2xx): 10000
Errors (Non-2xx): 0
*/
