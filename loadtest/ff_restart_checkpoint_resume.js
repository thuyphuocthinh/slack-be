/**
 * Nhóm FF (manual_test_bank_heavy.md) — Restart giữa chừng, checkpoint có
 * resume đúng không.
 *
 * FF1: Turn dừng chờ duyệt (ApprovalRequestCard) → restart orchestration
 *      NGAY LÚC ĐÓ (trước khi bấm Duyệt) → bấm Duyệt sau khi service lên lại
 *      → phải chạy tiếp đúng chỗ cũ, không mất checkpoint, không làm lại từ đầu.
 * FF2: Tương tự FF1 nhưng bấm Từ chối sau khi restart → phải huỷ đúng, không
 *      để lại checkpoint treo vĩnh viễn.
 *
 * Dùng `pm2 restart orchestration` thật (không phải mô phỏng) — restart CHỈ
 * service orchestration, không đụng service khác.
 *
 * Chạy: node loadtest/ff_restart_checkpoint_resume.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { Client } = require('pg');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
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

async function getLatestBotMessage(data, token) {
  const res = await request(
    'GET',
    `/workspaces/${data.workspaceId}/channels/${data.channelId}/messages?limit=5`,
    null,
    token,
  );
  const msgs = res.body?.data?.messages ?? [];
  return msgs.find((m) => m.sender?.isBot) ?? null;
}

function resolveApproval(user, messageId, action) {
  return request('POST', `/ai-providers/approvals/${messageId}`, { action }, user.token);
}

async function pgQuery(sql, params) {
  const pg = new Client({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASS || 'postgres',
    database: process.env.DB_NAME || 'slack_db',
  });
  await pg.connect();
  const res = await pg.query(sql, params);
  await pg.end();
  return res.rows;
}

function restartOrchestration() {
  console.log('  >>> pm2 restart orchestration ...');
  const out = execSync('pm2 restart orchestration', { encoding: 'utf8' });
  console.log('  ' + out.split('\n').slice(0, 3).join(' | '));
}

async function waitForApprovalCard(data, token, maxWaitMs = 60000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const msg = await getLatestBotMessage(data, token);
    if (msg && typeof msg.content === 'object' && msg.content?.type === 'approval_request') {
      return msg;
    }
    await sleep(2000);
  }
  return null;
}

async function waitForOrchestrationHealthy(maxWaitMs = 30000) {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    try {
      const res = await request('GET', '/ai-providers/health', null, null);
      if (res.status === 200 && res.body?.data?.status === 'ok') return true;
    } catch {}
    await sleep(1500);
  }
  return false;
}

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const u1 = data.users[3];
  const u2 = data.users[4];

  console.log('\n=== FF1: chờ duyệt DELETE, restart orchestration TRƯỚC khi duyệt, rồi Approve ===');
  await sendAiMessage(data, u1, 'Xoá tất cả dòng trong bảng Products có giá dưới 10');
  const approvalMsg1 = await waitForApprovalCard(data, u1.token);
  console.log('  approval card:', approvalMsg1 ? JSON.stringify(approvalMsg1.content).slice(0, 200) : '(không thấy — abort)');
  if (!approvalMsg1) process.exit(1);

  const checkpointBefore = await pgQuery(
    'SELECT id, status, execution_started_at FROM orchestration_checkpoints WHERE reply_message_id=$1',
    [approvalMsg1.id],
  );
  console.log('  checkpoint TRƯỚC restart:', JSON.stringify(checkpointBefore[0]));

  restartOrchestration();
  console.log('  Đợi orchestration healthy lại...');
  const healthy = await waitForOrchestrationHealthy();
  console.log('  healthy:', healthy);
  await sleep(2000);

  const checkpointAfterRestart = await pgQuery(
    'SELECT id, status FROM orchestration_checkpoints WHERE reply_message_id=$1',
    [approvalMsg1.id],
  );
  console.log('  checkpoint SAU restart (phải còn nguyên "pending"):', JSON.stringify(checkpointAfterRestart[0]));

  console.log('  >>> Bấm Approve...');
  const approveRes = await resolveApproval(u1, approvalMsg1.id, 'approve');
  console.log('  approve() status:', approveRes.status, JSON.stringify(approveRes.body).slice(0, 200));
  await sleep(6000);
  const afterApprove = await getLatestBotMessage(data, u1.token);
  console.log('  bot message SAU approve:', afterApprove ? JSON.stringify(afterApprove.content).slice(0, 300) : '(không thấy)');
  const checkpointFinal = await pgQuery(
    'SELECT id, status, tool_executed_at FROM orchestration_checkpoints WHERE reply_message_id=$1',
    [approvalMsg1.id],
  );
  console.log('  checkpoint CUỐI:', JSON.stringify(checkpointFinal[0]));

  console.log('\n=== FF2: chờ duyệt DELETE khác, restart orchestration, rồi Từ chối ===');
  await sendAiMessage(data, u2, "Xoá tất cả dòng trong bảng Products có tên 'Test Product FF2 Không Tồn Tại'");
  const approvalMsg2 = await waitForApprovalCard(data, u2.token);
  console.log('  approval card:', approvalMsg2 ? JSON.stringify(approvalMsg2.content).slice(0, 200) : '(không thấy — abort)');
  if (!approvalMsg2) process.exit(1);

  restartOrchestration();
  const healthy2 = await waitForOrchestrationHealthy();
  console.log('  healthy sau restart lần 2:', healthy2);
  await sleep(2000);

  console.log('  >>> Bấm Từ chối...');
  const rejectRes = await resolveApproval(u2, approvalMsg2.id, 'reject');
  console.log('  reject() status:', rejectRes.status, JSON.stringify(rejectRes.body).slice(0, 200));
  await sleep(4000);
  const afterReject = await getLatestBotMessage(data, u2.token);
  console.log('  bot message SAU reject:', afterReject ? JSON.stringify(afterReject.content).slice(0, 300) : '(không thấy)');
  const checkpointFinal2 = await pgQuery(
    'SELECT id, status FROM orchestration_checkpoints WHERE reply_message_id=$1',
    [approvalMsg2.id],
  );
  console.log('  checkpoint CUỐI (phải là "rejected", không kẹt "pending"):', JSON.stringify(checkpointFinal2[0]));

  console.log('\n✅ Xong FF1/FF2.');
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
