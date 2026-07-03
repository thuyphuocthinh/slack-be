export class RunReactLoopRequestDto {
  prompt: string;
  provider: string;
  userId: string;
  channelId: string;
  workspaceId: string;
  // messageId của message BOT (reply) — dùng để stream step lên đúng bubble
  messageId: string;
  // messageId gốc user vừa gửi — dùng làm cursor lấy lịch sử chat TRƯỚC nó
  triggerMessageId: string;
  channelType: string; // 'direct' | 'group'
  // Model id trong LLM_MODEL_REGISTRY (VD 'gemini-2.0-flash', 'gpt-4o-mini',
  // 'claude-haiku') — optional, chưa có UI cho user chọn nên mặc định lấy
  // ORCHESTRATION_CONSTANTS.GEMINI_MODEL nếu không truyền. Field đã sẵn để
  // cắm UI chọn model sau này mà không cần sửa ReactLoopService.
  model?: string;
}

export class ToolCallTraceDto {
  tool: string;
  status: 'success' | 'error';
  // Xem trước ngắn gọn kết quả tool trả về (rút gọn 1 dòng) — hiện dưới mỗi
  // bước trong timeline FE, giống Claude Code hiện "⎿ output" dưới tool call.
  resultPreview?: string;
}

export class RunReactLoopResponseDto {
  answer: string;
  toolCalls: ToolCallTraceDto[];
}
