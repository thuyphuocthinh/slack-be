/**
 * Lớp trừu tượng chung cho mọi nhà cung cấp LLM (Gemini/OpenAI/Anthropic...)
 * — Strategy Pattern. `ReactLoopService`/`SupervisorService` chỉ biết tới
 * interface này, không import trực tiếp SDK của bất kỳ provider nào — đổi/
 * thêm provider mới không đụng vào logic ReAct loop hay Supervisor.
 */

export interface LlmToolDeclaration {
  name: string;
  description?: string;
  /** JSON Schema chuẩn (draft-07 subset) — mỗi strategy tự convert sang format riêng của SDK mình. */
  parameters: Record<string, unknown>;
}

export interface LlmToolCall {
  name: string;
  args: Record<string, unknown>;
  /**
   * ID tool-call — Gemini không cần (khớp theo tên), nhưng OpenAI/Anthropic
   * bắt buộc phải echo đúng ID này lại trong tool result thì mới khớp đúng
   * turn (tin nhắn stateless, không tự nhớ theo tên như Gemini ChatSession).
   */
  id?: string;
}

export interface LlmToolResult {
  name: string;
  /** Kết quả tool dạng text (đã extract từ MCP CallToolResult ở tầng gọi). */
  content: string;
  /** Phải khớp đúng `LlmToolCall.id` tương ứng — xem ghi chú ở LlmToolCall.id. */
  id?: string;
}

export interface LlmTurnResult {
  text: string;
  toolCalls: LlmToolCall[];
}

export interface LlmHistoryTurn {
  role: 'user' | 'model';
  text: string;
}

export interface LlmChatOptions {
  model: string;
  systemInstruction: string;
  tools: LlmToolDeclaration[];
  history: LlmHistoryTurn[];
  /** Thấp (VD 0.2) để ưu tiên tool-call chính xác/nhất quán hơn sáng tạo — xem ReactLoopService. */
  temperature?: number;
}

/**
 * 1 phiên chat có state (giữ history/tool-call nội bộ theo đúng SDK gốc) —
 * `ReactLoopService` chỉ gọi `sendMessage` lặp lại, không tự quản history.
 */
export interface LlmChatSession {
  sendMessage(
    input: string | LlmToolResult[],
    onToken?: (chunk: string) => void
  ): Promise<LlmTurnResult>;
}

export interface LlmStructuredOptions {
  model: string;
  systemInstruction: string;
  prompt: string;
  /** JSON Schema chuẩn mô tả object kết quả mong muốn. */
  schema: Record<string, unknown>;
}

export interface LlmStrategy {
  readonly id: string;
  startChat(opts: LlmChatOptions): LlmChatSession;
  /** Sinh 1 object JSON theo đúng `schema` — dùng cho Supervisor (không cần chat/tool). */
  generateStructured<T>(opts: LlmStructuredOptions): Promise<T>;
}
