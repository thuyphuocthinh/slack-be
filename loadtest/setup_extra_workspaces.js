/**
 * Setup cho nhóm Y2/Y3 — tạo thêm N workspace mới (mỗi workspace tự động có
 * sẵn 1 bot AI riêng do createWorkspace() seed, xem
 * apps/workspace/scripts/backfill-ai-bot.ts comment), mỗi workspace 1 channel
 * group, add cùng bộ 10 user test (dùng chung qua nhiều workspace — user là
 * global, không cần tạo user mới) + bot vào channel đó.
 *
 * Ghi kết quả ra loadtest/extra-workspaces.json — {workspaces: [{id, channelId, botUserId}]}
 *
 * Chạy: node loadtest/setup_extra_workspaces.js <N>   (mặc định N=3, đủ cho
 * Y3 cần ≥4 workspace TỔNG cộng với workspace gốc A trong loadtest-users.json)
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const http = require('http');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'loadtest-users.json');
const ADMIN_TOKEN_FILE = path.join(__dirname, '_admin_token.json');
const OUTPUT_FILE = path.join(__dirname, 'extra-workspaces.json');
const API_HOST = 'localhost';
const API_PORT = 3000;
const API_PREFIX = '/api/v1';
const NUM_WORKSPACES = Number(process.argv[2]) || 3;

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

(async () => {
  const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  const { token: adminToken } = JSON.parse(fs.readFileSync(ADMIN_TOKEN_FILE, 'utf8'));

  const workspaces = [];
  for (let i = 0; i < NUM_WORKSPACES; i++) {
    console.log(`\n=== Tạo workspace #${i + 1}/${NUM_WORKSPACES} ===`);
    const wsRes = await request('POST', '/workspaces', { name: `y-test-ws-${Date.now()}-${i}`, description: 'Y2/Y3 load test' }, adminToken);
    const wsId = wsRes.body?.data?.id;
    console.log('  workspace id:', wsId, 'status:', wsRes.status);
    if (!wsId) continue;

    const membersRes = await request('GET', `/workspaces/${wsId}/members`, null, adminToken);
    const botMember = (membersRes.body?.data ?? []).find((m) => m.isBot);
    console.log('  bot userId:', botMember?.userId);

    const chRes = await request('POST', `/workspaces/${wsId}/channels`, { title: 'y-test-channel', description: 'Y2/Y3', type: 'group' }, adminToken);
    const channelId = chRes.body?.data?.id;
    console.log('  channel id:', channelId, 'status:', chRes.status);

    // Add tất cả 10 user test hiện có vào workspace + channel (dùng lại user, không tạo mới)
    const addWs = await request('POST', `/workspaces/${wsId}/add-members`, { userIds: data.users.map((u) => u.userId), role: 'member' }, adminToken);
    console.log('  add-members workspace status:', addWs.status);
    const batchCh = await request(
      'POST',
      `/workspaces/${wsId}/channels/${channelId}/batch-members`,
      { targetMembers: data.users.map((u) => ({ email: u.email, memberId: u.userId })) },
      adminToken,
    );
    console.log('  batch-members channel status:', batchCh.status);

    // QUAN TRỌNG — bot là member của WORKSPACE (tự seed lúc createWorkspace())
    // nhưng KHÔNG tự động là member của CHANNEL mới tạo (đã dính bug này 1 lần
    // ở EE2 và Y2/Y3 — maybeTriggerAiOrchestration() cần bot nằm trong
    // channel.memberIds mới trigger AI). Add riêng.
    if (botMember?.userId) {
      const botEmail = `ai-assistant+${wsId}@internal.bot`;
      const addBotRes = await request(
        'POST',
        `/workspaces/${wsId}/channels/${channelId}/members`,
        { targetMember: { email: botEmail, memberId: botMember.userId } },
        adminToken,
      );
      console.log('  add bot vào channel status:', addBotRes.status);
    }

    workspaces.push({ id: wsId, channelId, botUserId: botMember?.userId });
    await sleep(500);
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify({ workspaces }, null, 2));
  console.log(`\n✅ Đã tạo ${workspaces.length} workspace, ghi ra ${OUTPUT_FILE}`);
})().catch((err) => {
  console.error('❌ Failed:', err);
  process.exit(1);
});
