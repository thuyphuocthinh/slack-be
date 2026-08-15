require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const { Client } = require('pg');

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
      { hostname: 'localhost', port: 3000, path: '/api/v1' + urlPath, method, headers },
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

(async () => {
  const TASK_PATTERN = process.argv[2] || 'LL3-d86d1e';
  const MAX_ROUNDS = parseInt(process.argv[3] || '15', 10);
  const data = JSON.parse(require('fs').readFileSync('loadtest/loadtest-users.json', 'utf8'));

  const pg = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
  });
  await pg.connect();

  console.log(`\n========== LL3 continuation loop — approve tới khi hết checkpoint chờ (tối đa ${MAX_ROUNDS} vòng) ==========`);

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const r = await pg.query(
      `SELECT id, reply_message_id, user_id, status, pending_task, created_at
       FROM orchestration_checkpoints
       WHERE pending_task ILIKE $1 AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [`%${TASK_PATTERN}%`],
    );
    if (!r.rows.length) {
      console.log(`  [round ${round}] Không còn checkpoint pending nào — có thể đã xong hoặc turn tự kết thúc.`);
      break;
    }
    const cp = r.rows[0];
    const user = data.users.find((u) => u.userId === cp.user_id);
    console.log(`  [round ${round}] checkpoint=${cp.id} task="${String(cp.pending_task).slice(0, 120)}"`);

    const approveRes = await request(
      'POST',
      `/ai-providers/approvals/${cp.reply_message_id}`,
      { action: 'approve' },
      user.token,
    );
    console.log(`  [round ${round}] approve status=${approveRes.status}`);

    await sleep(15000);
  }

  console.log('\n  Đọc COUNT thật cuối cùng qua Postgres (không tin lời AI)...');
  await pg.end();
  console.log('✅ Xong vòng lặp approve. Chạy tiếp 1 câu hỏi SELECT COUNT(*) qua AI để lấy số liệu thật.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
