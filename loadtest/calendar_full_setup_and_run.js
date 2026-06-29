/**
 * FULL AUTO SETUP + RUN: Calendar Multi-User Check-In Test
 *
 * Pipeline tự động 100% — không cần bước tay nào:
 *   1. Login 4 user → fresh tokens + userIds
 *   2. Admin manual-unlock tháng hiện tại cho từng user (remove calendar lock)
 *   3. Mỗi user lưu face-baseline với descriptor giả → bypass face-match validation
 *   4. Tạo shift hôm nay cho tất cả user (self-create; fallback admin nếu vẫn 403)
 *   5. Chạy autocannon 50-connection check-in stress test 30s
 *
 * Chạy: node calendar_full_setup_and_run.js
 *
 * NOTES:
 *   - Token JWT có TTL 30 phút → chạy script xong test ngay
 *   - Nếu shift đã tồn tại cho ngày hôm nay → reuse, không tạo lại
 *   - ALREADY_CHECKED_IN sau lần đầu là NORMAL → 2xx ≥ readyUsers.length là PASS
 */

const https    = require('https');
const autocannon = require('autocannon');

const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';
const API_BASE     = 'api.tpt.io.vn';
const API_PREFIX   = '/api/v1';

const USERS = [
  { email: 'tpt@gmail.com',                   password: '123456Aa', isAdmin: true },
  { email: 'thuyphuocthinhtpt+6@gmail.com',   password: '123456Aa' },
  { email: 'thuyphuocthinhtpt+15@gmail.com',  password: '123456Aa' },
  { email: 'thuyphuocthinhtpt+17@gmail.com',  password: '123456Aa' },
];

// 1×1 white JPEG — BE chỉ lưu, không validate nội dung ảnh
const FAKE_FACE_IMAGE      = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAAQCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxBn/9k=';
const FAKE_FACE_DESCRIPTOR = Array(128).fill(0.1);

