import { Expose } from 'class-transformer';
import { BlockType } from '../types/blocks.types';

export class BlockResponseDto {
  @Expose()
  id: string;

  @Expose()
  pageId: string;

  @Expose()
  type: BlockType;

  @Expose()
  content: Record<string, unknown>;

  @Expose()
  order: number;

  @Expose()
  parentId: string | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;
}
