/**
 * Nhóm CC — CC1: throttle mạng >30s cho provider SQL Server, kiểm tra
 * MCP_CALL_TIMEOUT_MS=30_000 (ĐÃ SỬA — file gốc ghi nhầm 15_000, xem đầu file
 * mục CC) có timeout đúng, không treo cả turn vô thời hạn.
 *
 * Không có công cụ throttle mạng thật (tc/proxy) trên máy Windows này — viết
 * 1 proxy HTTP đơn giản: nhận request, gọi THẬT tới mcp_server (AGENT_SQL_SERVER_URL
 * hiện tại), rồi CỐ Ý delay DELAY_MS trước khi trả response về — giả lập
 * provider chậm (không phải chết hẳn như CC3), đúng ý "chậm >30s nhưng vẫn
 * phản hồi được" mà CC1 mô tả.
 *
 * CÁCH DÙNG (làm tay, không tự động — vì phải sửa .env + restart service):
 *   1. node loadtest/cc1_delay_proxy.js            (chạy proxy ở port 39018)
 *   2. Sửa .env: AGENT_SQL_SERVER_URL=http://localhost:39018/mcp
 *   3. pm2 restart orchestration --update-env
 *   4. Gõ "Xem schema bảng Customers trên SQL Server" — đợi >30s, kỳ vọng
 *      timeout đúng ở MCP_CALL_TIMEOUT_MS=30s, KHÔNG treo vô hạn, báo lỗi rõ.
 *   5. XONG: trả .env về AGENT_SQL_SERVER_URL=http://localhost:3018/mcp,
 *      pm2 restart orchestration --update-env, Ctrl+C proxy này.
 */

const http = require('http');

const LISTEN_PORT = 39018;
const TARGET_HOST = 'localhost';
const TARGET_PORT = 3018;
const DELAY_MS = 35_000; // > MCP_CALL_TIMEOUT_MS=30_000

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const bodyBuf = Buffer.concat(chunks);
    console.log(`[cc1-proxy] ${req.method} ${req.url} — gọi thật tới mcp_server, sẽ delay ${DELAY_MS}ms trước khi trả lời`);

    const proxyReq = http.request(
      {
        hostname: TARGET_HOST,
        port: TARGET_PORT,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `${TARGET_HOST}:${TARGET_PORT}` },
      },
      (proxyRes) => {
        const resChunks = [];
        proxyRes.on('data', (c) => resChunks.push(c));
        proxyRes.on('end', () => {
          const realBody = Buffer.concat(resChunks);
          console.log(`[cc1-proxy] mcp_server đã trả lời thật (status=${proxyRes.statusCode}) — giữ lại ${DELAY_MS}ms rồi mới forward cho slack-be...`);
          setTimeout(() => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end(realBody);
          }, DELAY_MS);
        });
      },
    );
    proxyReq.on('error', (err) => {
      console.error('[cc1-proxy] lỗi gọi mcp_server thật:', err.message);
      res.writeHead(502).end();
    });
    proxyReq.end(bodyBuf);
  });
});

server.listen(LISTEN_PORT, () => {
  console.log(`[cc1-proxy] Đang lắng nghe port ${LISTEN_PORT}, forward (có delay ${DELAY_MS}ms) tới http://${TARGET_HOST}:${TARGET_PORT}`);
  console.log('[cc1-proxy] Nhớ đổi AGENT_SQL_SERVER_URL trong .env sang http://localhost:39018/mcp rồi pm2 restart orchestration --update-env');
});
