// Giai đoạn System, mục 4 (nâng cấp — sửa gốc, thay vì đoán từ text bằng
// regex) — đọc field `retryable` CÓ CẤU TRÚC do chính nơi lỗi phát sinh
// quyết định, thay vì cố suy đoán từ text tự do ở đây (xa nguồn lỗi nhất).
//
// Nguồn phát ra field này:
// - Static provider (freelancer/mcp_server): `McpError.toResponse()` +
//   `withErrorHandling()` (mcp_server/src/core/errors.ts) — LUÔN trả JSON
//   `{error, retryable, code, message}`.
// - Dynamic provider (Swagger): `DynamicToolExecutorService.handleExecutionError()`
//   (executor/dynamic-tool-executor.service.ts) — cùng envelope, `retryable`
//   suy từ `ToolExecutionError.statusCode` THẬT của lời gọi HTTP thất bại.
//
// Tập mã HTTP coi là "tạm thời" PHẢI khớp với `RETRYABLE_HTTP_STATUS_CODES`
// bên mcp_server/src/core/errors.ts — 2 nơi độc lập, không tự động đồng bộ.
export const RETRYABLE_HTTP_STATUS_CODES = new Set([429, 502, 503, 504]);

export type ToolErrorClass = 'retryable' | 'permanent';

interface ParsedToolError {
  retryable?: boolean;
}

// Không parse được JSON (tool cũ chưa theo format này, hoặc lỗi transport
// dạng text tự do như exception message của McpClientService) → mặc định
// 'permanent', AN TOÀN hơn tự suy đoán nhầm.
export function classifyToolError(resultPreview: string): ToolErrorClass {
  try {
    const parsed: unknown = JSON.parse(resultPreview);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      (parsed as ParsedToolError).retryable === true
    ) {
      return 'retryable';
    }
    return 'permanent';
  } catch {
    return 'permanent';
  }
}
