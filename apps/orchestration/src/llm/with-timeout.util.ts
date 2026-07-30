// Race 1 promise LLM call với timeout — không có cái này, 1 provider bị treo
// (network chậm, model quá tải) làm cả turn "Đang xử lý..." vô thời hạn.
// `controller` (nếu có) bị abort() khi hết giờ — PHẢI truyền signal của nó
// xuống request thật, không thì request cũ vẫn chạy ngầm sau khi đã "timeout"
// (có thể đẩy token/message trùng vào lúc lần thử lại đang chạy).
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  controller?: AbortController,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller?.abort();
      reject(new Error(message));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: any) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
