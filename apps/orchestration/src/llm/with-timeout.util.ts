// Race 1 promise LLM call với timeout — không có cái này, 1 provider bị treo
// (network chậm, model quá tải) làm cả turn "Đang xử lý..." vô thời hạn.
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
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
