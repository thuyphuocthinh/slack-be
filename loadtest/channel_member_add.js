const autocannon = require('autocannon');

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3Nzc0MTk0ODcsImV4cCI6MTc3NzQyMTI4N30.mu0012ApRFUNqH2zGjWLVeSQ0vdU3ubonp7o_eB1hNg';

const WORKSPACE_ID = 'fcc5f03f-7f6e-452b-95ca-eb57c60c5ad3';
const CHANNEL_ID = 'cf24757c-1333-42dd-8bf6-e48936e0a172';

const MEMBER_IDS = [
  'fe8384f6-5579-4e95-8a41-caca5bab27cf',
  'f2d55bbf-6b12-40ea-a865-4d224b013e90',
  '3c195b53-fee1-4ecc-8d0a-9e7d9238c5bb',
  '647cb596-9fbe-41f9-8a58-3e23bd248063',
  'bec813e7-a96c-4fe2-956f-7524a0768126',
];

const instance = autocannon(
  {
    url: `http://localhost:3000/api/v1/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID}/members`,
    connections: 50, // Less connections for adding members as we only have 5 targets
    duration: 10,
    pipelining: 1,
    requests: [
      {
        method: 'POST',
        path: `/api/v1/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID}/members`,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        setupRequest: (request) => {
          // Pick a random member id
          const targetMemberId =
            MEMBER_IDS[Math.floor(Math.random() * MEMBER_IDS.length)];
          request.body = JSON.stringify({
            targetMemberId,
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
      console.log('--- RESULTS: ADD CHANNEL MEMBER STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Success (2xx): ${result['2xx']}`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });
