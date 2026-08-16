/**
 * Bản k6 của notification_fanout_concurrent_burst.js (script Node cũ) — để
 * có report HTML qua k6-reporter thay vì đọc JSON tay.
 *
 * k6 không có DB access (không dùng được "pg" trong sandbox JS) nên phần
 * verify notification/duplicate trong Postgres vẫn phải làm RIÊNG sau khi
 * chạy xong (xem hướng dẫn cuối file) — script này chỉ đo đúng phần k6 làm
 * tốt nhất: HTTP latency + tỉ lệ lỗi của N request reply đồng thời.
 *
 * Mỗi VU tự ký JWT (k6/crypto hmac, giống hệt kỹ thuật ở seed_bulk_users.js)
 * cho ĐÚNG 1 cặp (root author, reply sender) riêng — không trùng user giữa
 * các VU khác, tránh lệch điều kiện enqueue (userIdsWithoutSender).
 *
 * Chạy:
 *   JWT_SECRET=$(giá trị thật trong .env) k6 run \
 *     -e JWT_SECRET=$JWT_SECRET -e N=30 \
 *     loadtest/notification_fanout_burst.k6.js
 */

import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import encoding from 'k6/encoding';
import crypto from 'k6/crypto';
import { htmlReport } from 'https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js';
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';

const N = parseInt(__ENV.N || '30', 10);
const JWT_SECRET = __ENV.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Thiếu -e JWT_SECRET=<giá trị trong .env>');
}

const base = new SharedArray('bulk users', function () {
  const data = JSON.parse(open('./loadtest-users-bulk.json'));
  return [{ workspaceId: data.workspaceId, channelId: data.channelId, users: data.users }];
})[0];

if (base.users.length < N * 2) {
  throw new Error(`Cần ${N * 2} user (2/VU) nhưng file chỉ có ${base.users.length}`);
}

function base64url(str) {
  return encoding.b64encode(str, 'rawurl');
}

function signJwtHS256(payload, secret) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = Object.assign({}, payload, { iat: now, exp: now + 4 * 3600 });
  const signingInput = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(body));
  const signature = crypto.hmac('sha256', secret, signingInput, 'base64rawurl');
  return signingInput + '.' + signature;
}

export const options = {
  scenarios: {
    burst: {
      executor: 'per-vu-iterations',
      vus: N,
      iterations: 1,
      maxDuration: '2m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
};

export default function () {
  const i = __VU - 1; // __VU đếm từ 1
  const rootAuthor = base.users[i * 2];
  const sender = base.users[i * 2 + 1];
  const API_URL = `http://localhost:3000/api/v1/workspaces/${base.workspaceId}/channels/${base.channelId}/messages`;

  const rootToken = signJwtHS256({ sub: rootAuthor.userId, email: rootAuthor.email, tokenVersion: 1 }, JWT_SECRET);
  const rootRes = http.post(
    API_URL,
    JSON.stringify({ content: `[k6-burst] root VU${__VU} ${new Date().toISOString()}` }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rootToken}` } },
  );
  const rootOk = check(rootRes, { 'root created (2xx)': (r) => r.status === 200 || r.status === 201 });
  if (!rootOk) {
    console.log(`VU${__VU} root FAILED status=${rootRes.status} body=${rootRes.body}`);
    return;
  }
  const rootId = rootRes.json('data.id') || rootRes.json('id');

  const senderToken = signJwtHS256({ sub: sender.userId, email: sender.email, tokenVersion: 1 }, JWT_SECRET);
  const replyRes = http.post(
    API_URL,
    JSON.stringify({ content: `[k6-burst] reply VU${__VU}`, parentId: rootId }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${senderToken}` } },
  );
  const replyOk = check(replyRes, { 'reply created (2xx)': (r) => r.status === 200 || r.status === 201 });
  if (!replyOk) {
    console.log(`VU${__VU} reply FAILED status=${replyRes.status} body=${replyRes.body}`);
    return;
  }
  const replyId = replyRes.json('data.id') || replyRes.json('id');
  // In ra để bước verify Postgres SAU KHI test xong lấy lại danh sách replyId
  // (k6 sandbox không có DB access — xem hướng dẫn đầu file).
  console.log(`REPLY_ID ${replyId}`);
}

export function handleSummary(data) {
  return {
    'summary.html': htmlReport(data),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}
