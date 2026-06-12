// loadtest/resource_limit_test.js
// Cấu hình kiểm thử giới hạn tài nguyên phân trang (Pagination Limit Abuse)
// Endpoint: GET /api/v1/workspaces/:workspaceId/channels/:channelId/messages?limit=1000000

const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';
const CHANNEL_ID = '94029366-3018-4f48-8532-a629c81e79e5';
const EXTREME_LIMIT = 1000000;

const LOGIN_URL = 'https://api.tpt.io.vn/api/v1/auth/login';
const TARGET_URL = `https://api.tpt.io.vn/api/v1/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID}/messages?limit=${EXTREME_LIMIT}`;

async function getFreshToken() {
  console.log('[Resource Limit Test] Đang lấy token mới từ API login...');
  const response = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: 'thuyphuocthinhtpt+4@gmail.com',
      password: '123456Aa'
    })
  });

  if (!response.ok) {
    throw new Error(`Đăng nhập thất bại: ${response.statusText}`);
  }

  const result = await response.json();
  return result.data.accessToken;
}

async function runTest() {
  try {
    const token = await getFreshToken();
    console.log('[Resource Limit Test] Đăng nhập thành công, thu được Token mới.');
    console.log('[Resource Limit Test] Bắt đầu gửi request lấy tin nhắn với limit cực lớn...');
    console.log(`[Target] GET ${TARGET_URL}\n`);

    const response = await fetch(TARGET_URL, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    const status = response.status;
    const body = await response.text();

    console.log('--- KẾT QUẢ KIỂM THỬ ---');
    console.log(`HTTP Status Code: ${status}`);
    console.log(`Response Body: ${body}`);

    if (status === 400) {
      console.log('\n✅ KẾT QUẢ: AN TOÀN (Hệ thống ngăn chặn thành công!)');
      console.log('Giải thích: ValidationPipe đã kích hoạt kiểm tra giới hạn phân trang tối đa (ví dụ: max 100) và từ chối request.');
    } else if (status === 200 || status === 201) {
      console.log('\n❌ KẾT QUẢ: NGUY HIỂM (Hệ thống dính lỗi Unrestricted Resource Consumption!)');
      console.log('Giải thích: Hệ thống cho phép truy vấn số lượng bản ghi khổng lồ cùng lúc, có thể dẫn đến treo DB/Server.');
    } else {
      console.log('\n⚠️ KẾT QUẢ: Chưa xác định. Vui lòng kiểm tra lại cấu hình.');
    }
  } catch (error) {
    console.error('❌ Lỗi thực thi request:', error.message);
  }
}

runTest();
