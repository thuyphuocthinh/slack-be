/**
 * Re-login TOÀN BỘ user test trong loadtest-users.json (token cũ hết hạn TTL
 * 30 phút — số lượng user đọc TRỰC TIẾP từ file, không hardcode, tự chạy đúng
 * dù đang có 10 hay 100 user) + connect agent sql_server cho từng user (POST
 * ai-providers/sql_server/submit) — để load test chạm được tới
 * ReactLoopService/MCP tool call thật, không chỉ dừng ở "chưa thể xử lý yêu
 * cầu này" (do user test chưa connect agent nào).
 *
 * Field credentials (host/port/user/password/database) đều 1 từ — KHÔNG dính
 * bug CamelCaseMiddleware (xem memory project-camelcase-middleware-credentials-footgun).
 * Endpoint submit KHÔNG có @RateLimit — sleep(500) giữa mỗi user chỉ để nhẹ
 * tay với server, không phải né rate limit như bước login (13s/user, BẮT
 * BUỘC theo rate limit /auth/login 5/60s/IP).
 *
 * Chạy: node loadtest/connect_sql_server_for_test_users.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUTPUT_FILE = path.join(__dirname, 'loadtest-users.json');
const TEST_USER_PASSWORD = 'LoadTest123!';
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PREFIX = '/api/v1';

const SQL_CREDENTIALS = {
  host: 'localhost',
  port: '1433',
  user: 'sa',
  password: 'Aa1!cudLK6bHLNTfbmPIiOE5',
  database: 'AgentSampleDB',
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

function decodeUserId(accessToken) {
  const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString());
  return payload.sub;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8'));

  console.log(`\n🔐 [1/2] Re-logging in ${data.users.length} test users (token cũ hết hạn)...`);
  for (const u of data.users) {
    const res = await request('POST', '/auth/login', { email: u.email, password: TEST_USER_PASSWORD });
    const token = res.body?.data?.accessToken;
    if ((res.status === 200 || res.status === 201) && token) {
      u.token = token;
      u.userId = decodeUserId(token);
      console.log(`  ✅ ${u.email} logged in`);
    } else {
      console.warn(`  ⚠️  ${u.email} login failed (${res.status}): ${JSON.stringify(res.body).slice(0, 150)}`);
    }
    await sleep(13_000);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
  console.log(`  Đã ghi token mới vào ${OUTPUT_FILE}`);

  console.log(`\n🔌 [2/2] Connecting sql_server for ${data.users.length} test users...`);
  for (const u of data.users) {
    const res = await request(
      'POST',
      '/ai-providers/sql_server/submit',
      { credentials: SQL_CREDENTIALS },
      u.token,
    );
    if (res.status === 200 || res.status === 201) {
      console.log(`  ✅ ${u.email} connected sql_server`);
    } else {
      console.warn(`  ⚠️  ${u.email} connect failed (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
    }
    await sleep(500);
  }

  console.log('\n✅ Done.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
