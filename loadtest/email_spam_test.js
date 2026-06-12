// loadtest/email_spam_test.js
// Cấu hình kiểm thử Spam luồng gửi mail/OTP (Unrestricted Access to Sensitive Business Flows - OWASP API6:2023)
// Endpoint: POST /api/v1/auth/resend-code

const TARGET_URL = 'https://api.tpt.io.vn/api/v1/auth/resend-code';

async function sendResendRequest(index) {
  try {
    const response = await fetch(TARGET_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: 'thuyphuocthinhtpt+4@gmail.com',
        action: 'verify_email'
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
  console.log('[Email Spam Test] Bắt đầu gửi 10 requests resend-code liên tục để kiểm tra Rate Limit...');
  console.log(`[Target] POST ${TARGET_URL}\n`);

  const results = [];
  for (let i = 1; i <= 10; i++) {
    const status = await sendResendRequest(i);
    results.push(status);
    await new Promise(resolve => setTimeout(resolve, 100)); // Gửi nhanh
  }

  console.log('\n--- KẾT QUẢ KIỂM THỬ ---');
  const has429 = results.includes(429);

  if (has429) {
    console.log('\n✅ KẾT QUẢ: AN TOÀN (Hệ thống chống Spam gửi mail tốt!)');
    console.log('Giải thích: Hệ thống đã chặn gửi mã liên tục với mã lỗi 429 (Too Many Requests).');
  } else {
    console.log('\n❌ KẾT QUẢ: NGUY HIỂM (Hệ thống không chặn Spam gửi mail/OTP!)');
    console.log('Giải thích: Hệ thống cho phép yêu cầu gửi mail liên tục mà không có cơ chế chặn/hạn chế tần suất.');
  }
}

runTest();
