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
