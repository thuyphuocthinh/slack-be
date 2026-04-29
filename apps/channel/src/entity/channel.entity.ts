import {
    Column,
    Entity,
    Index,
    PrimaryGeneratedColumn,
    CreateDateColumn,
    UpdateDateColumn,
    Unique,
    VersionColumn,
} from 'typeorm';
import { ChannelTypeEnum } from '@slack/constants';

@Entity("channels")
@Unique(['workspaceId', 'title'])
export class ChannelEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'workspace_id', type: "uuid" })
    @Index()
    workspaceId: string;

    @Column({ name: 'title' })
    title: string;

    @Column({ name: 'type', type: 'enum', enum: ChannelTypeEnum, default: ChannelTypeEnum.GROUP })
    type: ChannelTypeEnum;

    @Column({ name: 'description', type: 'text', nullable: true })
    description?: string;

    @Column({ name: 'is_star', type: 'boolean', default: false })
    isStar: boolean;

    @CreateDateColumn({
        name: 'created_at',
        type: 'timestamp',
        default: () => 'CURRENT_TIMESTAMP',
    })
    createdAt: Date;

    @UpdateDateColumn({
        name: 'updated_at',
        type: 'timestamp',
        default: () => 'CURRENT_TIMESTAMP',
        onUpdate: 'CURRENT_TIMESTAMP',
    })
    updatedAt: Date;

    @VersionColumn({ nullable: false, default: 1, name: 'version' })
    version: number;
}
