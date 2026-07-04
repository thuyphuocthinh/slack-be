import { ChatHistoryTurnDto } from './message-client.dto';

export class RunReactLoopRequestDto {
  prompt: string;
  provider: string;
  userId: string;
  channelId: string;
  workspaceId: string;
  // messageId của message BOT (reply) — dùng để stream step lên đúng bubble
  messageId: string;
  channelType: string; // 'direct' | 'group'
  // Lịch sử hội thoại — AiOrchestrationProcessor fetch 1 LẦN/turn rồi truyền
  // xuống cho cả SupervisorService.decide() lẫn đây, đảm bảo cả 2 nhìn thấy
  // đúng CÙNG 1 snapshot lịch sử (không tự fetch riêng, tránh lệch nhau).
  history: ChatHistoryTurnDto[];
  // Model id trong LLM_MODEL_REGISTRY (VD 'gemini-2.0-flash', 'gpt-4o-mini',
  // 'claude-haiku') — optional, chưa có UI cho user chọn nên mặc định lấy
  // ORCHESTRATION_CONSTANTS.DEFAULT_REACT_MODEL nếu không truyền. Field đã
  // sẵn để cắm UI chọn model sau này mà không cần sửa ReactLoopService.
  model?: string;
}

export class ToolCallTraceDto {
  tool: string;
  // 'awaiting_approval' (Giai đoạn 3, HITL) — tool bị Risk Gate chặn, đang chờ
  // user bấm Duyệt/Từ chối, KHÁC với 'error' (đã thử chạy và thất bại thật).
  status: 'success' | 'error' | 'awaiting_approval';
  // Xem trước ngắn gọn kết quả tool trả về (rút gọn 1 dòng) — hiện dưới mỗi
  // bước trong timeline FE, giống Claude Code hiện "⎿ output" dưới tool call.
  resultPreview?: string;
}

export class RunReactLoopResponseDto {
  answer: string;
  toolCalls: ToolCallTraceDto[];
}
