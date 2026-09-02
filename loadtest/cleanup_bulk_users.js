/**
 * Dọn toàn bộ user giả tạo bởi seed_bulk_users.js (email LIKE
 * 'loadtest_bulk_%'). Xóa theo đúng thứ tự để tránh mồ côi dữ liệu — DB
 * KHÔNG có FK constraint ràng buộc các bảng này (đã kiểm tra
 * information_schema/pg_constraint), nên tự đảm bảo thứ tự bằng tay:
 *
 *   attendance_logs -> daily_reconciliations -> work_shifts
 *     -> calendar_requests -> calendar_user_locks
 *     -> channel_members -> workspace_members -> users
 *
 * (attendance_logs có ON DELETE CASCADE từ work_shifts, nhưng vẫn xóa tay
 * trước cho chắc — user_id trên attendance_logs độc lập với work_shift_id).
 *
 * Chạy: node loadtest/cleanup_bulk_users.js
 *       node loadtest/cleanup_bulk_users.js --dry-run   (chỉ đếm, không xóa)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');

const EMAIL_PATTERN = 'loadtest_bulk_%';
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const client = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'postgres',
    database: process.env.DB_NAME || 'slack_db',
  });
  await client.connect();

  const { rows } = await client.query(
    `SELECT id FROM users WHERE email LIKE $1`,
    [EMAIL_PATTERN],
  );
  const userIds = rows.map((r) => r.id);
  console.log(`Tìm thấy ${userIds.length} user giả (email LIKE '${EMAIL_PATTERN}').`);

  if (userIds.length === 0) {
    console.log('Không có gì để dọn.');
    await client.end();
    return;
  }

  if (DRY_RUN) {
    const counts = {};
    for (const table of [
      ['attendance_logs', 'user_id'],
      ['daily_reconciliations', 'user_id'],
      ['work_shifts', 'user_id'],
      ['calendar_requests', 'user_id'],
      ['calendar_user_locks', 'user_id'],
      ['channel_members', 'member_id'],
      ['workspace_members', 'user_id'],
    ]) {
      const [table_name, col] = table;
      const r = await client.query(
        `SELECT count(*)::int AS cnt FROM ${table_name} WHERE ${col} = ANY($1::uuid[])`,
        [userIds],
      );
      counts[table_name] = r.rows[0].cnt;
    }
    console.log('Dry-run — số dòng SẼ bị xóa:', counts);
    await client.end();
    return;
  }

  await client.query('BEGIN');
  try {
    const del = async (table, col) => {
      const r = await client.query(
        `DELETE FROM ${table} WHERE ${col} = ANY($1::uuid[])`,
        [userIds],
      );
      console.log(`  ${table}: xóa ${r.rowCount} dòng`);
    };

    await del('attendance_logs', 'user_id');
    await del('daily_reconciliations', 'user_id');
    await del('work_shifts', 'user_id');
    await del('calendar_requests', 'user_id');
    await del('calendar_user_locks', 'user_id');
    await del('channel_members', 'member_id');
    await del('workspace_members', 'user_id');
    await del('users', 'id');

    await client.query('COMMIT');
    console.log(`\n✅ Đã dọn xong ${userIds.length} user giả.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('❌ Failed:', error);
  process.exit(1);
});
