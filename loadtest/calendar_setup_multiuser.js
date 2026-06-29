/**
 * SETUP SCRIPT cho calendar_checkin_multiuser.js và calendar_leave_review.js
 *
 * Tự động:
 *   1. Login 4 user → lấy fresh token
 *   2. Tạo shift hôm nay cho từng user (qua admin token)
 *   3. Tạo leave request cho từng user
 *   4. In ra IDs + tokens để paste vào test files
 */

const https = require('https');

const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';
const API_BASE     = 'api.tpt.io.vn';
const API_PREFIX   = '/api/v1';

const USERS = [
  { email: 'tpt@gmail.com',                  password: '123456Aa' },
  { email: 'thuyphuocthinhtpt+6@gmail.com',  password: '123456Aa' },
  { email: 'thuyphuocthinhtpt+15@gmail.com', password: '123456Aa' },
  { email: 'thuyphuocthinhtpt+17@gmail.com', password: '123456Aa' },
];

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (bodyStr) headers['content-length'] = Buffer.byteLength(bodyStr);

    const req = https.request(
      { hostname: API_BASE, path: API_PREFIX + path, method, headers },
      (res) => {
        let data = '';
        res.on('data', d => data += d);
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  // ── 1. Login ──────────────────────────────────────────────────────────────
  console.log('🔐 Logging in...');
  const loggedIn = [];
  for (const u of USERS) {
    const res = await request('POST', '/auth/login', { email: u.email, password: u.password });
    if (res.status !== 200 && res.status !== 201) {
      console.warn(`  ⚠️  ${u.email} login FAILED (${res.status})`);
      continue;
    }
    const token = res.body?.data?.accessToken;
    const userId = res.body?.data?.user?.id || res.body?.data?.userId;
    // Decode userId from JWT if not in response
    const jwtPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    loggedIn.push({ email: u.email, token, userId: userId || jwtPayload.sub });
    console.log(`  ✅ ${u.email} → userId: ${userId || jwtPayload.sub}`);
  }

  if (loggedIn.length === 0) { console.error('No users logged in. Abort.'); process.exit(1); }

  // ── 2. Tạo shift hôm nay cho từng user ───────────────────────────────────
  console.log('\n📅 Creating today shifts...');
  const today = new Date().toISOString().slice(0, 10);
  const startTime = `${today}T01:00:00.000Z`; // 08:00 UTC+7
  const endTime   = `${today}T10:00:00.000Z`; // 17:00 UTC+7

  const shiftIds = {};
  for (const u of loggedIn) {
    // Dùng token của chính user để tạo shift cho mình
    const res = await request(
      'POST',
      `/workspaces/${WORKSPACE_ID}/calendar/bulk-register`,
      {
        userId: u.userId,
        location: 'OFFICE',
        shifts: [{ workDate: today, startTime, endTime }],
      },
      u.token
    );
    if ((res.status === 200 || res.status === 201) && res.body?.data?.[0]?.id) {
      shiftIds[u.email] = res.body.data[0].id;
      console.log(`  ✅ ${u.email} → shiftId: ${shiftIds[u.email]}`);
    } else {
      // Thử lấy shift đã tồn tại nếu đã tạo rồi
      const getRes = await request(
        'GET',
        `/workspaces/${WORKSPACE_ID}/calendar/work-shifts?startDate=${today}&endDate=${today}&userId=${u.userId}`,
        null,
        u.token
      );
      const existing = getRes.body?.data?.[0]?.id;
      if (existing) {
        shiftIds[u.email] = existing;
        console.log(`  ♻️  ${u.email} → existing shiftId: ${existing}`);
      } else {
        console.warn(`  ⚠️  ${u.email} shift create FAILED (${res.status}):`, JSON.stringify(res.body).slice(0, 120));
      }
    }
    await sleep(200);
  }

  // ── 3. Tạo leave requests ────────────────────────────────────────────────
  console.log('\n📝 Creating leave requests...');
  // Dùng ngày xa để không conflict với ca hôm nay
  const leaveOffset = Math.floor(Math.random() * 50) + 60; // +60–110 ngày
  const leaveStart = new Date(); leaveStart.setUTCDate(leaveStart.getUTCDate() + leaveOffset);
  leaveStart.setUTCHours(1, 0, 0, 0);
  const leaveEnd = new Date(leaveStart); leaveEnd.setUTCHours(10, 0, 0, 0);

  const requestIds = [];
  for (const u of loggedIn) {
    const res = await request(
      'POST',
      `/workspaces/${WORKSPACE_ID}/calendar/requests`,
      {
        requestType: 'LEAVE_UNPAID',
        startTime: leaveStart.toISOString(),
        endTime:   leaveEnd.toISOString(),
        reason:    `Setup script leave request — ${u.email}`,
      },
      u.token
    );
    if ((res.status === 200 || res.status === 201) && res.body?.data?.id) {
      requestIds.push(res.body.data.id);
      console.log(`  ✅ ${u.email} → requestId: ${res.body.data.id}`);
    } else {
      console.warn(`  ⚠️  ${u.email} leave request FAILED (${res.status}):`, JSON.stringify(res.body).slice(0, 120));
    }
    await sleep(200);
  }

  // ── 4. In kết quả ────────────────────────────────────────────────────────
  console.log('\n\n═══════════════════════════════════════════════════════════');
  console.log('PASTE VÀO calendar_checkin_multiuser.js — USERS array:');
  console.log('═══════════════════════════════════════════════════════════');
  loggedIn.forEach((u) => {
    console.log(`  // ${u.email}`);
    console.log(`  { token: '${u.token}', shiftId: '${shiftIds[u.email] || 'NOT_FOUND'}' },`);
  });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('PASTE VÀO calendar_leave_review.js — REQUEST_IDS array:');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  ' + JSON.stringify(requestIds, null, 2).replace(/\n/g, '\n  '));

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('TOKENS (cho update_configs.js):');
  console.log('═══════════════════════════════════════════════════════════');
  loggedIn.forEach(u => console.log(`  ${u.email}: ${u.token}`));
})();
