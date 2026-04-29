const autocannon = require('autocannon');
const { v4: uuidv4 } = require('uuid');

// PASTE YOUR ACCESS TOKEN HERE
const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3Nzc0MTk0ODcsImV4cCI6MTc3NzQyMTI4N30.mu0012ApRFUNqH2zGjWLVeSQ0vdU3ubonp7o_eB1hNg';

// PASTE A VALID WORKSPACE ID HERE
const WORKSPACE_ID = 'fcc5f03f-7f6e-452b-95ca-eb57c60c5ad3'; // Example from previous logs

const instance = autocannon(
  {
    url: 'http://localhost:3000/api/v1/tasks/boards',
    connections: 300,
    duration: 30,
    pipelining: 1,
    requests: [
      {
        method: 'POST',
        path: '/api/v1/tasks/boards',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        setupRequest: (request) => {
          const uniqueId = uuidv4();
          request.body = JSON.stringify({
            workspaceId: WORKSPACE_ID,
            name: `Board ${uniqueId}`,
            backgroundUrl: `https://picsum.photos/seed/${uniqueId}/1200/800`,
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
      console.log('--- RESULTS: CREATE TASK BOARD STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Success (2xx): ${result['2xx']}`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });

/**
Running 30s test @ http://localhost:3000/api/v1/tasks/boards
300 connections


┌─────────┬────────┬────────┬────────┬─────────┬───────────┬──────────┬─────────┐
│ Stat    │ 2.5%   │ 50%    │ 97.5%  │ 99%     │ Avg       │ Stdev    │ Max     │
├─────────┼────────┼────────┼────────┼─────────┼───────────┼──────────┼─────────┤
│ Latency │ 641 ms │ 696 ms │ 871 ms │ 1075 ms │ 714.76 ms │ 72.66 ms │ 1153 ms │
└─────────┴────────┴────────┴────────┴─────────┴───────────┴──────────┴─────────┘
┌───────────┬─────────┬─────────┬────────┬────────┬────────┬─────────┬─────────┐
│ Stat      │ 1%      │ 2.5%    │ 50%    │ 97.5%  │ Avg    │ Stdev   │ Min     │
├───────────┼─────────┼─────────┼────────┼────────┼────────┼─────────┼─────────┤
│ Req/Sec   │ 128     │ 128     │ 396    │ 600    │ 420    │ 131.75  │ 128     │
├───────────┼─────────┼─────────┼────────┼────────┼────────┼─────────┼─────────┤
│ Bytes/Sec │ 61.5 kB │ 61.5 kB │ 190 kB │ 288 kB │ 202 kB │ 63.2 kB │ 61.4 kB │
└───────────┴─────────┴─────────┴────────┴────────┴────────┴─────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 30

0 2xx responses, 12600 non 2xx responses
13k requests in 30.21s, 6.05 MB read
--- RESULTS: CREATE TASK BOARD STRESS TEST ---
Requests/sec: 420
Latency (p99): 1075 ms
Success (2xx): 0
Errors (Non-2xx): 12600
PS E:\Career\Software_Engineer\Projects\Slack\slack-be\loadtest> 
 */
