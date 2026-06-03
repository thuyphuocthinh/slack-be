import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { IAiChatRequest, IAiChatResponse } from './types/ai.type';
import { Observable } from 'rxjs';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private genAI: GoogleGenerativeAI;
  private model: any;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY is not defined in environment variables');
    } else {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ 
        model: 'gemini-1.5-flash',
      });
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
          const history = [
            { role: 'user', parts: [{ text: 'SYSTEM INSTRUCTION (Do not reply to this message directly, just follow the rules): Bạn là một trợ lý ảo của Slack tên là AI Assistant. Hãy trả lời thân thiện, ngắn gọn và hữu ích.' }] },
            { role: 'model', parts: [{ text: 'Vâng, tôi đã hiểu. Tôi là AI Assistant của Slack.' }] },
            ...payload.messages.slice(0, -1).map(m => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            }))
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
