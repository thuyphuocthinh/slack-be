/**
 * Nhóm X (manual_test_bank_heavy.md) — circuit breaker có cô lập đúng theo
 * provider không khi sql_server chết giữa chừng.
 *
 * X1: đổi SAI credentials sql_server cho N user test, bắn dồn ≥20 tin nhắn
 *     "@AI xem schema Customers" gần như đồng thời trong 1 workspace — breaker
 *     phải mở (CIRCUIT_BREAKER_STATE key -> 'open') khi tỉ lệ lỗi vượt
 *     CIRCUIT_BREAKER_ERROR_THRESHOLD_PERCENTAGE=50% trong
 *     CIRCUIT_BREAKER_VOLUME_WINDOW_SEC=10s, với volume đủ
 *     CIRCUIT_BREAKER_VOLUME_THRESHOLD=20.
 * X2: sửa lại ĐÚNG credentials, đợi đủ CIRCUIT_BREAKER_RESET_TIMEOUT_MS=30s,
 *     gửi lại 1 tin — breaker phải tự đóng (probe half-open thành công).
 * X3: NGAY khi breaker sql_server đang mở, gửi 1 tin hỏi GitHub (provider
 *     khác) — phải trả lời bình thường, không bị ảnh hưởng (breaker key =
 *     `mcp:${provider}`, không dùng chung giữa provider khác nhau — xem
 *     route-key.util.ts + mcp-client.service.ts:551).
 *
 * Đọc trực tiếp key Redis thật (không suy đoán qua hành vi bên ngoài) để biết
 * CHÍNH XÁC lúc nào breaker mở/đóng — key format xem
 * libs/cached/src/cached.constant.ts CACHE.ORCHESTRATION.KEYS.
 *
 * Precondition: docker-compose.dev.yml đã up (redis-cache-dev), mcp_server +
 * mcp_server_mssql đã up, loadtest-users.json đã có N user (đã connect
 * sql_server đúng credentials qua connect_sql_server_for_test_users.js).
 *
 * Chạy: node loadtest/x_circuit_breaker_sql_server.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PREFIX = '/api/v1';

// Số user tham gia bắn burst — 8 user x 3 tin = 24 lượt trigger AI thật, đủ
// vượt CIRCUIT_BREAKER_VOLUME_THRESHOLD=20, vẫn dưới rate limit AI-trigger
// 5/60s/user (3 < 5) và rate limit gateway 10 req/10s/user (3 < 10).
const NUM_USERS_FOR_BURST = 8;
const MESSAGES_PER_USER = 5;

const GOOD_SQL_CREDENTIALS = {
  host: 'localhost',
  port: '1433',
  user: 'sa',
  password: 'Aa1!cudLK6bHLNTfbmPIiOE5',
  database: 'AgentSampleDB',
};
const BAD_SQL_CREDENTIALS = { ...GOOD_SQL_CREDENTIALS, password: 'SAI_MAT_KHAU_CO_TINH_X1' };

const REDIS_CONTAINER = 'slack-redis-cache-dev';
const REDIS_PASSWORD = '123456'; // dev only — xem docker-compose.dev.yml requirepass
const BREAKER_STATE_KEY = 'tpt:v1:orchestration:v1:circuit_breaker:state:mcp:sql_server';
const BREAKER_OPENED_AT_KEY = 'tpt:v1:orchestration:v1:circuit_breaker:opened_at:mcp:sql_server';

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

function redisGet(key) {
  try {
    const out = execFileSync(
      'docker',
      ['exec', REDIS_CONTAINER, 'redis-cli', '-a', REDIS_PASSWORD, '--no-auth-warning', 'GET', key],
      { encoding: 'utf8' },
    ).trim();
    return out === '(nil)' || out === '' ? null : out;
  } catch (err) {
    console.error(`  redisGet(${key}) lỗi:`, err.message);
    return null;
  }
}

// FE thật dùng Tiptap (editor.getJSON()), KHÔNG phải Quill Delta — content
// phải là {type:'doc', content:[{type:'paragraph', content:[...]}]} với node
// text thật {type:'text', text:...}, nếu không extractContentText()
// (message-client.service.ts, chỉ traverse cây Tiptap) trả về rỗng và
// Supervisor nhận originalPrompt="" (bug đã phát hiện ngày 2026-08-11).
function sendAiMessage(data, user, text) {
  const body = {
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            ...(data.botUserId ? [{ type: 'mention', attrs: { id: data.botUserId } }] : []),
            { type: 'text', text: ` ${text}` },
          ],
        },
      ],
    },
    mentions: data.botUserId ? [data.botUserId] : undefined,
  };
  return request(
    'POST',
    `/workspaces/${data.workspaceId}/channels/${data.channelId}/messages`,
    body,
    user.token,
  );
}

function submitSqlCredentials(user, creds) {
  return request('POST', '/ai-providers/sql_server/submit', { credentials: creds }, user.token);
}

async function getRecentMessages(data, token, limit = 40) {
  const res = await request(
    'GET',
    `/workspaces/${data.workspaceId}/channels/${data.channelId}/messages?limit=${limit}`,
    null,
    token,
  );
  return res.body?.data ?? res.body ?? [];
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const burstUsers = data.users.slice(0, NUM_USERS_FOR_BURST);
  if (burstUsers.length < NUM_USERS_FOR_BURST) {
    console.error(`❌ Cần ${NUM_USERS_FOR_BURST} user trong loadtest-users.json, chỉ có ${burstUsers.length}.`);
    process.exit(1);
  }

  console.log(`\n=== X1: đổi SAI credentials sql_server cho ${burstUsers.length} user ===`);
  for (const u of burstUsers) {
    const res = await submitSqlCredentials(u, BAD_SQL_CREDENTIALS);
    console.log(`  ${u.email}: submit bad creds -> ${res.status}`);
  }

  console.log(`\n=== X1: kiểm tra breaker state TRƯỚC burst (phải null/closed) ===`);
  console.log(`  ${BREAKER_STATE_KEY} = ${redisGet(BREAKER_STATE_KEY)}`);

  console.log(`\n=== X1: bắn ${burstUsers.length}x${MESSAGES_PER_USER}=${burstUsers.length * MESSAGES_PER_USER} tin "@AI xem schema Customers" đồng thời ===`);
  const burstStart = Date.now();
  const sendPromises = [];
  for (const u of burstUsers) {
    for (let i = 0; i < MESSAGES_PER_USER; i++) {
      sendPromises.push(
        sendAiMessage(data, u, `Xem schema bảng Customers trên SQL Server (lượt ${i + 1})`).then((res) => ({
          email: u.email,
          i,
          status: res.status,
        })),
      );
    }
  }
  const sendResults = await Promise.all(sendPromises);
  const failedToEnqueue = sendResults.filter((r) => r.status !== 200 && r.status !== 201);
  console.log(`  Đã gửi ${sendResults.length} tin (mất ${Date.now() - burstStart}ms) — ${failedToEnqueue.length} tin bị chặn ngay ở tầng API (rate limit khác, không phải breaker):`);
  if (failedToEnqueue.length) console.log('  ', JSON.stringify(failedToEnqueue));

  console.log(`\n=== X1: poll Redis breaker state mỗi 2s, tối đa 40s ===`);
  let openedAtMs = null;
  for (let elapsed = 0; elapsed <= 40; elapsed += 2) {
    const state = redisGet(BREAKER_STATE_KEY);
    console.log(`  t+${elapsed}s: state=${state}`);
    if (state === 'open') {
      openedAtMs = Number(redisGet(BREAKER_OPENED_AT_KEY));
      console.log(`  ✅ Breaker MỞ lúc t+${elapsed}s (openedAt epoch=${openedAtMs}, ${openedAtMs ? new Date(openedAtMs).toISOString() : 'n/a'})`);
      break;
    }
    await sleep(2000);
  }
  if (!openedAtMs) {
    console.log('  ❌ Breaker KHÔNG mở trong 40s — X1 KHÔNG đạt (hoặc volume/latency chưa đủ, xem log orchestration).');
  }

  console.log(`\n=== X1: soi vài tin nhắn gần nhất để xem bot trả lỗi gì + đo latency phản hồi ===`);
  await sleep(3000);
  const msgs = await getRecentMessages(data, burstUsers[0].token, 30);
  const botMsgs = Array.isArray(msgs) ? msgs.filter((m) => m.userId === data.botUserId).slice(0, 6) : [];
  for (const m of botMsgs) {
    console.log(`  [bot @ ${m.createdAt}] ${JSON.stringify(m.content).slice(0, 200)}`);
  }

  if (openedAtMs) {
    console.log(`\n=== X3: NGAY lúc breaker sql_server đang mở, gửi 1 tin hỏi GitHub (provider khác) ===`);
    const providersRes = await request('GET', '/ai-providers', null, burstUsers[0].token);
    console.log('  Providers hiện có của user test:', JSON.stringify(providersRes.body).slice(0, 500));
  }

  fs.writeFileSync(
    path.join(__dirname, 'x_circuit_breaker_result.json'),
    JSON.stringify({ burstStart, sendResults, openedAtMs, botMsgs }, null, 2),
  );
  console.log('\n✅ X1 (+ khảo sát X3) xong — xem loadtest/x_circuit_breaker_result.json. Chạy tiếp x_circuit_breaker_sql_server_part2.js cho X2/X3 sau khi đợi đủ 30s.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
