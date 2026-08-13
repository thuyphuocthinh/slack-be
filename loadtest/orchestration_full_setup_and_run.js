/**
 * FULL AUTO SETUP cho load test orchestration ở LOCALHOST — không cần tạo tay
 * từng account (né được rate limit register 3/60s + login 5/60s bằng cách tự
 * dãn cách thời gian gọi, và né được yêu cầu verify email bằng cách flip
 * status thẳng trong Postgres local — CHỈ hợp lý cho account TEST, không phải
 * luồng thật).
 *
 * Pipeline:
 *   1. Register N user test (email cố định loadtest_N@test.local) — dãn cách
 *      21s/lần (rate limit register 3/60s, an toàn dư).
 *   2. UPDATE users SET status='active' thẳng trong Postgres cho các email đó
 *      (bỏ qua bước verify email — 1 câu SQL, không qua rate limit API).
 *   3. Login admin (account CỦA BẠN, ĐÃ verify từ trước, chủ workspace đích)
 *      + login N user test — dãn cách 13s/lần (rate limit login 5/60s).
 *   4. Thêm N user vào WORKSPACE_ID (add-members) rồi vào CHANNEL_ID
 *      (batch-members) — đều 1 lần gọi, không lặp N lần.
 *   5. Tìm userId của AI bot qua workspace members (field "isBot" — channel
 *      members chỉ trả về { memberId }, không có field này).
 *   6. Ghi ra loadtest/loadtest-users.json — orchestration.k6.js đọc file này,
 *      mỗi virtual user dùng 1 token riêng (rải đều theo __VU) thay vì share
 *      chung 1 token (vốn chỉ được đúng 5 request/60s, xem giải thích trong
 *      orchestration.k6.js).
 *
 * Idempotent — chạy lại nhiều lần an toàn: user đã tồn tại/đã là member thì
 * bỏ qua bước đó, không lỗi cả script.
 *
 * Chạy: node loadtest/orchestration_full_setup_and_run.js
 *
 * BẮT BUỘC điền trước khi chạy (xem khối CẤU HÌNH bên dưới):
 *   - ADMIN_EMAIL/ADMIN_PASSWORD: account CỦA BẠN, đã verify, là owner/admin
 *     của WORKSPACE_ID bên dưới (dùng để add-members/add-member).
 *   - WORKSPACE_ID/CHANNEL_ID: workspace/channel local đã có AI bot là thành
 *     viên (xem apps/workspace/scripts/backfill-ai-bot.ts nếu channel chưa
 *     có bot).
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// ==== CẤU HÌNH — ĐIỀN LẠI TRƯỚC KHI CHẠY ====
// N=100 tính theo Little's Law (concurrency = throughput × latency): muốn
// chạm AI_ORCHESTRATION_QUEUE_CONCURRENCY=30 với latency mock ~3-4s/round-trip
// cần throughput ~7.5 job/s -> N cần = 7.5 ÷ (5/60) = 90, làm tròn lên 100.
// Idempotent — 10 user cũ (loadtest_1..10) đã có sẽ tự bỏ qua bước register,
// chỉ đăng ký thêm 90 user MỚI. Lần đầu ước tính ~53 phút (register 90 user
// mới × 21s + login 100 user × 13s, rate limit theo IP không né được) — chạy
// NỀN, không cần canh. Các lần setup lại sau (account đã tồn tại) nhanh hơn
// nhiều vì bỏ qua hẳn bước register.
const NUM_TEST_USERS = 100;
const WORKSPACE_ID = '5f5a6f59-c969-41ec-b5f2-677cb5efa30e';
const CHANNEL_ID = '35563f7a-4857-4dfc-8a08-01aea5cbd21d';
const ADMIN_EMAIL = 'tpt@gmail.com';
const ADMIN_PASSWORD = '123456Aa';

const TEST_USER_PASSWORD = 'LoadTest123!';
const OUTPUT_FILE = path.join(__dirname, 'loadtest-users.json');
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PREFIX = '/api/v1';

function testEmail(i) {
  return `loadtest_${i}@test.local`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (bodyStr) headers['content-length'] = Buffer.byteLength(bodyStr);

    const req = http.request(
      { hostname: API_HOST, port: API_PORT, path: API_PREFIX + path, method, headers },
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

function decodeUserId(accessToken) {
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
  return payload.sub;
}

async function login(email, password) {
  const res = await request('POST', '/auth/login', { email, password });
  const token = res.body?.data?.accessToken ?? res.body?.accessToken;
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`login ${email} failed (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
  }
  if (!token) throw new Error(`login ${email} — không thấy accessToken trong response: ${JSON.stringify(res.body).slice(0, 200)}`);
  return { token, userId: decodeUserId(token) };
}

(async () => {
  if (WORKSPACE_ID.startsWith('<') || CHANNEL_ID.startsWith('<') || ADMIN_EMAIL.startsWith('<')) {
    console.error('❌ Chưa điền WORKSPACE_ID/CHANNEL_ID/ADMIN_EMAIL/ADMIN_PASSWORD ở đầu file — sửa rồi chạy lại.');
    process.exit(1);
  }

  const emails = Array.from({ length: NUM_TEST_USERS }, (_, i) => testEmail(i + 1));

  // ── 1. Register N user test (dãn cách 21s — rate limit register 3/60s) ──
  console.log(`\n📝 [1/6] Registering ${emails.length} test users...`);
  for (const email of emails) {
    const res = await request('POST', '/auth/register', { email, password: TEST_USER_PASSWORD });
    if (res.status === 200 || res.status === 201) {
      console.log(`  ✅ ${email} registered`);
    } else {
      console.log(`  ℹ️  ${email} (${res.status}) — có thể đã tồn tại từ lần chạy trước, bỏ qua`);
    }
    await sleep(21_000);
  }

  // ── 2. Flip status='active' thẳng trong Postgres (né verify email) ──────
  console.log(`\n🔓 [2/6] Activating test users directly in Postgres (bypass email verification)...`);
  const pg = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'postgres',
    database: process.env.DB_NAME || 'slack_db',
  });
  await pg.connect();
  const updateResult = await pg.query(
    `UPDATE users SET status = 'active' WHERE email = ANY($1::text[]) AND status != 'active'`,
    [emails],
  );
  console.log(`  ✅ ${updateResult.rowCount} user(s) activated (số còn lại đã active từ trước)`);
  await pg.end();

  // ── 3. Login admin + N user test (dãn cách 13s — rate limit login 5/60s) ─
  console.log(`\n🔐 [3/6] Logging in admin...`);
  const admin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  console.log(`  ✅ admin userId=${admin.userId}`);
  await sleep(13_000);

  console.log(`\n🔐 [4/6] Logging in ${emails.length} test users...`);
  const users = [];
  for (const email of emails) {
    try {
      const u = await login(email, TEST_USER_PASSWORD);
      users.push({ email, ...u });
      console.log(`  ✅ ${email} userId=${u.userId}`);
    } catch (err) {
      console.warn(`  ⚠️  ${email} login failed: ${err.message}`);
    }
    await sleep(13_000);
  }
  if (users.length === 0) {
    console.error('❌ Không login được user test nào — abort.');
    process.exit(1);
  }

  // ── 4. Add vào workspace + channel ──────────────────────────────────────
  console.log(`\n👥 [5/6] Adding users to workspace/channel...`);
  const addWsRes = await request(
    'POST',
    `/workspaces/${WORKSPACE_ID}/add-members`,
    { userIds: users.map((u) => u.userId), role: 'member' },
    admin.token,
  );
  console.log(`  workspace add-members: ${addWsRes.status}`);

  // Channel add-member DTO thật: { targetMembers: [{ email, memberId }] } —
  // 1 lệnh batch, không phải { targetMemberId } (dùng nhầm ban đầu, endpoint
  // trả lỗi validation "should not exist").
  const batchRes = await request(
    'POST',
    `/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID}/batch-members`,
    { targetMembers: users.map((u) => ({ email: u.email, memberId: u.userId })) },
    admin.token,
  );
  if (batchRes.status === 200 || batchRes.status === 201) {
    console.log(`  ✅ ${users.length} user added to channel`);
  } else {
    console.log(`  ℹ️  channel batch-members (${batchRes.status}) — có thể đã là thành viên, bỏ qua`);
  }

  // ── 5. Tìm bot userId — PHẢI tra qua workspace members (channel members
  // chỉ trả về { memberId }, không có field isBot) ─────────────────────────
  console.log(`\n🤖 [6/6] Finding AI bot in workspace...`);
  const wsMembersRes = await request('GET', `/workspaces/${WORKSPACE_ID}/members`, null, admin.token);
  const wsMemberList = wsMembersRes.body?.data ?? wsMembersRes.body ?? [];
  const botMember = Array.isArray(wsMemberList) ? wsMemberList.find((m) => m.isBot) : null;
  const botUserId = botMember?.userId ?? null;
  if (botUserId) {
    console.log(`  ✅ botUserId=${botUserId}`);
  } else {
    console.warn(
      '  ⚠️  Không tự tìm được botUserId — nếu CHANNEL_ID không phải kênh DIRECT với bot, phải tự điền BOT_USER_ID trong orchestration.k6.js (field "mentions"), nếu không request sẽ không trigger AI ở kênh GROUP.',
    );
  }

  // ── Ghi kết quả ──────────────────────────────────────────────────────────
  fs.writeFileSync(
    OUTPUT_FILE,
    JSON.stringify({ workspaceId: WORKSPACE_ID, channelId: CHANNEL_ID, botUserId, users }, null, 2),
  );
  console.log(`\n✅ Done — đã ghi ${users.length} user vào ${OUTPUT_FILE}`);
  console.log('   Token JWT có TTL giới hạn — nếu k6 báo 401, chạy lại script này để lấy token mới.');
})().catch((err) => {
  console.error('❌ Setup failed:', err);
  process.exit(1);
});
