const autocannon = require('autocannon');

const instance = autocannon(
  {
    url: 'http://localhost:3000/api/v1/auth/login',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: 'thuyphuocthinhtpt+5@gmail.com',
      password: '123456Aa',
    }),
    connections: 500,
    duration: 30,
    pipelining: 1,
  },
  (err, result) => {
    if (err) {
      console.error(err);
    } else {
      console.log('--- RESULTS: LOGIN STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });

/**
Running 30s test @ http://localhost:3000/api/v1/auth/login
100 connections


┌─────────┬─────────┬─────────┬─────────┬─────────┬────────────┬───────────┬─────────┐
│ Stat    │ 2.5%    │ 50%     │ 97.5%   │ 99%     │ Avg        │ Stdev     │ Max     │
├─────────┼─────────┼─────────┼─────────┼─────────┼────────────┼───────────┼─────────┤
│ Latency │ 1412 ms │ 1765 ms │ 1848 ms │ 2208 ms │ 1758.55 ms │ 340.06 ms │ 5670 ms │
└─────────┴─────────┴─────────┴─────────┴─────────┴────────────┴───────────┴─────────┘
┌───────────┬─────┬──────┬─────────┬─────────┬─────────┬─────────┬─────────┐
│ Stat      │ 1%  │ 2.5% │ 50%     │ 97.5%   │ Avg     │ Stdev   │ Min     │
├───────────┼─────┼──────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Req/Sec   │ 0   │ 0    │ 56      │ 72      │ 55.44   │ 10.89   │ 54      │
├───────────┼─────┼──────┼─────────┼─────────┼─────────┼─────────┼─────────┤
│ Bytes/Sec │ 0 B │ 0 B  │ 25.8 kB │ 33.6 kB │ 25.6 kB │ 5.05 kB │ 24.9 kB │
└───────────┴─────┴──────┴─────────┴─────────┴─────────┴─────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 30

30 2xx responses, 1633 non 2xx responses
2k requests in 30.2s, 768 kB read
--- RESULTS: LOGIN STRESS TEST ---
Requests/sec: 55.44
Latency (p99): 2208 ms
Errors (Non-2xx): 1633
 */

/*

100 connections


┌─────────┬────────┬─────────┬─────────┬─────────┬────────────┬───────────┬─────────┐
│ Stat    │ 2.5%   │ 50%     │ 97.5%   │ 99%     │ Avg        │ Stdev     │ Max     │
├─────────┼────────┼─────────┼─────────┼─────────┼────────────┼───────────┼─────────┤
│ Latency │ 837 ms │ 1752 ms │ 2089 ms │ 2121 ms │ 1732.57 ms │ 235.55 ms │ 2134 ms │
└─────────┴────────┴─────────┴─────────┴─────────┴────────────┴───────────┴─────────┘
┌───────────┬─────┬──────┬─────────┬────────┬─────────┬─────────┬─────────┐
│ Stat      │ 1%  │ 2.5% │ 50%     │ 97.5%  │ Avg     │ Stdev   │ Min     │
├───────────┼─────┼──────┼─────────┼────────┼─────────┼─────────┼─────────┤
│ Req/Sec   │ 0   │ 0    │ 57      │ 147    │ 56.34   │ 22.01   │ 1       │
├───────────┼─────┼──────┼─────────┼────────┼─────────┼─────────┼─────────┤
│ Bytes/Sec │ 0 B │ 0 B  │ 61.9 kB │ 160 kB │ 61.1 kB │ 23.9 kB │ 1.08 kB │
└───────────┴─────┴──────┴─────────┴────────┴─────────┴─────────┴─────────┘

Req/Bytes counts sampled once per second.
# of samples: 30

2k requests in 30.21s, 1.83 MB read
--- RESULTS: LOGIN STRESS TEST ---
Requests/sec: 56.34
Latency (p99): 2121 ms
Errors (Non-2xx): 0
*/
