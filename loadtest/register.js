const autocannon = require('autocannon');
const { v4: uuidv4 } = require('uuid');
let counter = 0;

function createRequest(client) {
  counter++;
  const uniqueId = uuidv4();
  const body = JSON.stringify({
    email: `stress_${counter}_${uniqueId}@test.com`,
    password: 'Password123!',
  });

  client.setBody(body);
}

const instance = autocannon(
  {
    url: 'http://localhost:3000/api/v1/auth/register',
    connections: 500,
    duration: 30,
    pipelining: 10,
    requests: [
      {
        method: 'POST',
        path: '/api/v1/auth/register',
        headers: {
          'content-type': 'application/json',
        },
        setupRequest: (request) => {
          counter++;
          const uniqueId = uuidv4();
          request.body = JSON.stringify({
            email: `stress_${counter}_${uniqueId}@test.com`,
            password: 'Password123!',
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
      console.log('--- RESULTS: REGISTER STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);
      console.log(`Success (2xx): ${result['2xx']}`);
      console.log(
        'Note: If Success is high and Latency is low, the optimization worked!',
      );
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });

/*
Running 30s test @ http://localhost:3000/api/v1/auth/register
50 connections


┌─────────┬───────┬───────┬────────┬────────┬──────────┬──────────┬─────────┐
│ Stat    │ 2.5%  │ 50%   │ 97.5%  │ 99%    │ Avg      │ Stdev    │ Max     │
├─────────┼───────┼───────┼────────┼────────┼──────────┼──────────┼─────────┤
│ Latency │ 54 ms │ 66 ms │ 116 ms │ 131 ms │ 71.51 ms │ 34.16 ms │ 1105 ms │
└─────────┴───────┴───────┴────────┴────────┴──────────┴──────────┴─────────┘
├───────────┼────────┼────────┼────────┼────────┼────────┼─────────┼────────┤
│ Bytes/Sec │ 154 kB │ 154 kB │ 346 kB │ 383 kB │ 333 kB │ 53.3 kB │ 154 kB │
└───────────┴────────┴────────┴────────┴────────┴────────┴─────────┴────────┘

Req/Bytes counts sampled once per second.
# of samples: 30

50 2xx responses, 20821 non 2xx responses
21k requests in 30.14s, 9.98 MB read
--- RESULTS: REGISTER STRESS TEST ---
Requests/sec: 695.7
Latency (p99): 131 ms
Errors (Non-2xx): 20821
Note: High errors might mean DB connection limits or unique constraint issues.
*/
