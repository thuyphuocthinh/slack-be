import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private genAI: GoogleGenerativeAI;
  private embeddingModel: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      this.logger.warn('GEMINI_API_KEY is not defined — embedding disabled');
    } else {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.embeddingModel = this.genAI.getGenerativeModel({ model: 'embedding-001' });
    }
  }

  /**
   * Embed a single text string into a 768-dimension vector
   */
  async embedText(text: string): Promise<number[]> {
    if (!this.embeddingModel) {
      throw new Error('Embedding model not initialized. Check GEMINI_API_KEY.');
    }

    const result = await this.embeddingModel.embedContent({
      content: { role: 'user', parts: [{ text }] },
      taskType: TaskType.RETRIEVAL_DOCUMENT,
    });

    return result.embedding.values;
  }

  /**
   * Embed a query text (uses RETRIEVAL_QUERY task type for better search accuracy)
   */
  async embedQuery(text: string): Promise<number[]> {
    if (!this.embeddingModel) {
      throw new Error('Embedding model not initialized. Check GEMINI_API_KEY.');
    }

    const result = await this.embeddingModel.embedContent({
      content: { role: 'user', parts: [{ text }] },
      taskType: TaskType.RETRIEVAL_QUERY,
    });

    return result.embedding.values;
  }

  /**
   * Batch embed multiple texts (documents)
   */
  async embedTexts(texts: string[]): Promise<number[][]> {
    if (!this.embeddingModel) {
      throw new Error('Embedding model not initialized. Check GEMINI_API_KEY.');
    }

    const result = await this.embeddingModel.batchEmbedContents({
      requests: texts.map((text) => ({
        content: { role: 'user', parts: [{ text }] },
        taskType: TaskType.RETRIEVAL_DOCUMENT,
      })),
    });

    return result.embeddings.map((e) => e.values);
  }
}
