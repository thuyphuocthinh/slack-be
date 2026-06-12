// loadtest/brute_force_test.js
// Cấu hình kiểm thử Brute Force & Rate Limiting (Broken Authentication - OWASP API2:2023)
// Endpoint: POST /api/v1/auth/login

const TARGET_URL = 'https://api.tpt.io.vn/api/v1/auth/login';

async function sendRequest(index) {
  try {
    const response = await fetch(TARGET_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': `brute-force-test-device-${index}` // Tránh gom nhóm device id nếu hệ thống track
      },
      body: JSON.stringify({
        email: 'thuyphuocthinhtpt+4@gmail.com',
        password: 'wrongpassword123'
      })
    });

    const status = response.status;
    const body = await response.text();
    console.log(`[Request #${index}] HTTP Status Code: ${status} | Body: ${body.substring(0, 100)}`);
    return status;
  } catch (error) {
    console.error(`[Request #${index}] Lỗi:`, error.message);
    return null;
  }
}

async function runTest() {
  console.log('[Brute Force Test] Bắt đầu gửi 10 requests đăng nhập sai liên tiếp để kiểm tra Rate Limit...');
  console.log(`[Target] POST ${TARGET_URL}\n`);

  const results = [];
  // Gửi liên tiếp 10 request
  for (let i = 1; i <= 10; i++) {
    const status = await sendRequest(i);
    results.push(status);
    // Chờ 100ms giữa các request để mô phỏng thực tế gửi nhanh
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  console.log('\n--- KẾT QUẢ KIỂM THỬ ---');
  const has429 = results.includes(429);
  
  if (has429) {
    console.log('\n✅ KẾT QUẢ: AN TOÀN (Hệ thống chống Brute Force tốt!)');
    console.log('Giải thích: Hệ thống đã trả về HTTP Code 429 (Too Many Requests) khi phát hiện spam request đăng nhập liên tục.');
  } else {
    console.log('\n❌ KẾT QUẢ: NGUY HIỂM (Hệ thống không chặn Brute Force!)');
    console.log('Giải thích: Hệ thống cho phép thực hiện nhiều yêu cầu đăng nhập liên tiếp mà không bị giới hạn tần suất.');
  }
}

runTest();
