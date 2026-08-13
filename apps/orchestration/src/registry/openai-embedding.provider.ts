import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { EmbeddingProvider } from '../common/agentic-openapi-parser';

/**
 * Bring-your-own EmbeddingProvider for agentic-openapi-parser's SemanticToolIndex — calls OpenAI's
 * embeddings endpoint directly (NOT through the 9Router baseURL used by openai.strategy.ts/
 * anthropic.strategy.ts for chat completions; embeddings is a distinct, simpler API surface with
 * no confirmed 9Router support).
 *
 * Dùng biến môi trường RIÊNG `OPENAI_EMBEDDING_API_KEY`, KHÔNG dùng chung
 * `OPENAI_API_KEY` — biến đó đang giữ key 9Router (bearer token gọi qua
 * AI_ROUTER_URL cho chat completion, xem openai.strategy.ts), 1 giá trị
 * không thể vừa là key 9Router vừa là key OpenAI thật cùng lúc (xác nhận
 * bằng thực nghiệm — accuracy_problem.md mục 2).
 */
// Export để nơi khác (VD ước lượng chi phí) dùng đúng 1 nguồn, không lặp lại
// chuỗi model ở 2 chỗ dễ lệch khi đổi model.
export const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(OpenAiEmbeddingProvider.name);
  private readonly client?: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_EMBEDDING_API_KEY;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    } else {
      this.logger.warn(
        'OPENAI_EMBEDDING_API_KEY is not defined in environment variables — semantic tool search is unavailable.',
      );
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.client) {
      throw new Error(
        'OpenAiEmbeddingProvider: OPENAI_EMBEDDING_API_KEY is not configured.',
      );
    }

    const response = await this.client.embeddings.create({
      model: OPENAI_EMBEDDING_MODEL,
      input: texts,
    });

    return response.data.map((d) => d.embedding);
  }
}
