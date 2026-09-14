import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { TiptapTransformer } from '@hocuspocus/transformer';
import { plainToInstance } from 'class-transformer';
import { BlocksEntity } from '../entity/blocks.entity';
import { BlockType } from '../types/blocks.types';
import { BlockResponseDto } from '../dto/block-response.dto';
import type { Doc as YDoc } from 'yjs';

const TIPTAP_TO_BLOCK_TYPE: Record<string, BlockType> = {
  paragraph: BlockType.Text,
  heading: BlockType.Heading,
  bulletList: BlockType.Bullet,
  orderedList: BlockType.NumberedList,
  taskList: BlockType.Todo,
  codeBlock: BlockType.Code,
  blockquote: BlockType.Quote,
  horizontalRule: BlockType.Divider,
  image: BlockType.Image,
  details: BlockType.Toggle,
  video: BlockType.Media,
};

interface ProseMirrorNode {
  type: string;
  content?: ProseMirrorNode[];
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

@Injectable()
export class YjsBlocksSyncService {
  private readonly logger = new Logger(YjsBlocksSyncService.name);

  constructor(
    @InjectRepository(BlocksEntity)
    private readonly blocksRepo: Repository<BlocksEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private mapToBlockResponse(block: BlocksEntity): BlockResponseDto {
    return plainToInstance(BlockResponseDto, block, {
      excludeExtraneousValues: true,
    });
  }

  private mapNodeType(tiptapType: string): BlockType | null {
    return TIPTAP_TO_BLOCK_TYPE[tiptapType] ?? null;
  }

  /**
   * Parse ProseMirror JSON content[] → flat list of BlocksEntity.
   * Mỗi top-level node = 1 block. Nested content (listItem, taskItem)
   * được giữ nguyên trong content JSONB của block cha.
   */
  private decomposeToBlocks(
    pageId: string,
    pmJson: Record<string, unknown>,
    parentId?: string,
  ): BlocksEntity[] {
    const doc = pmJson as unknown as ProseMirrorNode;
    const topLevelNodes = doc.content ?? [];
    const blocks: BlocksEntity[] = [];

    for (const node of topLevelNodes) {
      const blockType = this.mapNodeType(node.type);

      if (!blockType) {
        this.logger.warn(`Unknown Tiptap node type "${node.type}" — skipped`);
        continue;
      }

      const content: Record<string, unknown> = {};

      if (node.attrs) {
        content.attrs = node.attrs;
      }

      if (node.content) {
        content.content = node.content;
      }

      if (node.text) {
        content.text = node.text;
      }

      const block = this.blocksRepo.create({
        pageId,
        type: blockType,
        content,
        order: blocks.length,
        parentId: parentId ?? undefined,
      });

      blocks.push(block);
    }

    return blocks;
  }

  /**
   * Parse Yjs Document → ProseMirror JSON → decompose thành Block rows.
   * Strategy: full replace (delete old + insert new) bọc transaction.
   *
   * Eventual consistency — nếu sync fail, Yjs binary vẫn đã lưu an toàn
   * vào page_documents. Blocks table chỉ là snapshot phục vụ search.
   */
  async syncFromYdoc(
    pageId: string,
    document: YDoc,
  ): Promise<BlockResponseDto[]> {
    try {
      const pmJson = TiptapTransformer.fromYdoc(document, 'default');
      const newBlocks = this.decomposeToBlocks(pageId, pmJson);

      const savedBlocks = await this.dataSource.transaction(async (manager) => {
        await manager.delete(BlocksEntity, { pageId });

        if (newBlocks.length === 0) return [];

        return manager.save(BlocksEntity, newBlocks);
      });

      this.logger.debug(
        `Synced ${savedBlocks.length} blocks for page ${pageId}`,
      );

      return savedBlocks.map((block) => this.mapToBlockResponse(block));
    } catch (error) {
      this.logger.error(`Error syncing blocks for page ${pageId}:`, error);
      throw error;
    }
  }
}
