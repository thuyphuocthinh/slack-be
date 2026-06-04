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
      // gemini-embedding-2 is a valid alias that returns 3072 dimensions
      this.embeddingModel = this.genAI.getGenerativeModel({ model: 'gemini-embedding-2' });
    }
  }

  /**
   * Helper method to slice and normalize Matryoshka vectors
   */
  private normalizeVector(vector: number[], dimensions: number): number[] {
    const sliced = vector.slice(0, dimensions);
    const magnitude = Math.sqrt(sliced.reduce((sum, val) => sum + val * val, 0));
    return magnitude === 0 ? sliced : sliced.map((val) => val / magnitude);
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

    return this.normalizeVector(result.embedding.values, 768);
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

    return this.normalizeVector(result.embedding.values, 768);
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

    return result.embeddings.map((e) => this.normalizeVector(e.values, 768));
  }
}
