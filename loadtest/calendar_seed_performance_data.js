/**
 * Seed a realistic Calendar dataset directly in PostgreSQL for load testing.
 * The generated rows are scoped by workspace/month and tagged in work_shifts.notes,
 * so cleanup only removes data created by this script.
 *
 * PowerShell:
 *   node loadtest/calendar_seed_performance_data.js
 *   $env:SEED_ACTION='cleanup'; node loadtest/calendar_seed_performance_data.js
 */

const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const WORKSPACE_ID =
  process.env.WORKSPACE_ID || '5f5a6f59-c969-41ec-b5f2-677cb5efa30e';
const MONTH = process.env.MONTH || '2026-09';
const LOGS_PER_SHIFT = Number(process.env.LOGS_PER_SHIFT || 10);
const ACTION = (process.env.SEED_ACTION || 'seed').toLowerCase();
const TAG = `[LOADTEST:CALENDAR:${WORKSPACE_ID}:${MONTH}]`;

if (!/^\d{4}-\d{2}$/.test(MONTH)) throw new Error(`Invalid MONTH=${MONTH}`);
if (!Number.isInteger(LOGS_PER_SHIFT) || LOGS_PER_SHIFT < 2 || LOGS_PER_SHIFT > 50) {
  throw new Error('LOGS_PER_SHIFT must be an integer between 2 and 50.');
}
if (!['seed', 'cleanup'].includes(ACTION)) {
  throw new Error('SEED_ACTION must be seed or cleanup.');
}

