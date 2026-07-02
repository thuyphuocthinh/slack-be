import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  BaseProcessor,
  EJobName,
  EQueueName,
  IProcessAiTriggerJobData,
} from '@slack/queue';
import { MessageClientService } from '../message-client.service';
import { GeminiReactService } from '../llm/gemini-react.service';
import { McpAuthClientService } from '../mcp-auth/mcp-auth-client.service';

const SQL_SERVER_PROVIDER = 'sql_server';

@Processor(EQueueName.AI_ORCHESTRATION_QUEUE, { concurrency: 5 })
export class AiOrchestrationProcessor extends BaseProcessor<
  IProcessAiTriggerJobData,
  void,
  EJobName
> {
  constructor(
    private readonly messageClient: MessageClientService,
    private readonly geminiReact: GeminiReactService,
    private readonly mcpAuthClient: McpAuthClientService,
  ) {
    super();
  }

  async process(
    job: Job<IProcessAiTriggerJobData, void, EJobName>,
  ): Promise<void> {
    switch (job.name) {
      case EJobName.PROCESS_AI_TRIGGER: {
        await this.handleAiTrigger(job.data);
        break;
      }
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
        throw new Error(`Job name ${job.name} is not supported`);
    }
  }

  private async handleAiTrigger(data: IProcessAiTriggerJobData): Promise<void> {
    const { userId, channelId, workspaceId, messageId, botUserId, channelType } = data;

    const reply = await this.messageClient.createMessage({
      channelId,
      senderId: botUserId,
      content: '🤖 Đang xử lý...',
    });

    try {
      const connected = await this.mcpAuthClient.isConnected(userId, SQL_SERVER_PROVIDER);

      if (!connected) {
        await this.messageClient.updateMessage({
          id: reply.id,
          userId: botUserId,
          content: 'Bạn chưa kết nối SQL Server. Vào Settings để kết nối trước khi hỏi mình nhé.',
        });
        return;
      }

      const prompt = await this.messageClient.getMessageText({ id: messageId, userId });

      const answer = await this.geminiReact.run({
        prompt,
        provider: SQL_SERVER_PROVIDER,
        userId,
        channelId,
        workspaceId,
        // dùng messageId của message BOT vừa tạo (reply.id) — đây là message
        // FE cần cập nhật "đang chạy step..." lên, không phải message gốc user hỏi
        messageId: reply.id,
        // messageId gốc — dùng làm cursor lấy lịch sử chat TRƯỚC câu hỏi này
        triggerMessageId: messageId,
        channelType,
      });

      await this.messageClient.updateMessage({
        id: reply.id,
        userId: botUserId,
        content: answer,
      });
    } catch (error) {
      this.logger.error(`AI orchestration failed for message ${messageId}: ${error.message}`, error.stack);
      await this.messageClient.updateMessage({
        id: reply.id,
        userId: botUserId,
        content: '⚠️ Xin lỗi, mình gặp lỗi khi xử lý câu hỏi này. Vui lòng thử lại sau.',
      });
    }
  }
}
