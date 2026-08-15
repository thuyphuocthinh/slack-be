/**
 * heavy_v3.md nhóm II3 — 1 transaction CỐ TÌNH kéo dài qua pgbouncer
 * (POOL_MODE=transaction), so sánh với chạy thẳng Postgres (không qua
 * pgbouncer) — xem có bị "server closed the connection unexpectedly"/lỗi cắt
 * ngang giữa chừng không.
 *
 * LƯU Ý: không có endpoint nào trong app hiện tại mở 1 `dataSource.transaction()`
 * dài tương đương (chèn hàng chục nghìn dòng trong 1 transaction) — nên script
 * này mô phỏng TRỰC TIẾP bằng `pg` (không qua app code), giữ 1 transaction mở
 * hàng chục giây bằng nhiều round-trip INSERT liên tiếp vào 1 TEMP TABLE (an
 * toàn — không đụng schema thật, tự dọn khi transaction kết thúc).
 *
 * Chạy: node loadtest/ii3_long_transaction.js <port: 6432|5432> [N=5000]
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  const PORT = parseInt(process.argv[2] || '5432', 10);
  const N = parseInt(process.argv[3] || '5000', 10);
  const label = PORT === 6432 ? 'QUA PGBOUNCER (transaction pooling)' : 'THẲNG POSTGRES (không qua pgbouncer)';
  console.log(`\n========== II3: 1 transaction dài (${N} INSERT round-trip), ${label}, port=${PORT} ==========`);

  const client = new Client({
    host: process.env.DB_HOST,
    port: PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });

  const t0 = Date.now();
  let error = null;
  let finalCount = null;
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE ii3_scratch(id serial primary key, val text)');
    for (let i = 0; i < N; i++) {
      await client.query('INSERT INTO ii3_scratch(val) VALUES ($1)', [`row-${i}`]);
      if (i % 500 === 0) await sleep(5); // rải nhẹ round-trip cho transaction "dài" hơn thực tế mạng LAN
    }
    const countRes = await client.query('SELECT COUNT(*) AS cnt FROM ii3_scratch');
    finalCount = parseInt(countRes.rows[0].cnt, 10);
    await client.query('COMMIT');
  } catch (err) {
    error = err;
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection có thể đã chết, bỏ qua lỗi rollback phụ */
    }
  } finally {
    try {
      await client.end();
    } catch {
      /* ignore */
    }
  }
  const elapsed = Date.now() - t0;

  if (error) {
    console.log(`  ❌ LỖI giữa chừng sau ${elapsed}ms: ${error.message}`);
    console.log(`  → Đây LÀ bằng chứng transaction bị cắt ngang do pgbouncer (nếu port=6432) — cần tăng timeout hoặc đổi POOL_MODE cho service này.`);
  } else {
    console.log(`  Hoàn tất trong ${elapsed}ms, không lỗi. COUNT cuối trong transaction: ${finalCount}/${N} (kỳ vọng ĐÚNG ${N}).`);
    console.log(`  → ${finalCount === N ? 'PASS' : 'FAIL'} — transaction ${finalCount === N ? 'không' : 'CÓ'} bị lệch dữ liệu giữa chừng.`);
  }
})().catch((err) => {
  console.error('❌ Failed (kết nối/setup):', err.message);
  process.exit(1);
});