const db = new Client({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || 'postgres',
  database: process.env.DB_NAME || 'slack_db',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

async function taggedCounts() {
  const result = await db.query(
    `
      SELECT
        count(DISTINCT ws.id)::int AS shifts,
        count(DISTINCT dr.id)::int AS reconciliations,
        count(DISTINCT al.id)::int AS attendance_logs
      FROM work_shifts ws
      LEFT JOIN daily_reconciliations dr ON dr.work_shift_id = ws.id
      LEFT JOIN attendance_logs al ON al.work_shift_id = ws.id
      WHERE ws.workspace_id = $1 AND ws.notes = $2
    `,
    [WORKSPACE_ID, TAG],
  );
  return result.rows[0];
}

async function cleanup() {
  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [TAG]);
    const reconciliations = await db.query(
      `
        DELETE FROM daily_reconciliations
        WHERE work_shift_id IN (
          SELECT id FROM work_shifts
          WHERE workspace_id = $1 AND notes = $2
        )
      `,
      [WORKSPACE_ID, TAG],
    );
    const shifts = await db.query(
      'DELETE FROM work_shifts WHERE workspace_id = $1 AND notes = $2',
      [WORKSPACE_ID, TAG],
    );
    await db.query('COMMIT');
    console.log(
      `Cleanup complete: shifts=${shifts.rowCount}, reconciliations=${reconciliations.rowCount}. ` +
        'Attendance logs were removed by ON DELETE CASCADE.',
    );
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function seed() {
  const existing = await taggedCounts();
  if (existing.shifts > 0) {
    throw new Error(
      `Tagged seed already exists: ${JSON.stringify(existing)}. ` +
        "Run with SEED_ACTION='cleanup' first if replacement is intentional.",
    );
  }

  const conflicting = await db.query(
    `
      SELECT
        (SELECT count(*)::int FROM work_shifts
         WHERE workspace_id = $1 AND work_date >= ($2 || '-01')::date
           AND work_date < (($2 || '-01')::date + interval '1 month')) AS shifts,
        (SELECT count(*)::int FROM daily_reconciliations
         WHERE workspace_id = $1 AND work_date >= ($2 || '-01')::date
           AND work_date < (($2 || '-01')::date + interval '1 month')) AS reconciliations
    `,
    [WORKSPACE_ID, MONTH],
  );
  if (conflicting.rows[0].shifts > 0 || conflicting.rows[0].reconciliations > 0) {
    throw new Error(
      `Workspace already has Calendar data in ${MONTH}: ${JSON.stringify(conflicting.rows[0])}. ` +
        'Choose another month to avoid touching real data.',
    );
  }

  console.log(
    `Seeding workspace=${WORKSPACE_ID}, month=${MONTH}, logs/shift=${LOGS_PER_SHIFT}...`,
  );
  const startedAt = Date.now();

  await db.query('BEGIN');
  try {
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [TAG]);
    const result = await db.query(
      `
        WITH active_members AS (
          SELECT user_id
          FROM workspace_members
          WHERE workspace_id = $1 AND status = 'active'
        ),
        work_days AS (
          SELECT day::date AS work_date
          FROM generate_series(
            ($2 || '-01')::date,
            (($2 || '-01')::date + interval '1 month - 1 day')::date,
            interval '1 day'
          ) AS day
          WHERE extract(isodow FROM day) BETWEEN 1 AND 5
        ),
        inserted_shifts AS (
          INSERT INTO work_shifts (
            user_id, workspace_id, work_date, location, start_time, end_time,
            status, notes, created_at, updated_at
          )
          SELECT
            member.user_id,
            $1,
            work_day.work_date,
            CASE WHEN mod(abs(hashtext(member.user_id::text)::bigint), 5) = 0
              THEN 'WFH'::work_shift_location_enum
              ELSE 'OFFICE'::work_shift_location_enum
            END,
            work_day.work_date + time '01:00:00',
            work_day.work_date + time '10:00:00',
            'APPROVED'::work_shift_status_enum,
            $3,
            now(),
            now()
          FROM active_members member
          CROSS JOIN work_days work_day
          RETURNING id, user_id, workspace_id, work_date, start_time, end_time
        ),
        inserted_logs AS (
          INSERT INTO attendance_logs (
            user_id, workspace_id, work_shift_id, log_type, recorded_at,
            ip_address, created_at
          )
          SELECT
            shift.user_id,
            shift.workspace_id,
            shift.id,
            CASE WHEN mod(sequence.number, 2) = 1
              THEN 'CHECK_IN'::attendance_log_type_enum
              ELSE 'CHECK_OUT'::attendance_log_type_enum
            END,
            shift.start_time + sequence.number *
              ((shift.end_time - shift.start_time) / ($4 + 1)),
            '127.0.0.1',
            now()
          FROM inserted_shifts shift
          CROSS JOIN generate_series(1, $4) AS sequence(number)
          RETURNING id
        )
        INSERT INTO daily_reconciliations (
          user_id, workspace_id, work_shift_id, work_date,
          first_check_in, last_check_out, actual_work_hours,
          standard_work_hours, late_minutes, early_leave_minutes,
          status, created_at, updated_at
        )
        SELECT
          shift.user_id,
          shift.workspace_id,
          shift.id,
          shift.work_date,
          shift.start_time + interval '5 minutes',
          shift.end_time - interval '5 minutes',
          8.0,
          8.0,
          CASE WHEN mod(abs(hashtext(shift.user_id::text || shift.work_date::text)::bigint), 10) = 0
            THEN 15 ELSE 0 END,
          0,
          CASE
            WHEN mod(abs(hashtext(shift.user_id::text || shift.work_date::text)::bigint), 20) = 0
              THEN 'ABSENT'::daily_reconciliation_status_enum
            WHEN mod(abs(hashtext(shift.user_id::text || shift.work_date::text)::bigint), 10) = 0
              THEN 'LATE_EARLY'::daily_reconciliation_status_enum
            WHEN mod(abs(hashtext(shift.user_id::text || shift.work_date::text)::bigint), 25) = 0
              THEN 'LEAVE_PAID_APPROVED'::daily_reconciliation_status_enum
            ELSE 'NORMAL'::daily_reconciliation_status_enum
          END,
          now(),
          now()
        FROM inserted_shifts shift
      `,
      [WORKSPACE_ID, MONTH, TAG, LOGS_PER_SHIFT],
    );
    await db.query('COMMIT');
    console.log(`Inserted ${result.rowCount} reconciliations in ${Date.now() - startedAt}ms.`);
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }

  console.log('Seed counts:', await taggedCounts());
  console.log(`Tag: ${TAG}`);
}

async function main() {
  await db.connect();
  try {
    if (ACTION === 'cleanup') await cleanup();
    else await seed();
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
