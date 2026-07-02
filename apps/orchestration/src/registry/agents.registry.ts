/**
 * Khai tĩnh 1 dòng/agent — chỉ nơi agent chạy + provider tương ứng.
 * KHÔNG khai tool ở đây — tool list lấy trực tiếp qua MCP `listTools()`
 * (xem McpClientService) để luôn khớp đúng với agent thật, không phải
 * bản copy tay dễ lệch.
 */
export interface AgentRegistryEntry {
  label: string;
  endpoint: string | undefined;
}

export const AGENT_REGISTRY: Record<string, AgentRegistryEntry> = {
  sql_server: {
    label: 'SQL Server',
    endpoint: process.env.AGENT_SQL_SERVER_URL,
  },
};
