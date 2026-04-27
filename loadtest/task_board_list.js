const autocannon = require('autocannon');

// PASTE YOUR ACCESS TOKEN HERE
const ACCESS_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3NzcwNDAxMzAsImV4cCI6MTc3NzA0MTkzMH0.F3coT6P5fbWTsctMcvEQ0n4zJ6XlCGk81GkozCDAHoQ';

// PASTE A VALID WORKSPACE ID HERE
const WORKSPACE_ID = '45734af0-cd01-4e86-a488-ad50cf6913d0';

const instance = autocannon(
  {
    url: `http://localhost:3000/api/v1/tasks/boards?workspaceId=${WORKSPACE_ID}&page=1&limit=10`,
    method: 'GET',
    headers: {
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
      console.log('--- RESULTS: GET BOARDS LIST STRESS TEST ---');
      console.log(`Requests/sec: ${result.requests.average}`);
      console.log(`Latency (p99): ${result.latency.p99} ms`);
      console.log(`Success (2xx): ${result['2xx']}`);
      console.log(`Errors (Non-2xx): ${result.non2xx}`);
    }
  },
);

autocannon.track(instance, { renderProgressBar: true });
