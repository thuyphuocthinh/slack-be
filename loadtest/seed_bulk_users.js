/**
 * load-test-scale-plan.md — seed N user TRỰC TIẾP vào Postgres (bulk insert),
 * bỏ qua hoàn toàn rate limit /auth/register (3/60s/IP) và /auth/login
 * (5/60s/IP) — tạo N=1000 qua API thật sẽ mất hàng giờ, không khả thi.
 *
 * Tự ký access token bằng HS256 thủ công (không cần package "jsonwebtoken" —
 * pnpm strict node_modules không hoist nó ra top-level), payload khớp CHÍNH
 * XÁC apps/auth/src/auth.service.ts generateTokens(): {sub, email,
 * tokenVersion}. JwtAuthGuard chỉ cần jwtService.verify() pass (đúng secret +
 * tokenVersion khớp AuthCacheService.getUserTokenVersion(), mặc định trả 1
 * nếu Redis chưa có key — user mới tinh không có key này) — không cần seed
 * thêm gì vào Redis.
 *
 * Dùng chung workspaceId/channelId/botUserId từ loadtest-users.json (10 user
 * cũ) để user mới vào ĐÚNG channel/workspace đã có bot, không cần tạo mới.
 *
 * Chạy: node loadtest/seed_bulk_users.js <N>
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const OUTPUT_FILE = path.join(__dirname, 'loadtest-users-bulk.json');
const BATCH_SIZE = 500;
const JWT_EXPIRES_IN_SEC = 4 * 3600;

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function signJwtHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now, exp: now + JWT_EXPIRES_IN_SEC };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `${signingInput}.${signature}`;
}

function request(method, urlPath, token) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (token) headers['authorization'] = `Bearer ${token}`;
    const req = http.request(
      { hostname: 'localhost', port: 3000, path: `/api/v1${urlPath}`, method, headers },
      (res) => {
        let data = '';
        res.on('data', (d) => (data += d));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const n = parseInt(process.argv[2] || '10', 10);
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET không có trong .env');

  const base = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const { workspaceId, channelId, botUserId } = base;

  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });
  await client.connect();

  console.log(`\n🌱 Seeding ${n} user vào workspace=${workspaceId} channel=${channelId}...`);

  const newUsers = Array.from({ length: n }, () => ({
    id: crypto.randomUUID(),
    email: `loadtest_bulk_${crypto.randomUUID().slice(0, 8)}@test.local`,
  }));

  for (let i = 0; i < newUsers.length; i += BATCH_SIZE) {
    const batch = newUsers.slice(i, i + BATCH_SIZE);

    const userValues = batch
      .map((_, idx) => `($${idx * 3 + 1}, $${idx * 3 + 2}, $${idx * 3 + 3}, 'active', 'user', false)`)
      .join(',');
    const userParams = batch.flatMap((u) => [u.id, u.email, u.email.split('@')[0]]);
    await client.query(
      `INSERT INTO users (id, email, first_name, status, system_role, is_bot) VALUES ${userValues}`,
      userParams,
    );

    const wmValues = batch
      .map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2}, 'member', 'active')`)
      .join(',');
    const wmParams = batch.flatMap((u) => [workspaceId, u.id]);
    await client.query(
      `INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES ${wmValues}`,
      wmParams,
    );

    const cmValues = batch.map((_, idx) => `($${idx * 2 + 1}, $${idx * 2 + 2})`).join(',');
    const cmParams = batch.flatMap((u) => [channelId, u.id]);
    await client.query(
      `INSERT INTO channel_members (channel_id, member_id) VALUES ${cmValues}`,
      cmParams,
    );

    console.log(`  [${Math.min(i + BATCH_SIZE, n)}/${n}] inserted`);
  }

  await client.end();

  const usersWithToken = newUsers.map((u) => ({
    email: u.email,
    userId: u.id,
    token: signJwtHS256({ sub: u.id, email: u.email, tokenVersion: 1 }, jwtSecret),
  }));

  const output = { workspaceId, channelId, botUserId, users: usersWithToken };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\n✅ Đã seed ${n} user + ghi token ra ${OUTPUT_FILE}`);

  console.log('\n🔎 Smoke test: gọi API thật bằng token tự ký của user đầu tiên...');
  const smoke = await request(
    'GET',
    `/workspaces/${workspaceId}/channels/${channelId}/messages?limit=1`,
    usersWithToken[0].token,
  );
  console.log(`  status=${smoke.status} ${smoke.status === 200 ? '✅ OK — token tự ký hợp lệ' : '❌ FAIL — kiểm tra lại JWT_SECRET/payload'}`);
  if (smoke.status !== 200) console.log('  body:', smoke.body.slice(0, 300));
}

main().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
