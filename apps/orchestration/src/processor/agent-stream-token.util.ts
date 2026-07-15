import { AgentStreamService } from '../socket/agent-stream.service';

// Dùng chung cho mọi lệnh gọi LLM cần stream ra đúng messageId của bot reply
// (synthesize() ở nhánh respond multi-agent, ở fallback hết MAX_SUPERVISOR_ROUNDS,
// và ở approveCheckpoint) — đảm bảo nội dung stream ra và nội dung lưu DB luôn
// đến từ CÙNG 1 lời gọi (nguyên tắc "stream = save"). `accumulator` (nếu có)
// được cộng dồn theo từng chunk — dùng làm nội dung lưu nếu bị Stop giữa
// chừng (synthesize() không có preamble bị bỏ như ReactLoop nên không cần
// resync, chỉ cần cộng dồn thẳng).
export function buildOnToken(
  agentStream: AgentStreamService,
  userId: string,
  channelId: string,
  messageId: string,
  channelType: string,
  accumulator?: { text: string },
): (chunk: string) => void {
  return (chunk: string) => {
    if (accumulator) accumulator.text += chunk;
    agentStream
      .emitStep(
        { userId, channelId, messageId, channelType },
        { type: 'token', text: chunk },
      )
      .catch(() => {});
  };
}
