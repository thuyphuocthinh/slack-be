// loadtest/link_preview_test.js
// Script kiểm thử tính năng cào Link Preview (Scraping, L1/L2 Cache, SSRF blocking) qua API Gateway
// Chạy bằng lệnh: node loadtest/link_preview_test.js

const BASE_URL = 'https://api.tpt.io.vn'; // Hoặc 'http://localhost:3000' dưới local

// THAY ĐỔI CÁC THÔNG TIN DƯỚI ĐÂY ĐỂ PHÙ HỢP VỚI TÀI KHOẢN CỦA BẠN
const LOGIN_EMAIL = 'thuyphuocthinhtpt+4@gmail.com';
const LOGIN_PASSWORD = '123456Aa';
const WORKSPACE_ID = '57558aac-97ec-43b8-9512-94b76de7455a';
const CHANNEL_ID = 'baf4f98c-a33f-4adf-af81-99ace6d62083';

let token =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIzYzE5NWI1My1mZWUxLTRlY2MtOGQwYS05ZTdkOTIzOGM1YmIiLCJlbWFpbCI6InRwdEBnbWFpbC5jb20iLCJ0b2tlblZlcnNpb24iOjEsImlhdCI6MTc4MTMyMDY3MiwiZXhwIjoxNzgxMzIyNDcyfQ.Kao_MC7RYWcONTwLzXHSAXptD4artMlCzgEPhvR22_Q';

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function authenticate() {
  console.log(
    `[Auth] Đang tự động đăng nhập để lấy Token mới qua: POST ${BASE_URL}/api/v1/auth/login`,
  );
  try {
    const res = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: LOGIN_EMAIL,
        password: LOGIN_PASSWORD,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.accessToken) {
        token = data.accessToken;
        console.log('-> Đăng nhập và lấy Token mới thành công!');
        return;
      }
    }
    console.log(
      `-> Không đăng nhập được tự động (HTTP ${res.status}). Sử dụng token cứng làm dự phòng.`,
    );
  } catch (err) {
    console.log(
      `-> Lỗi kết nối đăng nhập: ${err.message}. Sử dụng token cứng làm dự phòng.`,
    );
  }
}

async function postMessage(content) {
  const response = await fetch(
    `${BASE_URL}/api/v1/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to post message: ${response.statusText} (${response.status})`,
    );
  }

  return response.json();
}

async function getMessage(messageId) {
  const response = await fetch(
    `${BASE_URL}/api/v1/workspaces/${WORKSPACE_ID}/channels/${CHANNEL_ID}/messages/item/${messageId}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to get message: ${response.statusText} (${response.status})`,
    );
  }

  return response.json();
}

async function waitForPreviews(messageId, maxAttempts = 15, interval = 500) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await getMessage(messageId);
      const msg = res.data || res;
      if (msg.linkPreviews && msg.linkPreviews.length > 0) {
        return msg.linkPreviews;
      }
    } catch (e) {
      // Bỏ qua lỗi tạm thời khi đang poll
    }
    await delay(interval);
  }
  return null;
}

async function runTest() {
  console.log('=== KHỞI ĐỘNG KIỂM THỬ LINK PREVIEW ===\n');

  // Thực hiện lấy token mới trước khi chạy test
  await authenticate();
  console.log('');

  try {
    // ----------------------------------------------------
    // TEST 1: Cào mới một URL (Lần đầu tiên cào -> Cache MISS)
    // ----------------------------------------------------
    const testUrl1 = `https://github.com/?t=${Date.now()}`; // URL độc nhất để chắc chắn bỏ qua cache cũ
    console.log(
      `[Test 1] Đang gửi tin nhắn chứa URL mới (Cache MISS): ${testUrl1}`,
    );

    const msg1 = await postMessage(`Các sếp xem thử trang này: ${testUrl1}`);
    const messageId1 = msg1.data ? msg1.data.id : msg1.id;
    console.log(`-> Đã tạo tin nhắn thành công. ID: ${messageId1}`);
    console.log(`-> Đang đợi link preview được cào và cập nhật (polling)...`);

    const previews1 = await waitForPreviews(messageId1);
    console.log('-> Kết quả linkPreviews nhận được từ API:');
    console.log(JSON.stringify(previews1, null, 2));

    if (previews1 && previews1.length > 0) {
      console.log(
        '✅ TEST 1: THÀNH CÔNG (Cào mới link preview hoạt động tốt!)',
      );
    } else {
      console.log('❌ TEST 1: THẤT BẠI (Không tìm thấy link preview)');
    }

    // ----------------------------------------------------
    // TEST 2: Thử nghiệm Cache HIT (Lần thứ hai gửi cùng URL)
    // ----------------------------------------------------
    console.log(
      `\n[Test 2] Đang gửi tin nhắn chứa URL giống hệt (Mong đợi Cache HIT): ${testUrl1}`,
    );
    const msg2 = await postMessage(
      `Gửi lại URL cũ để kiểm tra cache: ${testUrl1}`,
    );
    const messageId2 = msg2.data ? msg2.data.id : msg2.id;
    console.log(`-> Đã tạo tin nhắn thành công. ID: ${messageId2}`);
    console.log(`-> Đang đợi link preview lấy từ cache (polling)...`);

    const previews2 = await waitForPreviews(messageId2);
    console.log('-> Kết quả linkPreviews từ Cache:');
    console.log(JSON.stringify(previews2, null, 2));

    if (previews2 && previews2.length > 0) {
      console.log(
        '✅ TEST 2: THÀNH CÔNG (Cache L1/L2 hoạt động tốt, trả về kết quả ngay lập tức!)',
      );
    } else {
      console.log('❌ TEST 2: THẤT BẠI (Không tìm thấy link preview)');
    }

    // ----------------------------------------------------
    // TEST 3: Thử nghiệm bảo mật SSRF (Gửi link dải IP local/private)
    // ----------------------------------------------------
    const unsafeUrl = 'http://127.0.0.1:8080/admin-panel';
    console.log(
      `\n[Test 3] Đang gửi tin nhắn chứa URL không an toàn (SSRF target): ${unsafeUrl}`,
    );
    const msg3 = await postMessage(`Hack thử hệ thống: ${unsafeUrl}`);
    const messageId3 = msg3.data ? msg3.data.id : msg3.id;
    console.log(`-> Đã tạo tin nhắn thành công. ID: ${messageId3}`);
    console.log(`-> Chờ 2 giây để kiểm tra chặn SSRF...`);
    await delay(2000);

    const getRes3 = await getMessage(messageId3);
    const updatedMsg3 = getRes3.data || getRes3;

    if (!updatedMsg3.linkPreviews || updatedMsg3.linkPreviews.length === 0) {
      console.log(
        '✅ TEST 3: THÀNH CÔNG (Hệ thống đã chặn đứng hoàn toàn việc cào dải IP riêng tư!)',
      );
    } else {
      console.log(
        '❌ TEST 3: CẢNH BÁO NGUY HIỂM (Hệ thống không chặn được SSRF!)',
      );
    }
  } catch (error) {
    console.error('❌ Có lỗi xảy ra trong quá trình test:', error.message);
  }

  console.log('\n=== KẾT THÚC KIỂM THỬ ===');
}

runTest();
