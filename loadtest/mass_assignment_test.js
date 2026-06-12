// loadtest/mass_assignment_test.js
// Cấu hình kiểm thử lỗi Mass Assignment (Gán thuộc tính hàng loạt)
// Bạn có thể đổi sang 'https://api.tpt.io.vn' hoặc chạy dưới local 'http://localhost:3000'
const BASE_URL = 'https://api.tpt.io.vn';

const TOKEN_USER =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmMmQ1NWJiZi02YjEyLTQwZWEtYTg2NS00ZDIyNGIwMTNlOTAiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzRAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjoxLCJpYXQiOjE3ODEyNzEyMzUsImV4cCI6MTc4MTI3MzAzNX0.AEIvDHRlAn0Mec5myqZgzaGhCAShD32bn4iDPQKODOg';

async function runMassAssignmentTest() {
  console.log('[Mass Assignment Test] Gửi request PATCH update profile kèm theo các trường độc hại (systemRole, isPro)...');
  console.log(`[Target] PATCH ${BASE_URL}/api/v1/users/me/update-info`);

  try {
    const response = await fetch(`${BASE_URL}/api/v1/users/me/update-info`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${TOKEN_USER}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        firstName: 'Thinh',
        lastName: 'Test',
        systemRole: 'admin', // Cố tình truyền thêm thuộc tính nhạy cảm
        isPro: true          // Cố tình tự nâng cấp gói cước
      }),
    });

    const status = response.status;
    const body = await response.text();

    console.log('\n--- KẾT QUẢ KIỂM THỬ ---');
    console.log(`HTTP Status Code: ${status}`);
    console.log(`Response Body: ${body}`);

    if (status === 400) {
      console.log('✅ KẾT QUẢ: AN TOÀN (Hệ thống ngăn chặn thành công!)');
      console.log('Giải thích: ValidationPipe đã kích hoạt forbidNonWhitelisted để từ chối ngay lập tức các thuộc tính lạ.');
    } else if (status === 200) {
      const parsedBody = JSON.parse(body);
      const data = parsedBody.data || parsedBody;
      
      if (data.systemRole === 'admin' || data.isPro === true) {
        console.log('❌ KẾT QUẢ: NGUY HIỂM (Hệ thống dính lỗ hổng Mass Assignment!)');
        console.log('Giải thích: Các trường nhạy cảm tự nâng cấp đã được lưu vào profile.');
      } else {
        console.log('✅ KẾT QUẢ: AN TOÀN (Hệ thống lọc bỏ thành công!)');
        console.log('Giải thích: Request thành công nhưng các trường lạ bị whitelist loại bỏ, không lưu vào database.');
      }
    } else {
      console.log(`⚠️ KẾT QUẢ: Chưa xác định (HTTP Code ${status}).`);
    }
  } catch (error) {
    console.error('Lỗi khi thực hiện request:', error.message);
  }
}

runMassAssignmentTest();