// ── HTTP helper ────────────────────────────────────────────────────────────────
function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (token)   headers['authorization']  = `Bearer ${token}`;
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
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ───────────────────────────────────────────────────────────────────────
(async () => {
  // ── 1. Login ──────────────────────────────────────────────────────────────
  console.log('🔐 [1/5] Logging in...');
  const loggedIn = [];

  for (const u of USERS) {
    const res = await request('POST', '/auth/login', { email: u.email, password: u.password });
    if (res.status !== 200 && res.status !== 201) {
      console.warn(`  ⚠️  ${u.email} FAILED (${res.status})`);
      loggedIn.push({ ...u, token: null, userId: null });
      continue;
    }
    const token   = res.body?.data?.accessToken;
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    loggedIn.push({ ...u, token, userId: payload.sub });
    console.log(`  ✅ ${u.email}  userId=${payload.sub}`);
    await sleep(150);
  }

  const adminUser = loggedIn.find(u => u.isAdmin && u.token);
  if (!adminUser) { console.error('❌ Admin login failed — abort.'); process.exit(1); }

  // ── 2. Manual-unlock current month for all non-admin users ────────────────
  const currentMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })
    .format(new Date()).slice(0, 7); // YYYY-MM

  console.log(`\n🔓 [2/5] Unlocking ${currentMonth} for all users...`);
  for (const u of loggedIn) {
    if (!u.token || !u.userId) continue;
    const res = await request(
      'POST',
      `/workspaces/${WORKSPACE_ID}/calendar/manual-unlock`,
      { targetUserId: u.userId, targetMonth: currentMonth, reason: 'Load test auto-setup' },
      adminUser.token,
    );
    if (res.status === 200 || res.status === 201) {
      console.log(`  ✅ ${u.email} unlocked`);
    } else if (res.status === 404 || res.body?.message?.includes?.('not found')) {
      // Chưa có lock record → tháng này chưa bị khoá → OK
      console.log(`  ℹ️  ${u.email} no lock found (already open)`);
    } else {
      console.warn(`  ⚠️  ${u.email} unlock (${res.status}):`, JSON.stringify(res.body).slice(0, 120));
    }
    await sleep(150);
  }

  // ── 3. Face baseline ──────────────────────────────────────────────────────
  console.log('\n👤 [3/5] Saving face baselines...');
  for (const u of loggedIn) {
    if (!u.token) continue;
    const res = await request(
      'POST',
      `/workspaces/${WORKSPACE_ID}/calendar/face-baseline`,
      { faceImageBase64: FAKE_FACE_IMAGE, faceDescriptor: FAKE_FACE_DESCRIPTOR },
      u.token,
    );
    if (res.status === 200 || res.status === 201) {
      console.log(`  ✅ ${u.email}`);
    } else {
      console.warn(`  ⚠️  ${u.email} (${res.status}):`, JSON.stringify(res.body).slice(0, 120));
    }
    await sleep(150);
  }

  // ── 4. Create today's shifts ──────────────────────────────────────────────
  console.log('\n📅 [4/5] Creating shifts for today...');
  const now   = new Date();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(now);

  // Dynamic window: startTime = now-2h, endTime = now+3h
  // Check-in grace = [startTime-2h, endTime+4h] = [now-4h, now+7h] → always covers current time
  function makeShiftTimes() {
    const st = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const et = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    return { startTime: st.toISOString(), endTime: et.toISOString() };
  }

  // Returns true if shift's check-in window [endTime + 4h] is still open
  function isWindowOpen(shiftEndTimeStr) {
    const closeTime = new Date(shiftEndTimeStr).getTime() + 4 * 60 * 60 * 1000;
    return Date.now() < closeTime;
  }

  const shiftIds = {};

  for (const u of loggedIn) {
    if (!u.token) continue;
    const { startTime, endTime } = makeShiftTimes();

    // Try self-create
    let res = await request(
      'POST',
      `/workspaces/${WORKSPACE_ID}/calendar/bulk-register`,
      { userId: u.userId, location: 'WFH', shifts: [{ workDate: today, startTime, endTime }] },
      u.token,
    );

    // Locked (403) → admin creates on behalf
    if (res.status === 403 && !u.isAdmin) {
      console.log(`  ↩️  ${u.email} 403, using admin token...`);
      res = await request(
        'POST',
        `/workspaces/${WORKSPACE_ID}/calendar/bulk-register`,
        { userId: u.userId, location: 'WFH', shifts: [{ workDate: today, startTime, endTime }] },
        adminUser.token,
      );
    }

    if ((res.status === 200 || res.status === 201) && res.body?.data?.[0]?.id) {
      shiftIds[u.email] = res.body.data[0].id;
      console.log(`  ✅ ${u.email} → ${shiftIds[u.email]}`);
    } else {
      // Shift may already exist for today → fetch it
      const getRes = await request(
        'GET',
        `/workspaces/${WORKSPACE_ID}/calendar/work-shifts?startDate=${today}&endDate=${today}&userId=${u.userId}`,
        null, adminUser.token,
      );
      const existingShift = getRes.body?.data?.[0];

      if (existingShift?.id) {
        if (isWindowOpen(existingShift.endTime)) {
          // Still within check-in grace window — reuse
          shiftIds[u.email] = existingShift.id;
          console.log(`  ♻️  ${u.email} → existing (window OK) ${existingShift.id}`);
        } else {
          // Window closed → delete old shift, recreate with current times
          console.log(`  🔄 ${u.email} window expired, deleting old shift...`);
          await request('DELETE', `/workspaces/${WORKSPACE_ID}/calendar/work-shifts/${existingShift.id}`, null, adminUser.token);
          await sleep(300);

          const { startTime: st2, endTime: et2 } = makeShiftTimes();
          let recreateRes = await request(
            'POST',
            `/workspaces/${WORKSPACE_ID}/calendar/bulk-register`,
            { userId: u.userId, location: 'WFH', shifts: [{ workDate: today, startTime: st2, endTime: et2 }] },
            u.isAdmin ? u.token : adminUser.token,
          );
          if ((recreateRes.status === 200 || recreateRes.status === 201) && recreateRes.body?.data?.[0]?.id) {
            shiftIds[u.email] = recreateRes.body.data[0].id;
            console.log(`  ✅ ${u.email} → recreated ${shiftIds[u.email]}`);
          } else {
            console.warn(`  ❌ ${u.email} recreate FAILED (${recreateRes.status}):`, JSON.stringify(recreateRes.body).slice(0, 120));
          }
        }
      } else {
        console.warn(`  ❌ ${u.email} shift FAILED (${res.status}):`, JSON.stringify(res.body).slice(0, 120));
      }
    }
    await sleep(200);
  }

  const readyUsers = loggedIn.filter(u => u.token && shiftIds[u.email]);
  if (readyUsers.length === 0) {
    console.error('\n❌ No users have token+shiftId — cannot run test.');
    process.exit(1);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log(`SETUP COMPLETE — ${readyUsers.length}/${loggedIn.length} users ready:`);
  readyUsers.forEach(u => console.log(`  ${u.email}  shift=${shiftIds[u.email]}`));
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── 4b. Debug: single check-in to see actual error before hammering ──────
  console.log('\n🔍 [4b] Debug single check-in...');
  const debugUser = readyUsers[0];
  const debugRes = await request(
    'POST',
    `/workspaces/${WORKSPACE_ID}/calendar/check-in`,
    { shiftId: shiftIds[debugUser.email], location: 'WFH', faceDescriptor: FAKE_FACE_DESCRIPTOR },
    debugUser.token,
  );
  console.log(`  → HTTP ${debugRes.status}: ${JSON.stringify(debugRes.body).slice(0, 300)}`);

  const isAlreadyCheckedIn = debugRes.body?.code?.includes?.('ALREADY_CHECKED');
  const debugOk = debugRes.status === 200 || debugRes.status === 201 || isAlreadyCheckedIn;

  if (!debugOk) {
    const isTimeWindow = debugRes.body?.code === 'ERR.CALENDAR.0147' || debugRes.body?.code?.includes?.('SHIFT_TIME');
    const isFaceError  = debugRes.body?.code?.includes?.('FACE');
    const isRateLimit  = debugRes.status === 429;

    if (isTimeWindow) {
      console.error('  ❌ Time window error — shift recreate failed. Check bulk-register DELETE logic.');
    } else if (isRateLimit) {
      console.warn('  ⚠️  Rate limit hit — wait 60s then run again.');
    } else if (isFaceError) {
      console.error('  ❌ Face mismatch — faceDescriptor in check-in does not match saved baseline.');
    } else {
      console.warn('  ⚠️  Unexpected error — see response above.');
    }
    console.error('  ❌ Aborting load test — fix error above first.');
    process.exit(1);
  }

  if (isAlreadyCheckedIn) {
    console.log('  ℹ️  Already checked in (from previous run) — test will show non-2xx for all, that is expected.');
  }

  // ── 5. Run check-in load test ─────────────────────────────────────────────
  console.log('\n🚀 [5/5] Running check-in load test (50 conn, 30s)...\n');
  await sleep(800);

  // location: 'WFH' — OFFICE location triggers IP whitelist check which blocks non-office IPs.
  // WFH uses face-descriptor match instead, which we've already seeded in step 3.
  const acRequests = readyUsers.map(u => ({
    headers: {
      authorization:  `Bearer ${u.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      shiftId:        shiftIds[u.email],
      location:       'WFH',
      faceDescriptor: FAKE_FACE_DESCRIPTOR,
    }),
  }));

  await new Promise(resolve => {
    const instance = autocannon(
      {
        url: `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/calendar/check-in`,
        method: 'POST',
        requests: acRequests,
        connections: 50,
        duration: 30,
        pipelining: 1,
      },
      (err, result) => {
        if (err) { console.error(err); resolve(); return; }

        console.log('\n─────────── RESULTS: MULTI-USER CONCURRENT CHECK-IN ───────────');
        console.log(`Users in test:       ${readyUsers.length}`);
        console.log(`Connections:         50`);
        console.log(`Requests/sec (avg):  ${result.requests.average}`);
        console.log(`Latency p50:         ${result.latency.p50} ms`);
        console.log(`Latency p97.5:       ${result.latency.p97_5} ms`);
        console.log(`Latency p99:         ${result.latency.p99} ms`);
        console.log(`Latency max:         ${result.latency.max} ms`);
        console.log(`Success (2xx):       ${result['2xx']}`);
        console.log(`Errors (non-2xx):    ${result.non2xx}`);
        console.log(`Timeouts:            ${result.timeouts}`);
        console.log('────────────────────────────────────────────────────────────────');

        if (result.timeouts > 0) {
          console.warn('🔴 CRITICAL: Timeout — write lock trên daily_reconciliations queue quá dài.');
        } else if (result['2xx'] === 0) {
          console.warn('🔴 FAIL: 0 success — kiểm tra: token hết hạn, faceDescriptor không khớp baseline, shiftId sai.');
        } else if (result.latency.p99 > 1000) {
          console.warn('🟠 WARNING: p99 > 1000ms — write contention trên attendance_logs/daily_reconciliations. Xem xét queue or batch insert.');
        } else if (result.latency.p99 > 500) {
          console.warn('🟡 OK: p99 500-1000ms — chấp nhận được, nhưng verify index IDX_ATTENDANCE_LOG_SHIFT.');
        } else {
          console.log('✅ PASS: p99 < 500ms — write lock hoạt động đúng ở mức tải này.');
        }

        console.log('\nℹ️  EXPECTED: 2xx ≥ readyUsers.length cho lần đầu, còn lại ALREADY_CHECKED_IN (non-2xx) là đúng.');
        resolve();
      },
    );
    autocannon.track(instance, { renderProgressBar: true });
  });
})();
