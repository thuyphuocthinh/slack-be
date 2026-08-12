/**
 * Nhóm Y (manual_test_bank_heavy.md) — Y2 + Y3, dùng chung hạ tầng
 * `loadtest/setup_extra_workspaces.js` (3 workspace mới + workspace gốc A
 * trong loadtest-users.json = 4 workspace tổng, đúng yêu cầu Y3 "≥4 workspace").
 *
 * Precondition: đã chạy setup_extra_workspaces.js, đã tăng Postgres
 * max_connections=300 (xem docker-compose.dev.yml) để không lặp lại lỗi
 * "too many clients" đã gặp ở Y1 hôm trước.
 *
 * Y2: Workspace A bị spam (vượt WORKSPACE_TRIGGER_ADMISSION_LIMIT=30),
 *     TRONG LÚC ĐÓ workspace B (khác) gõ 1 câu — phải trả lời bình thường,
 *     không bị ảnh hưởng.
 * Y3: Cả 4 workspace (A + 3 mới) đều bắn 30 tin/workspace GẦN NHƯ ĐỒNG THỜI
 *     (tổng ≥120 job) — job vượt MAX_ORCHESTRATION_QUEUE_DEPTH=100 phải bị
 *     từ chối đúng, không phình vô hạn/OOM.
 *
 * Chạy: node loadtest/y2_y3_multi_workspace.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const EXTRA_WS_FILE = path.join(__dirname, 'extra-workspaces.json');
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PREFIX = '/api/v1';

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

function sendAiMessage(workspaceId, channelId, botUserId, user, text) {
  const body = {
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            ...(botUserId ? [{ type: 'mention', attrs: { id: botUserId } }] : []),
            { type: 'text', text: ` ${text}` },
          ],
        },
      ],
    },
    mentions: botUserId ? [botUserId] : undefined,
  };
  return request('POST', `/workspaces/${workspaceId}/channels/${channelId}/messages`, body, user.token);
}

async function getLatestBotMessage(workspaceId, channelId, token) {
  const res = await request('GET', `/workspaces/${workspaceId}/channels/${channelId}/messages?limit=5`, null, token);
  const msgs = res.body?.data?.messages ?? [];
  return msgs.find((m) => m.sender?.isBot) ?? null;
}

async function countRecentBotReplies(workspaceId, channelId, token, sinceIso) {
  const res = await request('GET', `/workspaces/${workspaceId}/channels/${channelId}/messages?limit=100`, null, token);
  const msgs = res.body?.data?.messages ?? [];
  const bot = msgs.filter((m) => m.sender?.isBot && new Date(m.createdAt) >= new Date(sinceIso));
  const counts = { total: bot.length, workspaceLimit: 0, queueOverloaded: 0, perUserLimit: 0, real: 0, processing: 0 };
  for (const m of bot) {
    const c = typeof m.content === 'string' ? m.content : '';
    if (c.includes('Workspace của bạn đang gửi')) counts.workspaceLimit++;
    else if (c.includes('Hệ thống đang bận')) counts.queueOverloaded++;
    else if (c.includes('hơi nhanh')) counts.perUserLimit++;
    else if (c === '🤖 Đang xử lý...') counts.processing++;
    else if (c) counts.real++;
  }
  return counts;
}

async function waitQueueDrain(maxWaitMs = 120000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const res = await request('GET', '/ai-providers/health', null, null);
    const q = res.body?.data?.queueDepth;
    if (q && q.active === 0 && q.waiting === 0) return true;
    await sleep(3000);
  }
  return false;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); // workspace A
  const extra = JSON.parse(fs.readFileSync(EXTRA_WS_FILE, 'utf8')).workspaces; // workspace B, C, D
  const wsB = extra[0];

  console.log('\n=== Y2: spam workspace A (10x4=40 tin), NGAY LÚC ĐÓ gõ 1 câu ở workspace B ===');
  const sendPromises = [];
  for (const u of data.users) {
    for (let i = 0; i < 4; i++) {
      sendPromises.push(sendAiMessage(data.workspaceId, data.channelId, data.botUserId, u, `Cho tôi biết giờ hiện tại (Y2 lượt ${i + 1})`));
    }
  }
  const y2Start = new Date().toISOString();
  await Promise.all(sendPromises);
  const uB = data.users[0]; // user global, đã add vào workspace B
  const bSendStart = new Date().toISOString();
  const bSendRes = await sendAiMessage(wsB.id, wsB.channelId, wsB.botUserId, uB, 'Xem schema bảng Customers trên SQL Server');
  console.log('  gửi workspace B lúc A đang bị spam — status:', bSendRes.status);

  console.log('  Đợi workspace B trả lời (đo thời gian phản hồi)...');
  let bReply = null;
  const bDeadline = Date.now() + 60000;
  while (Date.now() < bDeadline) {
    const msg = await getLatestBotMessage(wsB.id, wsB.channelId, uB.token);
    if (msg && typeof msg.content === 'string' && msg.content !== '🤖 Đang xử lý...') {
      bReply = msg;
      break;
    }
    await sleep(2000);
  }
  console.log('  workspace B reply:', bReply ? String(bReply.content).slice(0, 200) : '(timeout)');
  console.log('  workspace B latency:', bReply ? `${new Date(bReply.createdAt) - new Date(bSendStart)}ms` : 'n/a');

  console.log('  Đợi hàng đợi rỗng rồi đếm phân loại tin ở workspace A...');
  await waitQueueDrain();
  const aCounts = await countRecentBotReplies(data.workspaceId, data.channelId, data.users[0].token, y2Start);
  console.log('  Phân loại bot reply ở workspace A (kể từ lúc bắn):', JSON.stringify(aCounts));

  console.log('\n=== Y3: CẢ 4 workspace (A + 3 mới) bắn 30 tin/workspace GẦN ĐỒNG THỜI (tổng 120 job) ===');
  const allWorkspaces = [
    { id: data.workspaceId, channelId: data.channelId, botUserId: data.botUserId, label: 'A (gốc)' },
    { id: extra[0].id, channelId: extra[0].channelId, botUserId: extra[0].botUserId, label: 'B' },
    { id: extra[1].id, channelId: extra[1].channelId, botUserId: extra[1].botUserId, label: 'C' },
    { id: extra[2].id, channelId: extra[2].channelId, botUserId: extra[2].botUserId, label: 'D' },
  ];
  const y3Start = new Date().toISOString();
  const y3Promises = [];
  for (const ws of allWorkspaces) {
    for (const u of data.users) {
      for (let i = 0; i < 3; i++) {
        // 10 user x 3 = 30 tin/workspace
        y3Promises.push(
          sendAiMessage(ws.id, ws.channelId, ws.botUserId, u, `Y3 load test lượt ${i + 1}`).then((res) => ({
            ws: ws.label,
            status: res.status,
          })),
        );
      }
    }
  }
  const y3Results = await Promise.all(y3Promises);
  console.log(`  Đã gửi ${y3Results.length} tin (4 workspace x 30) trong ${Date.now() - new Date(y3Start).getTime()}ms.`);
  const failedCreate = y3Results.filter((r) => r.status !== 200 && r.status !== 201);
  console.log(`  ${failedCreate.length} tin không tạo được (lỗi tầng API, KHÔNG phải admission control):`, JSON.stringify(failedCreate.slice(0, 5)));

  console.log('  Đợi hàng đợi rỗng...');
  await waitQueueDrain(180000);

  console.log('\n=== Đếm phân loại kết quả ở TỪNG workspace ===');
  for (const ws of allWorkspaces) {
    const counts = await countRecentBotReplies(ws.id, ws.channelId, data.users[0].token, y3Start);
    console.log(`  Workspace ${ws.label}:`, JSON.stringify(counts));
  }

  console.log('\n=== Health cuối cùng (kiểm tra hệ thống còn sống, DB còn kết nối được) ===');
  const finalHealth = await request('GET', '/ai-providers/health', null, null);
  console.log('  ', JSON.stringify(finalHealth.body?.data));

  console.log('\n✅ Xong Y2/Y3.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
