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
