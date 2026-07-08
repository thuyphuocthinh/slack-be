export class McpToolAnnotationsDto {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

export class McpToolDto {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  // Chuẩn MCP ToolAnnotations — dùng để Risk Gate (Giai đoạn 3) nhận diện tool
  // rủi ro (destructiveHint) trước khi cho ReactLoop gọi thật.
  annotations?: McpToolAnnotationsDto;
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
  // MCP spec: tool báo lỗi qua field này, KHÔNG throw exception lên transport
  // (xem withErrorHandling bên mcp_server) — phải đọc field này để biết tool
  // thật sự thành công hay lỗi.
  isError?: boolean;
}

export class McpResourceDto {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export class McpPromptDto {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}
