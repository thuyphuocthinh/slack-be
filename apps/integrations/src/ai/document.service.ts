import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { AiDocumentChunkEntity } from './entities/ai-document-chunk.entity';
import { AiDocumentParentEntity } from './entities/ai-document-parent.entity';
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

interface QueryResult {
  id: string;
  content: string;
  documentName: string;
  chunkIndex: number;
  parentId: string | null;
}

@Injectable()
export class DocumentService {
  private readonly logger = new Logger(DocumentService.name);

  constructor(
    @InjectRepository(AiDocumentChunkEntity)
    private readonly chunkRepo: Repository<AiDocumentChunkEntity>,
    @InjectRepository(AiDocumentParentEntity)
    private readonly parentRepo: Repository<AiDocumentParentEntity>,
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
   * Index a document: parse → chunk (2 levels) → embed → store
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

    // 2. Multimodal processing: check if the document is an image
    let actualContent = textContent;
    const lowerName = fileName.toLowerCase();
    const isImage = ['png', 'jpg', 'jpeg', 'webp'].some((ext) =>
      lowerName.endsWith(ext),
    );

    if (isImage) {
      let mimeType = 'image/png';
      if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) {
        mimeType = 'image/jpeg';
      } else if (lowerName.endsWith('.webp')) {
        mimeType = 'image/webp';
      }

      this.logger.log(`Processing image ${fileName} with Gemini multimodal...`);
      actualContent = await this.embeddingService.describeImage(
        textContent,
        mimeType,
      );
      this.logger.log(`Generated image description of length ${actualContent.length}`);
    }

    // 3. Delete existing parents (will cascade delete child chunks via foreign key constraint)
    await this.parentRepo.delete({ workspaceId, documentName: fileName });
    // Also delete any orphaned chunks
    await this.chunkRepo.delete({ workspaceId, documentName: fileName });

    // 4. Chunk text into Parent Documents (~1000 tokens / 4000 characters)
    const parentTexts = this.chunkText(actualContent, 1000, 100);
    this.logger.log(`Split document into ${parentTexts.length} parent chunks`);

    // 4. Save parent documents
    const parentEntities = parentTexts.map((content) => {
      const entity = new AiDocumentParentEntity();
      entity.workspaceId = workspaceId;
      entity.documentName = fileName;
      entity.content = content;
      return entity;
    });
    const savedParents = await this.parentRepo.save(parentEntities);

    // 5. Chunk parent texts into Child Chunks (~250 tokens / 1000 characters) and embed
    const childEntities: AiDocumentChunkEntity[] = [];

    for (const parent of savedParents) {
      const childTexts = this.chunkText(parent.content, 250, 25);
      if (childTexts.length === 0) continue;

      const embeddings = await this.embeddingService.embedTexts(childTexts);

      childTexts.forEach((content, index) => {
        const entity = new AiDocumentChunkEntity();
        entity.workspaceId = workspaceId;
        entity.documentName = fileName;
        entity.parentId = parent.id;
        entity.chunkIndex = index;
        entity.content = content;
        entity.embedding = embeddings[index];
        childEntities.push(entity);
      });
    }

    if (childEntities.length > 0) {
      await this.chunkRepo.save(childEntities);
      this.logger.log(`Successfully indexed ${childEntities.length} child chunks for: ${fileName}`);
    }

    return { documentName: fileName, chunksCount: childEntities.length };
  }

  /**
   * Search for relevant chunks using Hybrid Search (Vector + FTS) combined via RRF
   */
  async searchRelevantChunks(
    query: string,
    workspaceId: string,
    limit = 5,
  ): Promise<ChunkSearchResult[]> {
    // 1. Embed the query
    const queryVector = await this.embeddingService.embedQuery(query);
    const vectorStr = `[${queryVector.join(',')}]`;

    // 2. Run Vector and FTS searches in parallel
    const searchLimit = limit * 3;
    let ftsHits: QueryResult[] = [];

    const [vectorHits] = await Promise.all([
      this.chunkRepo.query(
        `SELECT 
          id,
          content, 
          "documentName", 
          "chunkIndex",
          "parentId"
        FROM ai_document_chunks 
        WHERE "workspaceId" = $2 
        ORDER BY embedding <=> $1::vector 
        LIMIT $3`,
        [vectorStr, workspaceId, searchLimit],
      ),
      (async () => {
        try {
          ftsHits = await this.chunkRepo.query(
            `SELECT 
              id,
              content, 
              "documentName", 
              "chunkIndex",
              "parentId"
            FROM ai_document_chunks 
            WHERE "workspaceId" = $2 
              AND to_tsvector('simple', content) @@ plainto_tsquery('simple', $1)
            ORDER BY ts_rank(to_tsvector('simple', content), plainto_tsquery('simple', $1)) DESC
            LIMIT $3`,
            [query, workspaceId, searchLimit],
          );
        } catch (err) {
          this.logger.warn(`Full-text search query failed: ${err.message}`);
        }
      })(),
    ]);

    // 3. Reciprocal Rank Fusion (RRF) Reranking
    const k = 60;
    const itemMap = new Map<string, {
      id: string;
      content: string;
      documentName: string;
      chunkIndex: number;
      parentId: string | null;
      score: number;
    }>();

    vectorHits.forEach((hit: QueryResult, index: number) => {
      itemMap.set(hit.id, {
        id: hit.id,
        content: hit.content,
        documentName: hit.documentName,
        chunkIndex: hit.chunkIndex,
        parentId: hit.parentId,
        score: 1 / (k + (index + 1)),
      });
    });

    ftsHits.forEach((hit: QueryResult, index: number) => {
      const existing = itemMap.get(hit.id);
      const rrfScore = 1 / (k + (index + 1));
      if (existing) {
        existing.score += rrfScore;
      } else {
        itemMap.set(hit.id, {
          id: hit.id,
          content: hit.content,
          documentName: hit.documentName,
          chunkIndex: hit.chunkIndex,
          parentId: hit.parentId,
          score: rrfScore,
        });
      }
    });

    const reranked = Array.from(itemMap.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // 4. Retrieve Parent Document Content for richer LLM context
    const parentIds = reranked
      .map((r) => r.parentId)
      .filter((id): id is string => !!id);

    const parentMap = new Map<string, string>();
    if (parentIds.length > 0) {
      const uniqueParentIds = Array.from(new Set(parentIds));
      const parents = await this.parentRepo.find({
        where: { id: In(uniqueParentIds) },
      });
      parents.forEach((p) => {
        parentMap.set(p.id, p.content);
      });
    }

    return reranked.map((r) => {
      const parentContent = r.parentId ? parentMap.get(r.parentId) : null;
      return {
        content: parentContent || r.content,
        documentName: r.documentName,
        chunkIndex: r.chunkIndex,
        score: r.score,
      };
    });
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
    await this.parentRepo.delete({ workspaceId, documentName });
    await this.chunkRepo.delete({ workspaceId, documentName });
    this.logger.log(`Deleted document: ${documentName} from workspace: ${workspaceId}`);
  }
}
