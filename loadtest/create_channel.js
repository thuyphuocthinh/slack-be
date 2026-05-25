const autocannon = require('autocannon');
const { v4: uuidv4 } = require('uuid');

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3Nzc0MTk0ODcsImV4cCI6MTc3NzQyMTI4N30.mu0012ApRFUNqH2zGjWLVeSQ0vdU3ubonp7o_eB1hNg';

const WORKSPACE_ID = 'fcc5f03f-7f6e-452b-95ca-eb57c60c5ad3';

const instance = autocannon(
  {
    url: `http://localhost:3000/api/v1/workspaces/${WORKSPACE_ID}/channels`,
    connections: 500,
    duration: 30,
    pipelining: 1,
    requests: [
      {
        method: 'POST',
        path: `/api/v1/workspaces/${WORKSPACE_ID}/channels`,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        setupRequest: (request) => {
          const uniqueId = uuidv4();
          request.body = JSON.stringify({
            title: `Stress Channel ${uniqueId.substring(0, 8)}`,
            description: 'Load testing channel creation',
            type: 'group',
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
      console.log('--- RESULTS: CREATE CHANNEL STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Success (2xx): ${result['2xx']}`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });

/*
Running 30s test @ http://localhost:3000/api/v1/workspaces/fcc5f03f-7f6e-452b-95ca-eb57c60c5ad3/channels
500 connections


┌─────────┬────────┬─────────┬─────────┬─────────┬────────────┬────────┬─────────┐
│ Stat    │ 2.5%   │ 50%     │ 97.5%   │ 99%     │ Avg        │ Stdev  │ Max     │
├─────────┼────────┼─────────┼─────────┼─────────┼────────────┼────────┼─────────┤
│ Latency │ 915 ms │ 1038 ms │ 1966 ms │ 2484 ms │ 1081.93 ms │ 244 ms │ 2795 ms │
└─────────┴────────┴─────────┴─────────┴─────────┴────────────┴────────┴─────────┘
┌───────────┬─────┬──────┬────────┬────────┬────────┬─────────┬────────┐
│ Stat      │ 1%  │ 2.5% │ 50%    │ 97.5%  │ Avg    │ Stdev   │ Min    │
├───────────┼─────┼──────┼────────┼────────┼────────┼─────────┼────────┤
│ Req/Sec   │ 0   │ 0    │ 500    │ 577    │ 456.8  │ 120.69  │ 185    │
├───────────┼─────┼──────┼────────┼────────┼────────┼─────────┼────────┤
│ Bytes/Sec │ 0 B │ 0 B  │ 369 kB │ 426 kB │ 337 kB │ 89.1 kB │ 137 kB │
└───────────┴─────┴──────┴────────┴────────┴────────┴─────────┴────────┘

Req/Bytes counts sampled once per second.
# of samples: 30

14k requests in 30.34s, 10.1 MB read
--- RESULTS: CREATE CHANNEL STRESS TEST ---
Requests/sec: 456.8
Latency (p99): 2484 ms
Success (2xx): 13704
Errors (Non-2xx): 0
*/
