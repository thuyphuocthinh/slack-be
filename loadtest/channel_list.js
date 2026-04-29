const autocannon = require('autocannon');

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3Nzc0MTk0ODcsImV4cCI6MTc3NzQyMTI4N30.mu0012ApRFUNqH2zGjWLVeSQ0vdU3ubonp7o_eB1hNg';

const WORKSPACE_ID = 'fcc5f03f-7f6e-452b-95ca-eb57c60c5ad3';

const instance = autocannon(
  {
    url: `http://localhost:3000/api/v1/workspaces/${WORKSPACE_ID}/channels`,
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
      console.log('--- RESULTS: LIST CHANNELS STRESS TEST ---');
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
500 connections with 10 pipelining factor


┌─────────┬─────────┬─────────┬─────────┬─────────┬────────────┬───────────┬─────────┐
│ Stat    │ 2.5%    │ 50%     │ 97.5%   │ 99%     │ Avg        │ Stdev     │ Max     │
├─────────┼─────────┼─────────┼─────────┼─────────┼────────────┼───────────┼─────────┤
│ Latency │ 6193 ms │ 7686 ms │ 8263 ms │ 8284 ms │ 7410.18 ms │ 863.98 ms │ 8305 ms │
└─────────┴─────────┴─────────┴─────────┴─────────┴────────────┴───────────┴─────────┘
┌───────────┬─────┬──────┬─────┬─────────┬─────────┬─────────┬────────┐
│ Stat      │ 1%  │ 2.5% │ 50% │ 97.5%   │ Avg     │ Stdev   │ Min    │
├───────────┼─────┼──────┼─────┼─────────┼─────────┼─────────┼────────┤
│ Req/Sec   │ 0   │ 0    │ 0   │ 2,073   │ 221.57  │ 494.42  │ 70     │
├───────────┼─────┼──────┼─────┼─────────┼─────────┼─────────┼────────┤
│ Bytes/Sec │ 0 B │ 0 B  │ 0 B │ 11.5 MB │ 1.23 MB │ 2.74 MB │ 388 kB │
└───────────┴─────┴──────┴─────┴─────────┴─────────┴─────────┴────────┘

Req/Bytes counts sampled once per second.
# of samples: 30

468k requests in 30.37s, 36.9 MB read
52k errors (7k timeouts)
--- RESULTS: LIST CHANNELS STRESS TEST ---
Requests/sec: 221.57
Latency (p99): 8284 ms
Success (2xx): 6647
Errors (Non-2xx): 0
*/
