// Bug thật đã sửa: "Stop" giữa turn trước đây CHỈ huỷ được lúc LLM đang stream
// (runCancellable() poll + AbortSignal truyền vào SDK) — lúc đang chạy TOOL
// CALL (SQL query, gọi API dynamic provider...) hoặc đang NGỦ giữa 2 lần retry
// thì signal bị bỏ qua hoàn toàn, khiến Stop "treo" tới khi tool/backoff tự
// xong (có thể tới MCP_CALL_TIMEOUT_MS=15s + nhiều lần retry). Dùng hàm này
// thay cho `setTimeout` trần ở MỌI chỗ có backoff/delay nằm trên đường đi của
// 1 turn có thể bị Stop, để việc "ngủ chờ" cũng huỷ được ngay lập tức.
export function abortableSleep(
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('Aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
