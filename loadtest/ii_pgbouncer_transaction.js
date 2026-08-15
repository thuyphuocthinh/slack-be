/**
 * plan.md nhóm II — pgbouncer (POOL_MODE=transaction) có làm sai lệch tính
 * ĐÚNG của 1 transaction TypeORM không (khác manual_test_bank_load.md — đo
 * THÔNG LƯỢNG, không đo TÍNH ĐÚNG).
 *
 * II1/II2: bắn N request ĐỒNG THỜI (Promise.all), mỗi request là 1
 * `dataSource.transaction()` THẬT nhiều câu lệnh (channel.service.ts
 * createGroupChannel(): insert channel + insert channel_member) — verify
 * bằng SELECT trực tiếp Postgres rằng KHÔNG có channel nào bị "mồ côi"
 * (thiếu channel_member) do transaction bị pgbouncer cắt ngang giữa 2 lệnh.
 *
 * CHẠY QUA PGBOUNCER: .env phải đang trỏ DB_PORT=6432 trước khi chạy script
 * này (đổi tay, xem docker-compose.dev.yml comment) — script chỉ ĐỌC .env để
 * biết đang test qua port nào, không tự đổi.
 *
 * Chạy: node loadtest/ii_pgbouncer_transaction.js [N]   (N mặc định 20)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const { Client } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PREFIX = '/api/v1';

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (bodyStr) headers['content-length'] = Buffer.byteLength(bodyStr);
    const req = http.request(
      { hostname: API_HOST, port: API_PORT, path: API_PREFIX + urlPath, method, headers },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function createChannel(data, user, title) {
  return request(
    'POST',
    `/workspaces/${data.workspaceId}/channels`,
    { title, type: 'group', description: 'II pgbouncer atomicity test' },
    user.token,
  );
}

(async () => {
  const N = parseInt(process.argv[2] || '20', 10);
  console.log(`\n========== II1/II2: ${N} createChannel() ĐỒNG THỜI qua pgbouncer, verify atomicity ==========`);
  console.log(`  .env hiện tại: DB_PORT=${process.env.DB_PORT} (6432 = qua pgbouncer, 5432 = thẳng Postgres — đối chiếu 2 lần chạy để so sánh)`);

  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const runTag = crypto.randomUUID().slice(0, 8);
  const titles = Array.from({ length: N }, (_, i) => `II-atomic-${runTag}-${i + 1}`);

  const t0 = Date.now();
  const results = await Promise.all(
    titles.map((title, i) => createChannel(data, data.users[i % data.users.length], title)),
  );
  const elapsed = Date.now() - t0;

  const okCount = results.filter((r) => r.status === 200 || r.status === 201).length;
  console.log(`  Hoàn tất trong ${elapsed}ms — ${okCount}/${N} request trả 2xx`);
  results.forEach((r, i) => {
    if (r.status !== 200 && r.status !== 201) {
      console.log(`  [FAIL] ${titles[i]}: status=${r.status} body=${JSON.stringify(r.body).slice(0, 150)}`);
    }
  });

  console.log('\n  Đối chiếu trực tiếp Postgres — mỗi channel PHẢI có ĐÚNG 1 channel_member (creator)...');
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });
  await client.connect();

  const channelsRes = await client.query(
    `SELECT id, title FROM channels WHERE title LIKE $1`,
    [`II-atomic-${runTag}-%`],
  );
  console.log(`  Số channel thật sự tồn tại trong DB: ${channelsRes.rows.length} / ${N} đã gửi request`);

  let orphanCount = 0;
  for (const ch of channelsRes.rows) {
    const memberRes = await client.query(
      `SELECT COUNT(*) AS cnt FROM channel_members WHERE channel_id = $1`,
      [ch.id],
    );
    const cnt = parseInt(memberRes.rows[0].cnt, 10);
    if (cnt !== 1) {
      orphanCount++;
      console.log(`  [ORPHAN] channel "${ch.title}" (${ch.id}) có ${cnt} member (kỳ vọng đúng 1)`);
    }
  }
  console.log(
    `\n  → Kết quả: ${channelsRes.rows.length}/${N} channel được tạo, ${orphanCount} channel bị "mồ côi" (thiếu/thừa member). ${
      orphanCount === 0 && channelsRes.rows.length === okCount
        ? 'PASS — transaction vẫn atomic qua pgbouncer.'
        : 'FAIL — có dấu hiệu transaction bị cắt ngang, cần điều tra thêm (kiểm tra log api-gateway/channel quanh giờ chạy).'
    }`,
  );

  console.log('\n  Dọn dữ liệu test...');
  await client.query(`DELETE FROM channel_members WHERE channel_id IN (SELECT id FROM channels WHERE title LIKE $1)`, [`II-atomic-${runTag}-%`]);
  await client.query(`DELETE FROM channels WHERE title LIKE $1`, [`II-atomic-${runTag}-%`]);
  await client.end();

  console.log('\n✅ Xong II1/II2.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
