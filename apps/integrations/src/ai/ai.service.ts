import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { IAiChatRequest, IAiChatResponse } from './types/ai.type';
import { Observable } from 'rxjs';
import { DocumentService } from './document.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private genAI: GoogleGenerativeAI;
  private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

  constructor(private readonly documentService: DocumentService) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY is not defined in environment variables');
    } else {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    }
  }

  generateResponse(payload: IAiChatRequest): Observable<IAiChatResponse> {
    return new Observable((subscriber) => {
      (async () => {
        if (!this.model) {
          subscriber.error(new Error('AI Model is not initialized. Check GEMINI_API_KEY.'));
          return;
        }

        try {
          // --- RAG Context Injection ---
          let ragContext = '';
          if (payload.workspaceId) {
            const lastUserMessage = payload.messages[payload.messages.length - 1]?.content || '';
            try {
              const relevantChunks = await this.documentService.searchRelevantChunks(
                lastUserMessage,
                payload.workspaceId,
                5,
              );
              if (relevantChunks.length > 0) {
                ragContext = relevantChunks
                  .map((c, i) => `[Tài liệu: ${c.documentName}]\n${c.content}`)
                  .join('\n---\n');
                this.logger.log(`Found ${relevantChunks.length} relevant chunks for RAG`);
              }
            } catch (ragError) {
              // RAG failure should not block chat — fallback to Level 2
              this.logger.warn(`RAG search failed, falling back to normal chat: ${ragError.message}`);
            }
          }

          // --- Build history ---
          const systemParts: { role: string; parts: { text: string }[] }[] = [];

          // Base system instruction
          systemParts.push(
            {
              role: 'user',
              parts: [{ text: 'SYSTEM INSTRUCTION (Do not reply to this message directly, just follow the rules): Bạn là một trợ lý ảo của Slack tên là AI Assistant. Hãy trả lời thân thiện, ngắn gọn và hữu ích.' }],
            },
            {
              role: 'model',
              parts: [{ text: 'Vâng, tôi đã hiểu. Tôi là AI Assistant của Slack.' }],
            },
          );

          // Inject RAG context if available
          if (ragContext) {
            systemParts.push(
              {
                role: 'user',
                parts: [{ text: `TÀI LIỆU NỘI BỘ THAM KHẢO (sử dụng thông tin này để trả lời câu hỏi, nếu không tìm thấy thông tin phù hợp thì hãy nói rõ):\n---\n${ragContext}\n---` }],
              },
              {
                role: 'model',
                parts: [{ text: 'Tôi đã đọc và ghi nhớ tài liệu nội bộ. Tôi sẽ ưu tiên trả lời dựa trên tài liệu này.' }],
              },
            );
          }

          const history = [
            ...systemParts,
            ...payload.messages.slice(0, -1).map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
          ];

          const currentMessage = payload.messages[payload.messages.length - 1]?.content || '';
          this.logger.log(`Generating response for message: ${currentMessage.substring(0, 50)}...`);

          const chatSession = this.model.startChat({ history });
          const result = await chatSession.sendMessageStream(currentMessage);

          for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            subscriber.next({ text: chunkText });
          }
          subscriber.complete();
        } catch (error) {
          this.logger.error(`Error generating AI response: ${error.message}`);
          subscriber.error(error);
        }
      })();
    });
  }
}
