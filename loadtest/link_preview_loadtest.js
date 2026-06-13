// loadtest/link_preview_loadtest.js
// Script kiểm thử tải (Load Test) tính năng Link Preview qua API Gateway
// Chạy bằng lệnh: node loadtest/link_preview_loadtest.js

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
  console.log(`[Auth] Đang tự động đăng nhập để lấy Token mới qua: POST ${BASE_URL}/api/v1/auth/login`);
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
    console.log(`-> Không đăng nhập được tự động (HTTP ${res.status}). Sử dụng token cứng làm dự phòng.`);
  } catch (err) {
    console.log(`-> Lỗi kết nối đăng nhập: ${err.message}. Sử dụng token cứng làm dự phòng.`);
  }
}

async function postMessage(content) {
  const startTime = Date.now();
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
    throw new Error(`Failed to post message: ${response.statusText} (${response.status})`);
  }

  const duration = Date.now() - startTime;
  const json = await response.json();
  const msg = json.data || json;
  return { id: msg.id, postDuration: duration };
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
    throw new Error(`Failed to get message: ${response.statusText} (${response.status})`);
  }

  const json = await response.json();
  return json.data || json;
}

// Hàm polling đợi Link Preview
async function pollForPreview(messageId, maxAttempts = 30, interval = 500) {
  const startTime = Date.now();
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const msg = await getMessage(messageId);
      if (msg.linkPreviews && msg.linkPreviews.length > 0) {
        return {
          success: true,
          previewDuration: Date.now() - startTime,
          previews: msg.linkPreviews,
        };
      }
    } catch (e) {
      // Bỏ qua lỗi kết nối tạm thời khi polling
    }
    await delay(interval);
  }
  return {
    success: false,
    previewDuration: Date.now() - startTime,
    previews: null,
  };
}

async function runScenario({ name, concurrency, delayBetweenMs = 150, getUrlFunc }) {
  console.log(`\n==================================================`);
  console.log(`BẮT ĐẦU KỊCH BẢN: ${name}`);
  console.log(`Số lượng request gửi (Concurrency): ${concurrency}`);
  console.log(`Độ trễ giãn cách giữa các request: ${delayBetweenMs} ms`);
  console.log(`==================================================`);

  const startTime = Date.now();
  const tasks = [];

  // Tạo và gửi đồng thời (staggered slightly to avoid 429)
  for (let i = 0; i < concurrency; i++) {
    const url = getUrlFunc(i);
    const content = `Kiểm thử chịu tải Link Preview ${i + 1}: ${url}`;
    
    if (delayBetweenMs > 0 && i > 0) {
      await delay(delayBetweenMs);
    }
    
    tasks.push((async () => {
      let messageId = null;
      let postDuration = 0;
      let error = null;

      try {
        const postResult = await postMessage(content);
        messageId = postResult.id;
        postDuration = postResult.postDuration;
      } catch (err) {
        error = `Post failed: ${err.message}`;
      }

      if (error) {
        return { index: i, success: false, postDuration, previewDuration: 0, error };
      }

      // Polling đợi preview được update
      const pollResult = await pollForPreview(messageId);
      return {
        index: i,
        success: pollResult.success,
        postDuration,
        previewDuration: pollResult.previewDuration,
        error: pollResult.success ? null : 'Timeout waiting for preview',
      };
    })());
  }

  console.log(`-> Đang gửi dần ${concurrency} tin nhắn lên hệ thống...`);
  const results = await Promise.all(tasks);
  const totalDuration = Date.now() - startTime;

  // Phân tích kết quả
  const total = results.length;
  const successfulPosts = results.filter(r => r.postDuration > 0).length;
  const successfulPreviews = results.filter(r => r.success).length;
  const failedPreviews = total - successfulPreviews;

  const postDurations = results.filter(r => r.postDuration > 0).map(r => r.postDuration);
  const previewDurations = results.filter(r => r.success).map(r => r.previewDuration);

  const avgPost = postDurations.length ? (postDurations.reduce((a, b) => a + b, 0) / postDurations.length).toFixed(1) : 0;
  const avgPreview = previewDurations.length ? (previewDurations.reduce((a, b) => a + b, 0) / previewDurations.length).toFixed(1) : 0;

  const maxPost = postDurations.length ? Math.max(...postDurations) : 0;
  const minPost = postDurations.length ? Math.min(...postDurations) : 0;
  
  const maxPreview = previewDurations.length ? Math.max(...previewDurations) : 0;
  const minPreview = previewDurations.length ? Math.min(...previewDurations) : 0;

  console.log(`\n--- BÁO CÁO THỐNG KÊ KỊCH BẢN: ${name} ---`);
  console.log(`⏱ Tổng thời gian chạy kịch bản: ${(totalDuration / 1000).toFixed(2)} giây`);
  console.log(`📬 Số tin nhắn gửi thành công: ${successfulPosts}/${total} (${((successfulPosts/total)*100).toFixed(1)}%)`);
  console.log(`✨ Số tin nhắn được hiển thị preview: ${successfulPreviews}/${total} (${((successfulPreviews/total)*100).toFixed(1)}%)`);
  console.log(`❌ Số tin nhắn thất bại/timeout preview: ${failedPreviews}/${total}`);
  
  console.log(`\n⚡️ Độ trễ gửi tin nhắn (API Gateway Response Time):`);
  console.log(`   - Trung bình: ${avgPost} ms`);
  console.log(`   - Thấp nhất: ${minPost} ms`);
  console.log(`   - Cao nhất:  ${maxPost} ms`);

  console.log(`\n⚙️ Thời gian xử lý Link Preview (Từ lúc post đến lúc DB có data):`);
  console.log(`   - Trung bình: ${avgPreview} ms`);
  console.log(`   - Thấp nhất: ${minPreview} ms`);
  console.log(`   - Cao nhất:  ${maxPreview} ms`);

  if (failedPreviews > 0) {
    console.log(`\n⚠️ Các lỗi gặp phải trong kịch bản:`);
    const errors = [...new Set(results.filter(r => r.error).map(r => r.error))];
    errors.forEach(err => console.log(`   - ${err}`));
  }
}

