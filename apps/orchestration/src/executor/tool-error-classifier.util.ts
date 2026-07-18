// Giai đoạn System, mục 4 (nâng cấp) — phân loại lỗi tool THEO MÃ HTTP status
// (nếu tìm thấy trong text) để quyết định có đáng tự thử lại hay không, thay
// vì coi MỌI lỗi ứng dụng là cố định như trước. Chỉ 429 (rate limit)/502/503/504
// (server tạm quá tải/gateway lỗi) được coi là "retryable" — đây là tập mã
// kinh điển cho lỗi TẠM THỜI, thử lại sau vài trăm ms có cơ hội thành công.
// Mọi trường hợp khác — kể cả 500 chung chung, hay không tìm thấy mã nào cả
// (lỗi semantic dạng `Error [CODE]: message` từ static provider tự viết, VD
// AuthenticationError/ValidationError/NotFoundError — luôn CỐ ĐỊNH, thử lại
// vô ích) — mặc định 'permanent', AN TOÀN hơn là tự suy đoán nhầm thành retryable.
const RETRYABLE_HTTP_STATUS_CODES = new Set([429, 502, 503, 504]);

export type ToolErrorClass = 'retryable' | 'permanent';

export function classifyToolError(resultPreview: string): ToolErrorClass {
  const match = resultPreview.match(/"(?:status)?code"\s*:\s*(\d{3})\b/i);
  if (!match) return 'permanent';

  const statusCode = Number(match[1]);
  return RETRYABLE_HTTP_STATUS_CODES.has(statusCode) ? 'retryable' : 'permanent';
}
