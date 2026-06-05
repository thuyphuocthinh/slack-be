import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum ResourceScope {
  GLOBAL = 'global',
  WORKSPACE = 'workspace',
}

export enum ResourceType {
  IMAGE = 'image',
  VIDEO = 'video',
  FILE = 'file',
  AVATAR = 'avatar',
  AUDIO = 'audio',
}

@Entity('resources')
export class ResourceEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'public_id' })
  publicId: string;

  @Column()
  url: string;

  @Column({ nullable: true, name: 'thumbnail_url' })
  thumbnailUrl?: string;

  @Column()
  filename: string;

  @Column({ name: 'mime_type' })
  mimeType: string;

  @Column()
  size: number;

  @Column({
    type: 'enum',
    enum: ResourceType,
  })
  type: ResourceType;

  @Column({ name: 'workspace_id', type: 'uuid', nullable: true })
  workspaceId?: string;

  @Column({
    type: 'enum',
    enum: ResourceScope,
    default: ResourceScope.GLOBAL,
  })
  scope: ResourceScope;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy: string;

  @Column({ nullable: true, name: 'ref_type' })
  refType?: string; // 'user' | 'message' | 'task'

  @Column({ nullable: true, name: 'ref_id' })
  refId?: string;

  @Column({ default: false, name: 'is_deleted' })
  isDeleted: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
