import {
    Column,
    Entity,
    PrimaryGeneratedColumn,
    CreateDateColumn,
    UpdateDateColumn,
    Unique,
} from 'typeorm';


@Entity("channel_members")
@Unique(['channelId', 'memberId'])
export class ChannelMemberEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'channel_id', type: "uuid" })
    channelId: string;

    @Column({ name: 'member_id', type: "uuid" })
    memberId: string;

    @CreateDateColumn({
        name: 'created_at',
        type: 'timestamp',
        default: () => 'CURRENT_TIMESTAMP',
    })
    createdAt: Date;

    @Column({ name: 'last_read_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
    lastReadAt: Date;

    @UpdateDateColumn({
        name: 'updated_at',
        type: 'timestamp',
        default: () => 'CURRENT_TIMESTAMP',
        onUpdate: 'CURRENT_TIMESTAMP',
    })
    updatedAt: Date;
}