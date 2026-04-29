const autocannon = require('autocannon');
const { v4: uuidv4 } = require('uuid');

const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3Nzc0MTk0ODcsImV4cCI6MTc3NzQyMTI4N30.mu0012ApRFUNqH2zGjWLVeSQ0vdU3ubonp7o_eB1hNg';

const WORKSPACE_ID = 'fcc5f03f-7f6e-452b-95ca-eb57c60c5ad3';
// Update with an actual channel ID from your database
const CHANNEL_ID = 'cf24757c-1333-42dd-8bf6-e48936e0a172';

const instance = autocannon(
  {
    url: `http://localhost:3000/api/v1/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID}`,
    connections: 500,
    duration: 30,
    pipelining: 1,
    requests: [
      {
        method: 'PATCH',
        path: `/api/v1/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID}`,
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        setupRequest: (request) => {
          const uniqueId = uuidv4();
          request.body = JSON.stringify({
            title: `Updated Channel ${uniqueId.substring(0, 8)}`,
            description: `Updated description ${uniqueId}`,
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
      console.log('--- RESULTS: UPDATE CHANNEL STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Success (2xx): ${result['2xx']}`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });
