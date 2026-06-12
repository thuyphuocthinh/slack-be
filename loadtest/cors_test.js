// loadtest/cors_test.js
// Cấu hình kiểm thử CORS Misconfiguration (CORS Misconfiguration - OWASP API8:2023)
// Endpoint: https://api.tpt.io.vn/api/v1/auth/login

const TARGET_URL = 'https://api.tpt.io.vn/api/v1/auth/login';

async function runTest() {
  console.log('[CORS Test] Đang gửi yêu cầu preflight OPTIONS với Origin giả mạo...');
  console.log(`[Target] OPTIONS ${TARGET_URL}\n`);

  try {
    const response = await fetch(TARGET_URL, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://attacker.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
      }
    });

    const headers = response.headers;
    const allowOrigin = headers.get('access-control-allow-origin');
    const allowCredentials = headers.get('access-control-allow-credentials');

    console.log('--- KẾT QUẢ KIỂM THỬ ---');
    console.log(`HTTP Status Code: ${response.status}`);
    console.log(`Access-Control-Allow-Origin: ${allowOrigin}`);
    console.log(`Access-Control-Allow-Credentials: ${allowCredentials}`);

    // CORS bị cấu hình lỗi (lỏng lẻo) nếu:
    // 1. Cho phép bất kì origin nào (*) kèm theo credentials = true.
    // 2. Phản hồi lại chính xác domain attacker gửi lên (Allow-Origin = attacker.com) nhưng attacker không nằm trong whitelist.
    if (allowOrigin === '*' || allowOrigin === 'https://attacker.com') {
      if (allowCredentials === 'true') {
        console.log('\n❌ KẾT QUẢ: CỰC KỲ NGUY HIỂM (Hệ thống bị cấu hình CORS lỏng lẻo!)');
        console.log('Giải thích: Hệ thống cho phép domain lạ đọc/ghi dữ liệu có kèm cookie/credentials của nạn nhân.');
      } else {
        console.log('\n❌ KẾT QUẢ: CÓ RỦI RO (Hệ thống cho phép mọi Origin truy cập dữ liệu public)');
        console.log('Giải thích: Nên giới hạn danh sách origin cụ thể để đảm bảo an toàn tuyệt đối.');
      }
    } else {
      console.log('\n✅ KẾT QUẢ: AN TOÀN (CORS được cấu hình chặt chẽ!)');
      console.log('Giải thích: Hệ thống từ chối hoặc không trả về Header CORS cho Origin giả mạo.');
    }
  } catch (error) {
    console.error('❌ Lỗi thực thi request:', error.message);
  }
}

runTest();
