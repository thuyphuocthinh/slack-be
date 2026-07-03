import { RpcException } from '@nestjs/microservices';

// Trả nguyên văn message gốc của lỗi (RpcException nội bộ, SDK provider, MCP
// client...) để hiện thẳng cho user — không paraphrase/generic hoá, debug
// được ngay từ chat thay vì phải vào log server.
export function describeExternalServiceError(error: unknown): string {
  if (error instanceof RpcException) {
    const info = error.getError() as { code?: string; message?: string };
    return `⚠️ Lỗi hệ thống (${info?.code ?? 'UNKNOWN'}): ${info?.message ?? error.message}`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return `⚠️ Lỗi: ${message}`;
}
