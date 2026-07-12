import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { EmbeddingProvider } from '../common/agentic-openapi-parser';

/**
 * Bring-your-own EmbeddingProvider for agentic-openapi-parser's SemanticToolIndex — calls OpenAI's
 * embeddings endpoint directly (NOT through the 9Router baseURL used by openai.strategy.ts/
 * anthropic.strategy.ts for chat completions; embeddings is a distinct, simpler API surface with
 * no confirmed 9Router support).
 */
@Injectable()
export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  private readonly logger = new Logger(OpenAiEmbeddingProvider.name);
  private readonly client?: OpenAI;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      this.client = new OpenAI({ apiKey });
    } else {
      this.logger.warn(
        'OPENAI_API_KEY is not defined in environment variables — semantic tool search is unavailable.',
      );
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.client) {
      throw new Error(
        'OpenAiEmbeddingProvider: OPENAI_API_KEY is not configured.',
      );
    }

    const response = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });

    return response.data.map((d) => d.embedding);
  }
}
