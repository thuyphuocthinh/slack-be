/**
 * Starts the server-metrics collector and k6 together.
 *
 * PowerShell example:
 *   $env:TOKEN='<admin access token>'
 *   $env:TEST_TYPE='statistics' # list | detail | statistics | mixed
 *   $env:PROFILE='load'    # smoke | load | stress
 *   node loadtest/calendar_performance_run.js
 */

const fs = require('fs');
const path = require('path');
const { fork, spawn } = require('child_process');

if (!process.env.TOKEN) {
  console.error('Missing TOKEN environment variable. Use a fresh admin access token.');
  process.exit(1);
}

const runId = new Date().toISOString().replace(/[:.]/g, '-');
const resultsDir = path.resolve(__dirname, 'results', `calendar-${runId}`);
fs.mkdirSync(resultsDir, { recursive: true });

const workspaceId =
  process.env.WORKSPACE_ID || '5f5a6f59-c969-41ec-b5f2-677cb5efa30e';
const commonEnv = {
  ...process.env,
  WORKSPACE_ID: workspaceId,
  RESULTS_DIR: resultsDir,
  SUMMARY_FILE: path.join(resultsDir, 'calendar-k6-summary.json').replace(/\\/g, '/'),
};

console.log(`Results directory: ${resultsDir}`);
console.log(
  `Workspace=${workspaceId} type=${commonEnv.TEST_TYPE || 'statistics'} profile=${commonEnv.PROFILE || 'load'}`,
);

const collector = fork(
  path.join(__dirname, 'calendar_metrics_collector.js'),
  [],
  { env: commonEnv, stdio: ['inherit', 'inherit', 'inherit', 'ipc'], windowsHide: true },
);

let k6;

let exiting = false;
function finish(exitCode) {
  if (exiting) return;
  exiting = true;
  if (collector.connected) collector.send({ type: 'stop' });
  const forceExit = setTimeout(() => {
    if (!collector.killed) collector.kill();
    process.exit(exitCode);
  }, 10_000);
  collector.once('exit', () => {
    clearTimeout(forceExit);
    process.exit(exitCode);
  });
}

collector.on('message', (message) => {
  if (message?.type !== 'ready' || k6) return;
  if (!message.pgStatStatementsAvailable) {
    console.warn(
      'WARNING: pg_stat_statements is unavailable; DB query deltas will be empty.',
    );
  }
  k6 = spawn(
    'k6',
    ['run', path.join(__dirname, 'calendar_read_performance.k6.js')],
    { env: commonEnv, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  k6.on('error', (error) => {
    console.error(`Could not start k6: ${error.message}`);
    finish(1);
  });
  k6.on('exit', (code) => finish(code || 0));
});
collector.on('exit', (code) => {
  if (!exiting && code && code !== 0) {
    console.error(`Metrics collector exited early with code ${code}.`);
    if (!k6) finish(code);
  }
});
process.on('SIGINT', () => finish(130));
process.on('SIGTERM', () => finish(143));
