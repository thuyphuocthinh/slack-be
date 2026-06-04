import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiDocumentChunkEntity } from './entities/ai-document-chunk.entity';
import { EmbeddingService } from './embedding.service';

interface ChunkSearchResult {
  content: string;
  documentName: string;
  chunkIndex: number;
  score: number;
}

interface IndexDocumentResult {
  documentName: string;
  chunksCount: number;
}

interface DocumentSummary {
  documentName: string;
  chunksCount: number;
  createdAt: Date;
}

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @InjectRepository(AiDocumentChunkEntity)
    private readonly chunkRepo: Repository<AiDocumentChunkEntity>,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * Parse text content from a file buffer
   * Supports: .txt, .md
   */
  private parseText(fileBuffer: Buffer, fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();

    if (ext === 'txt' || ext === 'md') {
      return fileBuffer.toString('utf-8');
    }

    throw new Error(`Unsupported file type: .${ext}. Only .txt and .md are supported.`);
  }

  /**
   * Split text into chunks of approximately targetTokens size with overlap
   */
  private chunkText(text: string, targetTokens = 500, overlapTokens = 50): string[] {
    // Rough estimate: 1 token ≈ 4 characters for mixed languages
    const charsPerToken = 4;
    const targetChars = targetTokens * charsPerToken;
    const overlapChars = overlapTokens * charsPerToken;

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + targetChars;
      let isLastChunk = false;

      // Try to break at a paragraph or sentence boundary
      if (end < text.length) {
        const searchArea = text.substring(end - 200, end + 200);
        const paragraphBreak = searchArea.lastIndexOf('\n\n');
        if (paragraphBreak !== -1) {
          end = end - 200 + paragraphBreak;
        } else {
          const sentenceBreak = searchArea.lastIndexOf('. ');
          if (sentenceBreak !== -1) {
            end = end - 200 + sentenceBreak + 2;
          }
        }
      } else {
        end = text.length;
        isLastChunk = true;
      }

      const chunk = text.substring(Math.max(0, start), end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }

      if (isLastChunk) break;

      // Move start forward with overlap
      start = end - overlapChars;
    }

    return chunks;
  }

  /**
   * Index a document: parse → chunk → embed → store
   */
  async indexDocument(
    textContent: string,
    fileName: string,
    workspaceId: string,
  ): Promise<IndexDocumentResult> {
    this.logger.log(`Indexing document: ${fileName} for workspace: ${workspaceId}`);

    // 1. Validate text
    if (!textContent || !textContent.trim()) {
      throw new Error('Document is empty or contains no readable text.');
    }

    // 2. Delete existing chunks for same document in same workspace (re-index)
    await this.chunkRepo.delete({ workspaceId, documentName: fileName });

    // 3. Chunk text
    const chunks = this.chunkText(textContent);
    this.logger.log(`Split into ${chunks.length} chunks`);

    // 4. Batch embed
    const embeddings = await this.embeddingService.embedTexts(chunks);

    // 5. Bulk insert
    const entities = chunks.map((content, index) => {
      const entity = new AiDocumentChunkEntity();
      entity.workspaceId = workspaceId;
      entity.documentName = fileName;
      entity.chunkIndex = index;
      entity.content = content;
      entity.embedding = embeddings[index];
      return entity;
    });

    await this.chunkRepo.save(entities);
    this.logger.log(`Successfully indexed ${entities.length} chunks for: ${fileName}`);

    return { documentName: fileName, chunksCount: entities.length };
  }

  /**
   * Search for relevant chunks using cosine similarity via pgvector
   */
  async searchRelevantChunks(
    query: string,
    workspaceId: string,
    limit = 5,
  ): Promise<ChunkSearchResult[]> {
    // 1. Embed the query
    const queryVector = await this.embeddingService.embedQuery(query);
    const vectorStr = `[${queryVector.join(',')}]`;

    // 2. Cosine similarity search
    const results = await this.chunkRepo.query(
      `SELECT 
        content, 
        "documentName", 
        "chunkIndex",
        1 - (embedding <=> $1::vector) as score
      FROM ai_document_chunks 
      WHERE "workspaceId" = $2 
      ORDER BY embedding <=> $1::vector 
      LIMIT $3`,
      [vectorStr, workspaceId, limit],
    );

    return results.map((r: { content: string; documentName: string; chunkIndex: number; score: number }) => ({
      content: r.content,
      documentName: r.documentName,
      chunkIndex: r.chunkIndex,
      score: parseFloat(String(r.score)),
    }));
  }

  /**
   * List all documents (grouped by name) for a workspace
   */
  async listDocuments(workspaceId: string): Promise<DocumentSummary[]> {
    const results = await this.chunkRepo.query(
      `SELECT 
        "documentName", 
        COUNT(*) as "chunksCount", 
        MIN("createdAt") as "createdAt"
      FROM ai_document_chunks 
      WHERE "workspaceId" = $1 
      GROUP BY "documentName" 
      ORDER BY MIN("createdAt") DESC`,
      [workspaceId],
    );

    return results.map((r: { documentName: string; chunksCount: string; createdAt: Date }) => ({
      documentName: r.documentName,
      chunksCount: parseInt(r.chunksCount, 10),
      createdAt: r.createdAt,
    }));
  }

  /**
   * Delete all chunks for a specific document in a workspace
   */
  async deleteDocument(workspaceId: string, documentName: string): Promise<void> {
    await this.chunkRepo.delete({ workspaceId, documentName });
    this.logger.log(`Deleted document: ${documentName} from workspace: ${workspaceId}`);
  }
}
