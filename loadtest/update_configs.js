const fs = require('fs');
const path = require('path');

const dir = 'e:/Career/Software_Engineer/Projects/Slack/slack-be/loadtest';
const ACCESS_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwYmNkYTYzYi1kNzk5LTQ3NzEtYmJmYi0wYzRlOGM0MzNlM2IiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzVAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjozLCJpYXQiOjE3Nzc0MTk0ODcsImV4cCI6MTc3NzQyMTI4N30.mu0012ApRFUNqH2zGjWLVeSQ0vdU3ubonp7o_eB1hNg';
const WORKSPACE_ID = 'fcc5f03f-7f6e-452b-95ca-eb57c60c5ad3';

const files = fs.readdirSync(dir);

files.forEach(file => {
  if (file.endsWith('.js') && file !== 'auth_logout.js' && file !== 'update_configs.js' && file !== 'run_all_tests.js') {
    const filePath = path.join(dir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Improved regex to handle multiline and various quotes
    const tokenRegex = /const ACCESS_TOKEN =[\s\n\r]*['"].*?['"];/g;
    const workspaceRegex = /const WORKSPACE_ID =[\s\n\r]*['"].*?['"];/g;
    
    let changed = false;
    if (tokenRegex.test(content)) {
      content = content.replace(tokenRegex, `const ACCESS_TOKEN =\n  '${ACCESS_TOKEN}';`);
      changed = true;
    }
    if (workspaceRegex.test(content)) {
      content = content.replace(workspaceRegex, `const WORKSPACE_ID = '${WORKSPACE_ID}';`);
      changed = true;
    }
    
    if (changed) {
      fs.writeFileSync(filePath, content);
      console.log(`Updated ${file}`);
    }
  }
});
