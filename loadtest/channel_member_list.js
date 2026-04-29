const autocannon = require('autocannon');

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3Nzc0MTk0ODcsImV4cCI6MTc3NzQyMTI4N30.mu0012ApRFUNqH2zGjWLVeSQ0vdU3ubonp7o_eB1hNg';

const WORKSPACE_ID = 'fcc5f03f-7f6e-452b-95ca-eb57c60c5ad3';
const CHANNEL_ID = 'cf24757c-1333-42dd-8bf6-e48936e0a172';

const instance = autocannon(
  {
    url: `http://localhost:3000/api/v1/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID}/members`,
    method: 'GET',
    headers: {
      'content-type': 'application/json',
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
      console.log('--- RESULTS: LIST CHANNEL MEMBERS STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Success (2xx): ${result['2xx']}`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });

/*
500 connections with 10 pipelining factor


┌─────────┬─────────┬─────────┬─────────┬─────────┬────────────┬────────────┬─────────┐
│ Stat    │ 2.5%    │ 50%     │ 97.5%   │ 99%     │ Avg        │ Stdev      │ Max     │
├─────────┼─────────┼─────────┼─────────┼─────────┼────────────┼────────────┼─────────┤
│ Latency │ 1298 ms │ 8502 ms │ 9465 ms │ 9492 ms │ 7859.34 ms │ 2082.53 ms │ 9507 ms │
└─────────┴─────────┴─────────┴─────────┴─────────┴────────────┴────────────┴─────────┘
┌───────────┬─────┬──────┬─────┬────────┬────────┬──────────┬─────────┐
│ Stat      │ 1%  │ 2.5% │ 50% │ 97.5%  │ Avg    │ Stdev    │ Min     │
├───────────┼─────┼──────┼─────┼────────┼────────┼──────────┼─────────┤
│ Req/Sec   │ 0   │ 0    │ 0   │ 3,605  │ 553    │ 1,070.94 │ 1,001   │
├───────────┼─────┼──────┼─────┼────────┼────────┼──────────┼─────────┤
│ Bytes/Sec │ 0 B │ 0 B  │ 0 B │ 5.2 MB │ 798 kB │ 1.55 MB  │ 1.44 MB │
└───────────┴─────┴──────┴─────┴────────┴────────┴──────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 30

22k requests in 30.29s, 23.9 MB read
--- RESULTS: LIST CHANNEL MEMBERS STRESS TEST ---
Requests/sec: 553
Latency (p99): 9492 ms
Success (2xx): 16586
Errors (Non-2xx): 0

1. Index channelId
2. Denormalize channel member. If user updates, just sync async using queue => eventual consistency.
3. Bỏ snakeCase mapping
*/
