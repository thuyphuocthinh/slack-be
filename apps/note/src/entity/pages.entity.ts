import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { PageType } from '../types/pages.types';

@Entity('pages')
export class PagesEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  @Index()
  userId: string;

  @Column({ name: 'workspace_id' })
  @Index()
  workspaceId: string;

  // type: 'varchar' tường minh — TS union (string | null) không tự suy ra được
  // column type qua reflect-metadata (resolve thành Object -> lỗi
  // DataTypeNotSupportedError), khác với string đơn thuần suy ra được.
  @Column({ name: 'parent_id', type: 'varchar', nullable: true })
  @Index()
  parentId: string | null;

  @Column({ nullable: true, length: 255 })
  title: string;

  @Column({ name: 'favicon', nullable: true, length: 255 })
  favicon: string;

  @Column({ name: 'cover_image', nullable: true, length: 512 })
  coverImage: string;

  @Column({
    type: 'enum',
    name: 'type',
    default: PageType.Normal,
    enum: PageType,
  })
  type: PageType;

  @Column({ name: 'path' })
  path: string;

  @Column({ name: 'depth', default: 0 })
  depth: number;

  // Vị trí thủ công trong danh sách anh em cùng (workspaceId, parentId) — 0-based,
  // luôn được reindex liên tục (0..n-1) mỗi khi move/reorder (xem
  // PagesService.reindexSiblings), không dùng scheme phân số/gap.
  @Column({ name: 'order', default: 0 })
  order: number;

  @Column({ name: 'is_public', default: false })
  isPublic: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ type: 'timestamptz', name: 'deleted_at' })
  deletedAt: Date;
}
