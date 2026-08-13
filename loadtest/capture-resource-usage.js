/**
 * Ghi lại CPU/RAM mỗi vài giây trong lúc chạy k6, để đối chiếu với RPS/latency
 * — phần CÒN THIẾU ở lần load test trước (chỉ đo được góc nhìn CLIENT qua k6,
 * không có gì đối chiếu phía SERVER).
 *
 * Ghi CẢ 2 nguồn (chạy song song, không phụ thuộc nhau — 1 nguồn lỗi không
 * chặn nguồn kia):
 *   (a) `docker stats` — CHỈ thấy Postgres/Redis/BullMQ (container thật, xem
 *       docker-compose.dev.yml). KHÔNG thấy CPU/RAM của chính app orchestration/
 *       message/api-gateway/socket-gateway — các app này chạy `pnpm start:dev`
 *       TRỰC TIẾP trên máy (KHÔNG dockerize), "docker stats" không nhìn thấy.
 *   (b) `Get-Process -Name node` (PowerShell, Windows) — thấy TẤT CẢ tiến
 *       trình Node đang chạy (bao gồm các app trên) nhưng KHÔNG phân biệt
 *       được PID nào là app nào chỉ từ tên — bạn cần tự đối chiếu Id với
 *       terminal đang chạy app đó (VD qua Task Manager) nếu cần tách riêng.
 *       Cột "CPU" của Get-Process là TỔNG giây CPU cộng dồn từ lúc tiến trình
 *       khởi động (không phải %) — muốn ra %, tự lấy HIỆU giữa 2 dòng liên
 *       tiếp của CÙNG 1 Id rồi chia cho khoảng cách thời gian giữa 2 dòng.
 *
 * Chạy SONG SONG với k6 (mở 2 terminal riêng), Ctrl+C để dừng khi k6 xong:
 *   node loadtest/capture-resource-usage.js
 *
 * Output: loadtest/resource-usage.csv (append — xoá file cũ nếu muốn bắt đầu
 * lại từ đầu).
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const INTERVAL_MS = 3000;
const OUTPUT_FILE = path.join(__dirname, 'resource-usage.csv');

function appendRow(row) {
  fs.appendFileSync(OUTPUT_FILE, row + '\n');
}

function captureDockerStats(ts) {
  exec(
    'docker stats --no-stream --format "{{.Name}},{{.CPUPerc}},{{.MemUsage}}"',
    (err, stdout) => {
      if (err) {
        console.error('docker stats lỗi:', err.message);
        return;
      }
      stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .forEach((line) => appendRow(`${ts},docker,${line}`));
    },
  );
}

function captureNodeProcesses(ts) {
  const cmd =
    'powershell -NoProfile -Command "Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object { \\"$($_.Id),$($_.CPU),$($_.WorkingSet64)\\" }"';
  exec(cmd, (err, stdout) => {
    if (err) {
      console.error('Get-Process lỗi:', err.message);
      return;
    }
    stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .forEach((line) => appendRow(`${ts},node,${line.trim()}`));
  });
}

if (!fs.existsSync(OUTPUT_FILE)) {
  appendRow('timestamp,source,col1,col2,col3');
}

console.log(
  `Đang ghi resource usage mỗi ${INTERVAL_MS}ms vào ${OUTPUT_FILE} — Ctrl+C để dừng.`,
);

function tick() {
  const ts = new Date().toISOString();
  captureDockerStats(ts);
  captureNodeProcesses(ts);
}

tick();
setInterval(tick, INTERVAL_MS);
