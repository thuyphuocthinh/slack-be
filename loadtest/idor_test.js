// loadtest/idor_test.js
// Cấu hình kiểm thử IDOR / BOLA
// Bạn có thể đổi sang 'https://api.tpt.io.vn' hoặc chạy dưới local 'http://localhost:3000'
const BASE_URL = 'https://api.tpt.io.vn';

// ĐIỀN THÔNG TIN TOKEN & ID ĐỂ TEST
const TOKEN_USER_B =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmMmQ1NWJiZi02YjEyLTQwZWEtYTg2NS00ZDIyNGIwMTNlOTAiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzRAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjoxLCJpYXQiOjE3ODEyNzEyMzUsImV4cCI6MTc4MTI3MzAzNX0.AEIvDHRlAn0Mec5myqZgzaGhCAShD32bn4iDPQKODOg';
const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';
const CHANNEL_ID_A = 'baf4f98c-a33f-4adf-af81-99ace6d62083';

async function runIdorTest() {
  console.log('[IDOR Test] Bắt đầu gửi request xóa kênh...');
  console.log(
    `[Target] DELETE ${BASE_URL}/api/v1/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID_A}`,
  );

  try {
    const response = await fetch(
      `${BASE_URL}/api/v1/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID_A}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${TOKEN_USER_B}`,
          'Content-Type': 'application/json',
        },
      },
    );

    const status = response.status;
    const body = await response.text();

    console.log('\n--- KẾT QUẢ KIỂM THỬ ---');
    console.log(`HTTP Status Code: ${status}`);
    console.log(`Response Body: ${body}`);

    const isBlocked = status === 403 || status === 401 || status === 404 || (status === 500 && body.includes('NOT ALLOWED'));

    if (isBlocked) {
      console.log('✅ KẾT QUẢ: AN TOÀN (Hệ thống ngăn chặn thành công!)');
      console.log(
        'Giải thích: Hệ thống đã phát hiện User B không phải OWNER của kênh/workspace nên đã chặn đứng hành vi xóa.',
      );
    } else if (status === 200 || status === 204) {
      console.log('❌ KẾT QUẢ: NGUY HIỂM (Hệ thống dính lỗ hổng IDOR/BOLA!)');
      console.log(
        'Giải thích: User B không có quyền sở hữu nhưng vẫn xóa được kênh của User A.',
      );
    } else {
      console.log(
        `⚠️ KẾT QUẢ: Chưa xác định (HTTP Code ${status}). Hãy kiểm tra lại Token hoặc ID truyền vào.`,
      );
    }
  } catch (error) {
    console.error('Lỗi khi thực hiện request:', error.message);
  }
}

runIdorTest();
