/**
 * Seed a realistic Note dataset directly in PostgreSQL for load testing.
 * The generated rows are scoped by workspace and tagged in titles,
 * so cleanup only removes data created by this script.
 *
 * PowerShell:
 *   node loadtest/note_seed_performance_data.js
 *   $env:SEED_ACTION='cleanup'; node loadtest/note_seed_performance_data.js
 */

const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');
const crypto = require('crypto');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const WORKSPACE_ID = process.env.WORKSPACE_ID || '5f5a6f59-c969-41ec-b5f2-677cb5efa30e';
const ROWS_TO_SEED = Number(process.env.ROWS_TO_SEED || 10000);
const ACTION = (process.env.SEED_ACTION || 'seed').toLowerCase();
const TAG = `[LOADTEST:NOTE:${WORKSPACE_ID}]`;

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
        (SELECT count(*)::int FROM pages WHERE workspace_id = $1 AND title LIKE '%' || $2 || '%') AS pages,
        (SELECT count(*)::int FROM properties WHERE page_id IN (SELECT id FROM pages WHERE workspace_id = $1 AND title LIKE '%' || $2 || '%')) AS properties,
        (SELECT count(*)::int FROM property_values WHERE page_id IN (SELECT id FROM pages WHERE workspace_id = $1 AND title LIKE '%' || $2 || '%')) AS property_values
    `,
    [WORKSPACE_ID, TAG],
  );
  return result.rows[0];
}

async function cleanup() {
  await db.query('BEGIN');
  try {
    const pagesToDelete = await db.query(`SELECT id FROM pages WHERE workspace_id = $1 AND title LIKE '%' || $2 || '%'`, [WORKSPACE_ID, TAG]);
    const pageIds = pagesToDelete.rows.map(r => r.id);
    
    if (pageIds.length > 0) {
      await db.query(`DELETE FROM property_values WHERE page_id = ANY($1::uuid[])`, [pageIds]);
      await db.query(`DELETE FROM properties WHERE page_id = ANY($1::uuid[])`, [pageIds]);
      await db.query(`DELETE FROM pages WHERE id = ANY($1::uuid[])`, [pageIds]);
    }
    await db.query('COMMIT');
    console.log(`Cleanup complete: deleted ${pageIds.length} pages and related properties/values.`);
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}

async function seed() {
  const existing = await taggedCounts();
  if (existing.pages > 0) {
    throw new Error(
      `Tagged seed already exists: ${JSON.stringify(existing)}. ` +
        "Run with SEED_ACTION='cleanup' first if replacement is intentional.",
    );
  }

  console.log(`Seeding workspace=${WORKSPACE_ID}, rows=${ROWS_TO_SEED}...`);
  const startedAt = Date.now();

  await db.query('BEGIN');
  try {
    const activeMemberQuery = await db.query(
      `SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND status = 'active' LIMIT 1`,
      [WORKSPACE_ID]
    );
    if (activeMemberQuery.rowCount === 0) {
      throw new Error(`No active members found in workspace ${WORKSPACE_ID}`);
    }
    const USER_ID = activeMemberQuery.rows[0].user_id;
    const dbPageId = crypto.randomUUID();

    // 1. Create a root Database Page
    await db.query(
      `INSERT INTO pages (id, user_id, workspace_id, title, type, path, depth, "order", created_at, updated_at) 
       VALUES ($1, $2, $3, $4, 'Database'::pages_type_enum, $5, 0, 0, now(), now())`,
      [dbPageId, USER_ID, WORKSPACE_ID, `Loadtest Database ${TAG}`, `/${dbPageId}`]
    );

    // 2. Create Properties for this database
    const propTextId = crypto.randomUUID();
    const propNumberId = crypto.randomUUID();
    const propSelectId = crypto.randomUUID();
    await db.query(
      `INSERT INTO properties (id, page_id, name, "order", type, created_at, updated_at) VALUES 
       ($1, $2, 'Task Name', 0, 'text'::properties_type_enum, now(), now()),
       ($3, $2, 'Priority', 1, 'number'::properties_type_enum, now(), now()),
       ($4, $2, 'Status', 2, 'select'::properties_type_enum, now(), now())`,
      [propTextId, dbPageId, propNumberId, propSelectId]
    );

    // 3. Create N Child Pages (Rows)
    // We use generate_series to bulk insert pages
    const insertPagesQuery = await db.query(
      `
      WITH batch AS (
        SELECT 
          gen_random_uuid() AS id,
          $1::uuid AS user_id,
          $2::uuid AS workspace_id,
          $3::uuid AS parent_id,
          'Row ' || g.number || ' ' || $4 AS title,
          'Normal'::pages_type_enum AS type,
          '/' || $3 || '/' || gen_random_uuid() AS path,
          1 AS depth,
          g.number AS "order",
          now() AS created_at,
          now() AS updated_at
        FROM generate_series(1, $5::int) AS g(number)
      )
      INSERT INTO pages (id, user_id, workspace_id, parent_id, title, type, path, depth, "order", created_at, updated_at)
      SELECT id, user_id, workspace_id, parent_id, title, type, path, depth, "order", created_at, updated_at FROM batch
      RETURNING id, "order"
      `,
      [USER_ID, WORKSPACE_ID, dbPageId, TAG, ROWS_TO_SEED]
    );

    console.log(`Inserted ${insertPagesQuery.rowCount} rows. Seeding property values...`);

    // 4. Create Property Values for these Rows
    // Build a batch insert for property values using UNNEST
    const pageIds = insertPagesQuery.rows.map(r => r.id);
    const orders = insertPagesQuery.rows.map(r => r.order);
    
    // We insert 3 values per row
    await db.query(
      `
      WITH row_data AS (
        SELECT unnest($1::uuid[]) AS page_id, unnest($2::int[]) AS row_order
      )
      INSERT INTO property_values (id, page_id, property_id, value, created_at, updated_at)
      SELECT gen_random_uuid(), page_id, $3::uuid, ('{"text": "Sample Task ' || row_order || '"}')::jsonb, now(), now() FROM row_data
      UNION ALL
      SELECT gen_random_uuid(), page_id, $4::uuid, ('{"number": ' || row_order || '}')::jsonb, now(), now() FROM row_data
      UNION ALL
      SELECT gen_random_uuid(), page_id, $5::uuid, ('{"select": "Option ' || (row_order % 3) || '"}')::jsonb, now(), now() FROM row_data
      `,
      [pageIds, orders, propTextId, propNumberId, propSelectId]
    );

    await db.query('COMMIT');
    console.log(`Successfully seeded ${ROWS_TO_SEED} rows and their property values in ${Date.now() - startedAt}ms.`);
    console.log(`Database Page ID: ${dbPageId}`);
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
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