async function runLoadTest() {
  console.log('==================================================');
  console.log('=== KHỞI ĐỘNG HỆ THỐNG KIỂM THỬ CHỊU TẢI (LOAD TEST) ===');
  console.log('==================================================');

  await authenticate();

  // KỊCH BẢN 1: Cache HIT đồng thời (Concurrency: 40)
  // Gửi 40 request chứa cùng một URL.
  // URL này đã được cào trước để chắc chắn nằm trong Cache.
  const hitUrl = `https://github.com/?t=loadtest-hit-${Date.now()}`;
  
  console.log('\n[Chuẩn bị] Gửi tin nhắn mồi để đưa URL vào Cache...');
  try {
    const seedResult = await postMessage(`Link mồi: ${hitUrl}`);
    console.log(`-> Đã tạo tin nhắn mồi (ID: ${seedResult.id}). Đợi cào...`);
    const seedPoll = await pollForPreview(seedResult.id);
    if (seedPoll.success) {
      console.log('-> URL đã được cào và lưu vào Cache thành công!');
    } else {
      console.warn('-> Cào mồi thất bại hoặc timeout. Tiến hành chạy test chịu tải trực tiếp.');
    }
  } catch (err) {
    console.error(`-> Lỗi chuẩn bị mồi: ${err.message}`);
  }

  // Chạy kịch bản 1: Cache Hit đồng thời
  await runScenario({
    name: 'CACHE HIT ĐỒNG THỜI (CONCURRENT CACHE HITS)',
    concurrency: 6,
    delayBetweenMs: 1200,
    getUrlFunc: () => hitUrl,
  });

  console.log('\n[Đợi] Nghỉ 15 giây để hồi lại Rate Limit bucket...');
  await delay(15000);

  // KỊCH BẢN 2: Cache MISS đồng thời (Concurrency: 15)
  // Gửi 15 request với 15 URL khác nhau.
  // Điều này buộc hệ thống phải cào đồng thời qua Cloudflare Worker.
  const baseTime = Date.now();
  await runScenario({
    name: 'CACHE MISS ĐỒNG THỜI (CONCURRENT CACHE MISSES)',
    concurrency: 5,
    delayBetweenMs: 1200,
    getUrlFunc: (i) => `https://github.com/?t=loadtest-miss-${baseTime}-${i}`,
  });

  console.log('\n==================================================');
  console.log('=== KẾT THÚC HỆ THỐNG KIỂM THỬ CHỊU TẢI ===');
  console.log('==================================================');
}

runLoadTest().catch(console.error);
