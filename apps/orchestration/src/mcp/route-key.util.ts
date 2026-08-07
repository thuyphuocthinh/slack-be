import { AGENT_REGISTRY } from '../registry/agents.registry';

// Key dùng cho cache/breaker/limiter trong McpClientService. Provider CHUNG 1
// instance cho mọi workspace (Notion/GitHub/...) giữ key = provider, KHÔNG đổi
// hành vi hiện có — tách theo workspace chỉ làm loãng ngưỡng circuit breaker
// vô ích vì chúng thật sự chia sẻ 1 failure domain. Chỉ provider có
// `perWorkspaceInstance: true` (VD Edge MCP Server relay) mới tách theo
// workspaceId, để 1 workspace lỗi không ảnh hưởng workspace khác dùng cùng
// provider name.
export function routeKey(provider: string, workspaceId?: string): string {
  if (AGENT_REGISTRY[provider]?.perWorkspaceInstance && workspaceId) {
    return `${provider}:${workspaceId}`;
  }
  return provider;
}

// Key cho MCP Client CONNECTION cache (McpClientService.clients). Provider
// perWorkspaceInstance chỉ có 1 socket vật lý cho cả workspace — nếu vẫn tách
// thêm theo ownerId, 2 user cùng workspace sẽ có 2 Client/session riêng dùng
// chung 1 socket, mỗi session tự đếm request id từ đầu, dễ trùng id và trả
// nhầm kết quả cho nhau (xem RelayOutboundTransport.pendingAcks — theo dõi
// THEO ID, không theo session). Provider dùng chung 1 instance cho mọi
// workspace vẫn tách theo ownerId như cũ (owner khác nhau có thể có
// credential/connectionConfig khác nhau qua mcp_auth).
export function clientCacheKey(
  provider: string,
  ownerId: string | undefined,
  workspaceId?: string,
): string {
  const base = routeKey(provider, workspaceId);
  if (AGENT_REGISTRY[provider]?.perWorkspaceInstance) return base;
  return `${base}:${ownerId ?? '__anon__'}`;
}
