/**
 * Collect PM2 CPU/RAM and PostgreSQL query/connection metrics while k6 runs.
 *
 * Required DB variables are read from the current environment or slack-be/.env:
 * DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME, DB_SSL.
 * pg_stat_statements is optional; when unavailable, connection samples and
 * dataset size are still collected and the report explains the limitation.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const execFileAsync = promisify(execFile);
const WORKSPACE_ID = process.env.WORKSPACE_ID || '5f5a6f59-c969-41ec-b5f2-677cb5efa30e';
const INTERVAL_MS = Number(process.env.METRICS_INTERVAL_MS || 3000);
const COLLECT_SECONDS = Number(process.env.COLLECT_SECONDS || 180);
const OUTPUT_DIR = path.resolve(process.env.RESULTS_DIR || path.join(__dirname, 'results'));
const PM2_APPS = new Set(
  (process.env.PM2_APPS || 'api-gateway,calendar,workspace')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean),
);

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const RESOURCE_CSV = path.join(OUTPUT_DIR, 'calendar-resource-usage.csv');
const DB_CSV = path.join(OUTPUT_DIR, 'calendar-db-connections.csv');
const REPORT_JSON = path.join(OUTPUT_DIR, 'calendar-server-metrics.json');

fs.writeFileSync(RESOURCE_CSV, 'timestamp,app,pid,cpu_percent,memory_bytes\n');
fs.writeFileSync(
  DB_CSV,
  'timestamp,total_connections,active,idle,idle_in_transaction,max_connections,usage_percent\n',
);

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'slack_db',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

let stopping = false;
let timer;
let baselineStatements = new Map();
let pgStatStatementsAvailable = false;
const errors = [];
const resourceSummary = new Map();
const dbConnectionSummary = {
  samples: 0,
  maxTotal: 0,
  maxActive: 0,
  maxIdleInTransaction: 0,
  maxUsagePercent: 0,
};

const relevantQuerySql = `
  SELECT queryid::text AS query_id,
         query,
         calls::bigint AS calls,
         total_exec_time::double precision AS total_exec_time_ms,
         rows::bigint AS rows
  FROM pg_stat_statements
  WHERE query ILIKE ANY (ARRAY[
    '%work_shifts%',
    '%attendance_logs%',
    '%daily_reconciliations%',
    '%calendar_requests%',
    '%calendar_user_locks%'
  ])
    AND query NOT ILIKE '%pg_stat_statements%'
`;

function appendCsv(file, values) {
  fs.appendFileSync(file, `${values.join(',')}\n`);
}

async function capturePm2(timestamp) {
  try {
    const executable = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'pm2';
    const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'pm2 jlist'] : ['jlist'];
    const { stdout } = await execFileAsync(executable, args, {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    const processes = JSON.parse(stdout);
    for (const processInfo of processes) {
      const name = processInfo.pm2_env?.name;
      if (!PM2_APPS.has(name)) continue;
      const cpu = Number(processInfo.monit?.cpu || 0);
      const memory = Number(processInfo.monit?.memory || 0);
      const summary = resourceSummary.get(name) || {
        samples: 0,
        cpuSum: 0,
        cpuMax: 0,
        memorySumBytes: 0,
        memoryMaxBytes: 0,
      };
      summary.samples += 1;
      summary.cpuSum += cpu;
      summary.cpuMax = Math.max(summary.cpuMax, cpu);
      summary.memorySumBytes += memory;
      summary.memoryMaxBytes = Math.max(summary.memoryMaxBytes, memory);
      resourceSummary.set(name, summary);
      appendCsv(RESOURCE_CSV, [
        timestamp,
        name,
        processInfo.pid || '',
        processInfo.monit?.cpu ?? '',
        processInfo.monit?.memory ?? '',
      ]);
    }
  } catch (error) {
    errors.push(`PM2 capture failed: ${error.message}`);
  }
}

async function captureDbConnections(timestamp) {
  try {
    const result = await db.query(`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE state = 'active')::int AS active,
             count(*) FILTER (WHERE state = 'idle')::int AS idle,
             count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_transaction,
             current_setting('max_connections')::int AS max_connections
      FROM pg_stat_activity
    `);
    const row = result.rows[0];
    const usagePercent = (row.total / row.max_connections) * 100;
    dbConnectionSummary.samples += 1;
    dbConnectionSummary.maxTotal = Math.max(dbConnectionSummary.maxTotal, row.total);
    dbConnectionSummary.maxActive = Math.max(dbConnectionSummary.maxActive, row.active);
    dbConnectionSummary.maxIdleInTransaction = Math.max(
      dbConnectionSummary.maxIdleInTransaction,
      row.idle_in_transaction,
    );
    dbConnectionSummary.maxUsagePercent = Math.max(
      dbConnectionSummary.maxUsagePercent,
      usagePercent,
    );
    appendCsv(DB_CSV, [
      timestamp,
      row.total,
      row.active,
      row.idle,
      row.idle_in_transaction,
      row.max_connections,
      usagePercent.toFixed(2),
    ]);
  } catch (error) {
    errors.push(`DB connection capture failed: ${error.message}`);
  }
}

async function readStatements() {
  const result = await db.query(relevantQuerySql);
  return new Map(result.rows.map((row) => [row.query_id, row]));
}

async function readDatasetSize() {
  const result = await db.query(
    `
      SELECT
        (
          SELECT count(*)::int
          FROM workspace_members
          WHERE workspace_id = $1 AND status = 'active'
        ) AS active_members,
        (
          SELECT count(DISTINCT user_id)::int
          FROM work_shifts
          WHERE workspace_id = $1
        ) AS users_with_shifts,
        (
          SELECT count(*)::int
          FROM work_shifts
          WHERE workspace_id = $1
        ) AS shifts,
        (
          SELECT count(*)::int
          FROM attendance_logs al
          INNER JOIN work_shifts ws ON ws.id = al.work_shift_id
          WHERE ws.workspace_id = $1
        ) AS attendance_logs
    `,
    [WORKSPACE_ID],
  );
  return result.rows[0];
}

function statementDeltas(finalStatements) {
  const deltas = [];
  for (const [queryId, finalRow] of finalStatements) {
    const before = baselineStatements.get(queryId);
    const calls = Number(finalRow.calls) - Number(before?.calls || 0);
    const totalExecTimeMs =
      Number(finalRow.total_exec_time_ms) - Number(before?.total_exec_time_ms || 0);
    const rows = Number(finalRow.rows) - Number(before?.rows || 0);
    if (calls <= 0) continue;
    deltas.push({
      queryId,
      calls,
      totalExecTimeMs: Number(totalExecTimeMs.toFixed(3)),
      meanExecTimeMs: Number((totalExecTimeMs / calls).toFixed(3)),
      rows,
      query: finalRow.query.replace(/\s+/g, ' ').trim(),
    });
  }
  return deltas.sort((left, right) => right.totalExecTimeMs - left.totalExecTimeMs);
}

async function tick() {
  const timestamp = new Date().toISOString();
  await Promise.all([capturePm2(timestamp), captureDbConnections(timestamp)]);
}

async function stop(reason) {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);

  let finalStatements = new Map();
  let dataset = null;
  try {
    if (pgStatStatementsAvailable) finalStatements = await readStatements();
    dataset = await readDatasetSize();
  } catch (error) {
    errors.push(`Final DB snapshot failed: ${error.message}`);
  }

  const report = {
    stoppedAt: new Date().toISOString(),
    reason,
    workspaceId: WORKSPACE_ID,
    intervalMs: INTERVAL_MS,
    dataset,
    resources: Object.fromEntries(
      [...resourceSummary.entries()].map(([name, summary]) => [
        name,
        {
          samples: summary.samples,
          averageCpuPercent: Number((summary.cpuSum / summary.samples).toFixed(2)),
          peakCpuPercent: summary.cpuMax,
          averageMemoryBytes: Math.round(summary.memorySumBytes / summary.samples),
          peakMemoryBytes: summary.memoryMaxBytes,
        },
      ]),
    ),
    dbConnections: {
      ...dbConnectionSummary,
      maxUsagePercent: Number(dbConnectionSummary.maxUsagePercent.toFixed(2)),
    },
    pgStatStatementsAvailable,
    queryDeltas: pgStatStatementsAvailable ? statementDeltas(finalStatements) : [],
    files: {
      resourceCsv: RESOURCE_CSV,
      dbConnectionsCsv: DB_CSV,
    },
    errors: [...new Set(errors)],
  };
  fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
  await db.end().catch(() => undefined);
  console.log(`Server metrics written to ${REPORT_JSON}`);
  process.exit(0);
}

async function main() {
  await db.connect();
  const dataset = await readDatasetSize();
  console.log('Calendar dataset:', dataset);

  try {
    baselineStatements = await readStatements();
    pgStatStatementsAvailable = true;
    console.log(`Captured ${baselineStatements.size} pg_stat_statements baselines.`);
  } catch (error) {
    errors.push(`pg_stat_statements unavailable: ${error.message}`);
    console.warn('pg_stat_statements unavailable; query deltas will be omitted.');
  }

  await tick();
  timer = setInterval(tick, INTERVAL_MS);
  setTimeout(() => stop('duration_elapsed'), COLLECT_SECONDS * 1000);
  console.log(`Collecting server metrics for up to ${COLLECT_SECONDS}s in ${OUTPUT_DIR}`);
  if (process.send) {
    process.send({ type: 'ready', pgStatStatementsAvailable });
  }
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('message', (message) => {
  if (message?.type === 'stop') stop('runner_finished');
});
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
