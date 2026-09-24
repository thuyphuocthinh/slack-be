const { execSync } = require('child_process');
const pidusage = require('pidusage');
const fs = require('fs');

const TARGET_APP = 'note';
const OUTPUT_FILE = 'loadtest/stats.json';
const INTERVAL = 1000;

console.log(`Finding PID for pm2 app: ${TARGET_APP}...`);
let pid = null;
try {
  const stdout = execSync('pm2 jlist', { encoding: 'utf-8' });
  const processes = JSON.parse(stdout);
  const app = processes.find(p => p.name === TARGET_APP);
  if (app) {
    pid = app.pid;
    console.log(`Found PID: ${pid}`);
  }
} catch (e) {
  console.error('Failed to get pm2 jlist', e);
  process.exit(1);
}

if (!pid) {
  console.error(`App ${TARGET_APP} not found in pm2.`);
  process.exit(1);
}

let stats = [];
console.log(`Monitoring PID ${pid} every ${INTERVAL}ms. Output: ${OUTPUT_FILE}`);

setInterval(async () => {
  try {
    const stat = await pidusage(pid);
    const memoryMB = Math.round(stat.memory / 1024 / 1024);
    const cpu = stat.cpu.toFixed(1);
    const time = new Date().toISOString();
    
    stats.push({ time, memoryMB, cpu });
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(stats, null, 2));
    
    process.stdout.write(`\r[${time}] RAM: ${memoryMB} MB | CPU: ${cpu}%`);
  } catch (err) {
    console.error('\nError getting stats:', err.message);
  }
}, INTERVAL);
