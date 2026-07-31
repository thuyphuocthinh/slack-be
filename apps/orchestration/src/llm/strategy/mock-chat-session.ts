import {
  LlmChatSession,
  LlmToolDeclaration,
  LlmToolResult,
  LlmTurnResult,
} from './llm-strategy.interface';

export class MockChatSession implements LlmChatSession {
  private step = 0;

  constructor(private readonly availableTools: LlmToolDeclaration[]) {}

  async sendMessage(
    input: string | LlmToolResult[],
    onToken?: (chunk: string) => void,
  ): Promise<LlmTurnResult> {
    await new Promise((resolve) => setTimeout(resolve, 500));
    this.step++;

    // Gọi ĐÚNG 1 tool THẬT đang có sẵn của agent này (không đoán tên) — tool
    // có thể trả lỗi (VD thiếu tham số bắt buộc), không sao, ReactLoopService
    // đã tự xử lý lỗi tool bình thường, vẫn đo được round-trip thật.
    if (this.step === 1 && this.availableTools.length > 0) {
      return {
        text: '',
        toolCalls: [
          { id: 'mock-1', name: this.availableTools[0].name, args: {} },
        ],
      };
    }

    const finalAnswer =
      'Đã hoàn tất load test bằng Mock LLM! Hệ thống hoạt động siêu mượt.';

    if (onToken) {
      const parts = finalAnswer.split(' ');
      for (const p of parts) {
        onToken(p + ' ');
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    }

    return {
      text: finalAnswer,
      toolCalls: [],
    };
  }
}
