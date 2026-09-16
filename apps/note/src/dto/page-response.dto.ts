import { Expose } from 'class-transformer';
import { PageType } from '../types/pages.types';

export class PageResponseDto {
  @Expose()
  id: string;

  @Expose()
  workspaceId: string;

  @Expose()
  userId: string;

  @Expose()
  parentId: string | null;

  @Expose()
  title: string | null;

  @Expose()
  favicon: string | null;

  @Expose()
  coverImage: string | null;

  @Expose()
  type: PageType;

  @Expose()
  path: string;

  @Expose()
  depth: number;

  @Expose()
  order: number;

  @Expose()
  isPublic: boolean;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  @Expose()
  deletedAt?: Date | null;
}
