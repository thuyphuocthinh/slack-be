// loadtest/injection_test.js
// Cấu hình kiểm thử Injection (SQL Injection & XSS)
// Bạn có thể đổi sang 'https://api.tpt.io.vn' hoặc chạy dưới local 'http://localhost:3000'
const BASE_URL = 'https://api.tpt.io.vn';

// Token của User B (User thường) đã dùng ở các bài trước
const TOKEN_USER =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmMmQ1NWJiZi02YjEyLTQwZWEtYTg2NS00ZDIyNGIwMTNlOTAiLCJlbWFpbCI6InRodXlwaHVvY3RoaW5odHB0KzRAZ21haWwuY29tIiwidG9rZW5WZXJzaW9uIjoxLCJpYXQiOjE3ODEyNzEyMzUsImV4cCI6MTc4MTI3MzAzNX0.AEIvDHRlAn0Mec5myqZgzaGhCAShD32bn4iDPQKODOg';

const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';
const CHANNEL_ID = 'baf4f98c-a33f-4adf-af81-99ace6d62083';

async function testSqlInjection() {
  console.log('\n--- 1. KIỂM THỬ SQL INJECTION (SQLi) ---');
  // Email chứa payload SQL Injection độc hại để bypass hoặc gây lỗi syntax
  const sqliPayload = "nonexistent@gmail.com' OR '1'='1";
  console.log(`[Target] GET ${BASE_URL}/api/v1/users/find-by-email?email=${encodeURIComponent(sqliPayload)}`);

  try {
    const response = await fetch(
      `${BASE_URL}/api/v1/users/find-by-email?email=${encodeURIComponent(sqliPayload)}`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN_USER}`,
        },
      }
    );

    const status = response.status;
    const body = await response.text();

    console.log(`HTTP Status Code: ${status}`);
    console.log(`Response Body: ${body}`);

    if (status === 200) {
      const parsed = JSON.parse(body);
      const data = parsed.data || parsed;
      if (Array.isArray(data) && data.length > 0) {
        // Nếu trả về user mặc dù email truyền vào là linh tinh + sql bypass
        console.log('❌ KẾT QUẢ: NGUY HIỂM (Hệ thống bị SQL Injection bypass!)');
      } else {
        console.log('✅ KẾT QUẢ: AN TOÀN (Hệ thống chống SQL Injection tốt!)');
        console.log('Giải thích: TypeORM đã sử dụng Parameterized Query nên chuỗi SQL Injection bị coi là text bình thường.');
      }
    } else if (status === 500) {
      if (body.includes('syntax error') || body.includes('SQL')) {
        console.log('❌ KẾT QUẢ: NGUY HIỂM (Có lỗi cú pháp SQL, khả năng cao bị SQLi!)');
      } else {
        console.log('✅ KẾT QUẢ: AN TOÀN (Lỗi hệ thống thông thường hoặc validate chặn đứng request)');
      }
    } else {
      console.log('✅ KẾT QUẢ: AN TOÀN (Hệ thống từ chối payload không hợp lệ)');
    }
  } catch (error) {
    console.error('Lỗi khi thực hiện SQLi request:', error.message);
  }
}

async function testXss() {
  console.log('\n--- 2. KIỂM THỬ CROSS-SITE SCRIPTING (XSS) ---');
  // Tin nhắn chứa mã script XSS độc hại
  const xssPayload = "<script>alert('XSS')</script><img src=x onerror=alert('XSS')>";
  console.log(`[Target] POST ${BASE_URL}/api/v1/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID}/messages`);

  try {
    const response = await fetch(
      `${BASE_URL}/api/v1/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN_USER}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: xssPayload,
        }),
      }
    );

    const status = response.status;
    const body = await response.text();

    console.log(`HTTP Status Code: ${status}`);
    console.log(`Response Body: ${body}`);

    if (status === 400) {
      console.log('✅ KẾT QUẢ: AN TOÀN (Hệ thống chặn đứng mã độc XSS thành công!)');
      console.log('Giải thích: Custom validator @IsNotHtmlXss tại DTO layer đã phát hiện payload chứa thẻ HTML/script nguy hiểm và trả về lỗi 400.');
    } else if (status === 200 || status === 201) {
      console.log('❌ KẾT QUẢ: NGUY HIỂM (Mã độc XSS được lưu trực tiếp vào cơ sở dữ liệu!)');
      console.log('Giải thích: Tin nhắn chứa mã độc đã được gửi lên thành công mà không bị chặn.');
    } else {
      console.log(`⚠️ KẾT QUẢ: Request thất bại (HTTP Code ${status}).`);
    }
  } catch (error) {
    console.error('Lỗi khi thực hiện XSS request:', error.message);
  }
}

async function runTests() {
  await testSqlInjection();
  await testXss();
}

runTests();
