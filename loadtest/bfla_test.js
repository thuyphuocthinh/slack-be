// loadtest/bfla_test.js
// Cấu hình kiểm thử BFLA (Broken Function Level Authorization)
// Bạn có thể đổi sang 'https://api.tpt.io.vn' hoặc chạy dưới local 'http://localhost:3000'
const BASE_URL = 'https://api.tpt.io.vn';

// Lấy Token của User B (User thường) đã cấu hình ở các bài trước
const TOKEN_USER_B =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmMmQ1NWJiZi02YjEyLTQwZWEtYTg2NS00ZDIyNGIwMTNlOTAiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzRAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjoxLCJpYXQiOjE3ODEyNzEyMzUsImV4cCI6MTc4MTI3MzAzNX0.AEIvDHRlAn0Mec5myqZgzaGhCAShD32bn4iDPQKODOg';

// ID của User cần thay đổi trạng thái (ví dụ thay đổi trạng thái của chính User B)
const TARGET_USER_ID = 'f2d55bbf-6b12-40ea-a865-4d224b013e90'; 

async function runBflaTest() {
  console.log('[BFLA Test] Gửi request PATCH lên endpoint Admin làm thay đổi status của user...');
  console.log(`[Target] PATCH ${BASE_URL}/api/v1/users/${TARGET_USER_ID}/change-status`);

  try {
    const response = await fetch(`${BASE_URL}/api/v1/users/${TARGET_USER_ID}/change-status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${TOKEN_USER_B}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'inactive'
      }),
    });

    const status = response.status;
    const body = await response.text();

    console.log('\n--- KẾT QUẢ KIỂM THỬ ---');
    console.log(`HTTP Status Code: ${status}`);
    console.log(`Response Body: ${body}`);

    if (status === 403 || status === 401) {
      console.log('✅ KẾT QUẢ: AN TOÀN (Hệ thống ngăn chặn thành công!)');
      console.log('Giải thích: Hệ thống đã chặn đứng hành vi truy cập API Admin của User thường.');
    } else if (status === 200 || status === 201) {
      console.log('❌ KẾT QUẢ: NGUY HIỂM (Hệ thống dính lỗ hổng BFLA!)');
      console.log('Giải thích: User thường không có quyền Admin nhưng vẫn gọi được API Admin để đổi trạng thái User.');
    } else {
      console.log(`⚠️ KẾT QUẢ: Chưa xác định (HTTP Code ${status}).`);
    }
  } catch (error) {
    console.error('Lỗi khi thực hiện request:', error.message);
  }
}

runBflaTest();
