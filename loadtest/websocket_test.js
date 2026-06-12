// loadtest/websocket_test.js
// Cấu hình kiểm thử rò rỉ session WebSocket sau khi Token hết hạn / bị khóa
// Cần cài đặt socket.io-client để chạy: npm i -D socket.io-client
const { io } = require('socket.io-client');

const SOCKET_URL = 'https://api.tpt.io.vn'; // Hoặc 'http://localhost:3008' nếu chạy local
const TOKEN_USER =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmMmQ1NWJiZi02YjEyLTQwZWEtYTg2NS00ZDIyNGIwMTNlOTAiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzRAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjoxLCJpYXQiOjE3ODEyNzEyMzUsImV4cCI6MTc4MTI3MzAzNX0.AEIvDHRlAn0Mec5myqZgzaGhCAShD32bn4iDPQKODOg';

const CHANNEL_ID = '94029366-3018-4f48-8532-a629c81e79e5';

console.log('[WebSocket Test] Đang kết nối tới server:', SOCKET_URL);

const socket = io(SOCKET_URL, {
  auth: {
    token: TOKEN_USER,
  },
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log('✅ KẾT NỐI THÀNH CÔNG! Socket ID:', socket.id);

  // Đăng ký nhận sự kiện ready từ server
  socket.on('server_ready', (data) => {
    console.log('Server Ready Message:', data);

    // Subscribe vào channel để nhận tin nhắn realtime
    console.log(`[WebSocket Test] Đăng ký lắng nghe kênh: ${CHANNEL_ID}`);
    socket.emit('subscribe_channel', { channelId: CHANNEL_ID });
  });

  // Đăng ký sự kiện khi đã vào phòng channel thành công
  socket.on('subscribed', (data) => {
    console.log(`✅ Đã vào phòng channel thành công:`, data);
  });

  // Đăng ký nhận tin nhắn mới
  socket.on('message_received', (message) => {
    console.log(
      '📩 NHẬN TIN NHẮN REALTIME THÀNH CÔNG! Nội dung:',
      message.content,
    );
  });

  console.log('\n--- KỊCH BẢN KIỂM THỬ ---');
  console.log('1. Giữ kết nối này mở (đang mở trong 60 giây).');
  console.log(
    '2. Hãy dùng User khác gửi một tin nhắn bất kỳ vào kênh này trên Web/App.',
  );
  console.log(
    '3. Nếu terminal này in ra dòng log "📩 NHẬN TIN NHẮN REALTIME THÀNH CÔNG!":',
  );
  console.log('   => Hệ thống đang nhận tin nhắn realtime bình thường.');
  console.log('4. Hãy đợi token này hết hạn hoặc block user này lại.');
  console.log(
    '5. Tiếp tục gửi tin nhắn mới, nếu kết nối này vẫn nhận được tin nhắn realtime:',
  );
  console.log(
    '   => Hệ thống dính lỗi: WebSocket Session Leak / Token Expiration.',
  );

  // Tự động ngắt kết nối sau 60 giây để bạn có đủ thời gian test gửi tin nhắn
  setTimeout(() => {
    console.log('\n[WebSocket Test] Đóng kết nối test.');
    socket.disconnect();
  }, 60000);
});

socket.on('connect_error', (err) => {
  console.error('❌ LỖI KẾT NỐI:', err.message);
});

socket.on('disconnect', (reason) => {
  console.log('🔌 SOCKET DISCONNECTED:', reason);
});
