import { RpcException } from '@nestjs/microservices';
import { RelayOfflineError } from '../edge-relay/relay-offline.error';
import { RelayTimeoutError } from '../edge-relay/relay-timeout.error';

// Trả nguyên văn message gốc của lỗi (RpcException nội bộ, SDK provider, MCP
// client...) để hiện thẳng cho user — không paraphrase/generic hoá, debug
// được ngay từ chat thay vì phải vào log server. Edge MCP Server là ngoại lệ
// có chủ đích: user thật (không phải dev) sẽ đọc câu này, nên cần tiếng Việt
// rõ ràng thay vì message tiếng Anh nội bộ của error class.
export function describeExternalServiceError(error: unknown): string {
  if (error instanceof RelayOfflineError) {
    return '⚠️ Kết nối tới hệ thống on-prem (Edge MCP Server) của workspace này đang offline — thử lại sau hoặc liên hệ người quản trị để kiểm tra kết nối.';
  }
  if (error instanceof RelayTimeoutError) {
    return '⚠️ Kết nối tới hệ thống on-prem (Edge MCP Server) không phản hồi kịp thời — thử lại sau ít phút.';
  }

  if (error instanceof RpcException) {
    const info = error.getError() as { code?: string; message?: string };
    return `⚠️ Lỗi hệ thống (${info?.code ?? 'UNKNOWN'}): ${info?.message ?? error.message}`;
  }

  const message = error instanceof Error ? error.message : String(error);
  return `⚠️ Lỗi: ${message}`;
}
