import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// Định nghĩa Custom Metrics để hiển thị trên k6 summary
const connectionTime = new Trend('canvas_handshake_duration');
const connectionDropRate = new Rate('canvas_drop_rate');

export const options = {
  stages: [
    { duration: '30s', target: 100 }, // Ramp-up lên 100 VUs
    { duration: '1m', target: 300 },  // Duy trì 300 VUs (Mô phỏng 300 người đang cùng mở Canvas)
    { duration: '30s', target: 0 },   // Ramp-down
  ],
  thresholds: {
    canvas_handshake_duration: ['p(95)<300', 'p(99)<600'], // Thời gian bắt tay WS phải nhanh
    canvas_drop_rate: ['rate<0.01'], // Tỉ lệ đứt kết nối dưới 1%
  },
};

// Mặc định cổng 1234 cho Hocuspocus server, có thể tuỳ chỉnh qua biến môi trường
const WS_URL = __ENV.WS_URL || 'ws://localhost:1234';
const CANVAS_ID = __ENV.CANVAS_ID || 'loadtest-canvas-1';
const TOKEN = __ENV.TOKEN || 'dummy-token';

export default function () {
  const startConnect = Date.now();
  
  // Hocuspocus Server mong đợi kết nối trực tiếp đến endpoint gốc hoặc có thể truyền params
  // Tuỳ thuộc vào thiết lập cụ thể của Hocuspocus, ở đây mô phỏng kết nối tiêu chuẩn với token
  const urlWithParams = `${WS_URL}/${CANVAS_ID}?token=${TOKEN}`;

  const res = ws.connect(urlWithParams, {}, function (socket) {
    connectionTime.add(Date.now() - startConnect);

    socket.on('open', () => {
      // Kết nối thành công tới Canvas Server (Hocuspocus)
    });

    socket.on('message', (msg) => {
      // Nhận binary sync message từ Hocuspocus (Yjs protocol)
      // k6 không giải mã trực tiếp được Yjs protocol dễ dàng, nhưng ta có thể xác nhận là server có phản hồi.
    });

    socket.on('close', () => {
      // Đóng kết nối
    });

    socket.on('error', (e) => {
      // Có lỗi rớt mạng hoặc crash server
      connectionDropRate.add(1);
    });

    // Giữ kết nối mở trong suốt quá trình test để mô phỏng người dùng đang treo máy xem Canvas
    socket.setTimeout(function () {
      connectionDropRate.add(0); // Kết nối giữ vững tới khi timeout kịch bản
      socket.close();
    }, 120000); // 2 phút
  });

  check(res, { 'Canvas WS connected successfully (101)': (r) => r && r.status === 101 });
}
