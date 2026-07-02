export class McpToolDto {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export class CallToolRequestDto {
  provider: string;
  name: string;
  args: Record<string, unknown>;
  // Danh tính người gọi thật — gửi qua header nội bộ tới MCP server, KHÔNG
  // qua tool args (tránh lộ ra function-calling schema mà LLM thấy được).
  ownerId: string;
}

export class CallToolResponseDto {
  content?: Array<{ type: string; text?: string }>;
}
