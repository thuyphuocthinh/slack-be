import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  In,
  OptimisticLockVersionMismatchError,
  Repository,
} from 'typeorm';
import { ChannelEntity } from '../entity/channel.entity';
import { ChannelMemberEntity } from '../entity/channel_member.entity';
import { CreateChannelDto } from '../dto/create-channel.dto';
import { UpdateChannelDto } from '../dto/update-channel.dto';
import { ToggleStarDto } from '../dto/toggle-star.dto';
import { GetChannelsDto } from '../dto/get-channels.dto';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  CHANNEL_ERROR,
  NAME_SERVICE_TCP,
  WORKSPACE_MESSAGE_PATTERNS,
  WorkspaceRoleEnum,
  ChannelTypeEnum,
  DATABASE_ERROR,
} from '@slack/constants';
import { Inject, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { ChannelResponse } from '../type/channel.response';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { IOffsetResponse, AuditAction, AuditEntityType } from '@slack/common';
import { EJobName, EQueueName, QueueService } from '@slack/queue';


@Injectable()
export class ChannelService {
  private readonly logger = new Logger(ChannelService.name);

  constructor(
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    @InjectRepository(ChannelMemberEntity)
    private readonly channelMemberRepository: Repository<ChannelMemberEntity>,
    private readonly dataSource: DataSource,
    @Inject(NAME_SERVICE_TCP.WORKSPACE_SERVICE)
    private readonly workspaceClient: ClientProxy,
    private readonly cachedService: CachedService,
    private readonly queueService: QueueService,
  ) { }


  public mapChannelToResponse(
    channel: ChannelEntity,
    member?: ChannelMemberEntity,
    memberIds?: string[],
  ): ChannelResponse {
    return {
      id: channel.id,
      name: channel.title ?? null,
      description: channel.description || null,
      type: channel.type,
      createdAt: channel.createdAt,
      isStar: channel.isStar,
      workspaceId: channel.workspaceId,
      memberIds: memberIds,
      unreadCount: member?.unreadCount ?? 0,
      lastReadAt: member?.lastReadAt,
      lastReadMessageId: member?.lastReadMessageId,
    };
  }

  private async checkWorkspacePermission(
    workspaceId: string,
    userId: string,
    allowedRoles: WorkspaceRoleEnum[],
  ) {
    return await firstValueFrom(
      this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.CHECK_PERMISSION, {
        workspaceId,
        userId,
        allowedRoles,
      }),
    );
  }

  private async getWorkspaceMember(workspaceId: string, userId: string) {
    return await this.cachedService.getOrSetDetail(
      CACHE.WORKSPACE.KEYS.IS_MEMBER(workspaceId, userId),
      TTL.SHORT,
      async () => {
        return await firstValueFrom(
          this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER, {
            workspaceId,
            userId,
          }),
        );
      },
    );
  }

  private async createDirectChannel(
    dto: CreateChannelDto,
  ): Promise<ChannelEntity> {
    const { workspaceId, memberId, targetMemberIds = [], description } = dto;

    const allMemberIds = [...new Set([memberId, ...targetMemberIds])].filter(Boolean);
    const memberCount = allMemberIds.length;

    return await this.dataSource.transaction(async (manager) => {
      // Optimized check: Find a DIRECT channel that has EXACTLY these members and no one else
      const existingChannelResult = await manager
        .createQueryBuilder(ChannelMemberEntity, 'cm')
        .select('cm.channel_id', 'channelId')
        .innerJoin('channels', 'c', 'c.id = cm.channel_id')
        .where('c.workspace_id = :workspaceId', { workspaceId })
        .andWhere('c.type = :type', { type: ChannelTypeEnum.DIRECT })
        .groupBy('cm.channel_id')
        .having('COUNT(cm.member_id) = :memberCount', { memberCount })
        .andHaving(
          'COUNT(CASE WHEN cm.member_id IN (:...allMemberIds) THEN 1 END) = :memberCount',
          { allMemberIds, memberCount },
        )
        .getRawOne<{ channelId: string }>();

      if (existingChannelResult) {
        const existingChannel = await manager.findOne(ChannelEntity, {
          where: { id: existingChannelResult.channelId },
        });
        if (existingChannel) return existingChannel;
      }

      // Create new headless DIRECT channel
      const channel = manager.create(ChannelEntity, {
        workspaceId,
        title: null, // Headless
        type: ChannelTypeEnum.DIRECT,
        description,
      });

      const saved = await manager.save(channel);

      const memberEntities = allMemberIds.map((id) => {
        return manager.create(ChannelMemberEntity, {
          channelId: saved.id,
          memberId: id,
        });
      });

      await manager.save(memberEntities);

      return saved;
    });
  }

  async findDirectChannel(
    workspaceId: string,
    memberIds: string[],
  ): Promise<ChannelResponse | null> {
    const allMemberIds = memberIds.filter((id) => id && id.length > 0);
    if (allMemberIds.length === 0) return null;

    const memberCount = allMemberIds.length;

    // Find a DIRECT channel that has EXACTLY these members and no one else
    const result = await this.channelMemberRepository
      .createQueryBuilder('cm')
      .select('cm.channel_id', 'channelId')
      .innerJoin('channels', 'c', 'c.id = cm.channel_id')
      .where('c.workspace_id = :workspaceId', { workspaceId })
      .andWhere('c.type = :type', { type: ChannelTypeEnum.DIRECT })
      .groupBy('cm.channel_id')
      .having('COUNT(cm.member_id) = :memberCount', { memberCount })
      .andHaving(
        'COUNT(CASE WHEN cm.member_id IN (:...allMemberIds) THEN 1 END) = :memberCount',
        { allMemberIds, memberCount },
      )
      .getRawOne<{ channelId: string }>();

    if (!result) return null;

    const channel = await this.channelRepository.findOne({
      where: { id: result.channelId },
    });

    if (channel) {
      return this.mapChannelToResponse(channel);
    }

    return null;
  }

  private async createGroupChannel(
    dto: CreateChannelDto,
  ): Promise<ChannelEntity> {
    const { workspaceId, title, description, memberId } = dto;

    // Only OWNER and ADMIN can create group channels
    await this.checkWorkspacePermission(workspaceId, memberId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
      WorkspaceRoleEnum.MEMBER,
    ]);

    if (!title) {
      throw new RpcException(CHANNEL_ERROR.TITLE_REQUIRED);
    }

    return await this.dataSource.transaction(async (manager) => {
      const existingChannel = await manager.findOne(ChannelEntity, {
        where: { workspaceId, title },
      });

      if (existingChannel) {
        throw new RpcException(CHANNEL_ERROR.CHANNEL_ALREADY_EXISTS);
      }

      const channel = manager.create(ChannelEntity, {
        workspaceId,
        title,
        type: ChannelTypeEnum.GROUP,
        description,
      });

      const saved = await manager.save(channel);

      const member = manager.create(ChannelMemberEntity, {
        channelId: saved.id,
        memberId,
      });

      await manager.save(member);

      return saved;
    });
  }

  async createChannel(dto: CreateChannelDto): Promise<ChannelResponse> {
    const { workspaceId, memberId, type = ChannelTypeEnum.GROUP } = dto;

    const savedChannel =
      type === ChannelTypeEnum.DIRECT
        ? await this.createDirectChannel(dto)
        : await this.createGroupChannel(dto);

    // Invalidate cache for all members involved
    const allMemberIds =
      savedChannel.type === ChannelTypeEnum.DIRECT
        ? [...new Set([memberId, ...(dto.targetMemberIds || [])])]
        : [memberId];

    const trackerKeys = allMemberIds.map((id) =>
      CACHE.CHANNEL.TRACKERS.LIST_VERSION(workspaceId, id),
    );
    await this.cachedService.invalidateListBulk(trackerKeys);

    this.logger.log(
      `Created ${type} channel: `,
      JSON.stringify(savedChannel, null, 2),
    );

    this.queueService.addJob(EQueueName.AUDIT_QUEUE, EJobName.SAVE_AUDIT_LOG, {
      action: AuditAction.CHANNEL_CREATED,
      actorId: memberId,
      entityType: AuditEntityType.CHANNEL,
      entityId: savedChannel.id,
      metadata: { title: savedChannel.title, type: savedChannel.type, workspaceId: savedChannel.workspaceId },
    });

    return this.mapChannelToResponse(savedChannel);

  }

  async updateChannel(dto: UpdateChannelDto): Promise<ChannelResponse> {
    const { channelId, memberId, title, description } = dto;

    try {
      const channel = await this.channelRepository.findOne({
        where: { id: channelId },
      });

      if (!channel) {
        throw new RpcException(CHANNEL_ERROR.CHANNEL_NOT_FOUND);
      }

      // check ngoài transaction
      await this.checkWorkspacePermission(channel.workspaceId, memberId, [
        WorkspaceRoleEnum.OWNER,
      ]);

      if (title) channel.title = title;
      if (description !== undefined) channel.description = description;

      const savedChannel = await this.channelRepository.save(channel);

      // Invalidate cache for all channel members
      const members = await this.channelMemberRepository.find({
        where: { channelId: savedChannel.id },
        select: ['memberId'],
      });

      const trackerKeys = members.map((m) =>
        CACHE.CHANNEL.TRACKERS.LIST_VERSION(
          savedChannel.workspaceId,
          m.memberId,
        ),
      );
      await this.cachedService.invalidateListBulk(trackerKeys);

      this.queueService.addJob(EQueueName.AUDIT_QUEUE, EJobName.SAVE_AUDIT_LOG, {
      action: AuditAction.CHANNEL_RENAMED,
      actorId: memberId,
      entityType: AuditEntityType.CHANNEL,
      entityId: savedChannel.id,
      metadata: { title: savedChannel.title },
    });

    return this.mapChannelToResponse(savedChannel);

    } catch (error) {
      if (error instanceof OptimisticLockVersionMismatchError) {
        throw new RpcException(DATABASE_ERROR.OPTIMISTIC_LOCK_CONFLICT);
      }
      throw error;
    }
  }

  async deleteChannel(channelId: string, memberId: string): Promise<string> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });
    if (!channel) {
      throw new RpcException(CHANNEL_ERROR.CHANNEL_NOT_FOUND);
    }

    // Only OWNER can delete channels
    await this.checkWorkspacePermission(channel.workspaceId, memberId, [
      WorkspaceRoleEnum.OWNER,
    ]);

    const members = await this.dataSource.transaction(async (manager) => {
      // Fetch members before deletion for cache invalidation
      const members = await manager.find(ChannelMemberEntity, {
        where: { channelId },
        select: ['memberId'],
      });

      await manager.delete(ChannelMemberEntity, { channelId });
      await manager.delete(ChannelEntity, { id: channelId });

      return members;
    });

    // Invalidate cache for all members
    const trackerKeys = members.map((m) =>
      CACHE.CHANNEL.TRACKERS.LIST_VERSION(channel.workspaceId, m.memberId),
    );
    await this.cachedService.invalidateListBulk(trackerKeys);

    this.queueService.addJob(EQueueName.AUDIT_QUEUE, EJobName.SAVE_AUDIT_LOG, {
      action: AuditAction.CHANNEL_DELETED,
      actorId: memberId,
      entityType: AuditEntityType.CHANNEL,
      entityId: channelId,
      metadata: { title: channel.title, workspaceId: channel.workspaceId },
    });

    return 'success';

  }

  async getChannels(
    dto: GetChannelsDto,
  ): Promise<IOffsetResponse<ChannelResponse[]>> {
    const { workspaceId, memberId, type, page = 1, limit = 20 } = dto;

    // Check if user is at least a member of the workspace
    await this.getWorkspaceMember(workspaceId, memberId);

    return await this.cachedService.getOrSetList({
      trackerKey: CACHE.CHANNEL.TRACKERS.LIST_VERSION(workspaceId, memberId),
      keyBuilder: (version) =>
        CACHE.CHANNEL.KEYS.LIST(
          workspaceId,
          memberId,
          version,
          page,
          limit,
          type,
        ),
      ttl: TTL.LONG,
      fetcher: async () => {
        const skip = (page - 1) * limit;

        const queryBuilder = this.channelRepository
          .createQueryBuilder('channel')
          .innerJoin(
            'channel_members',
            'member',
            'member.channel_id = channel.id',
          )
          .where('channel.workspace_id = :workspaceId', { workspaceId })
          .andWhere('member.member_id = :memberId', { memberId });

        if (type) {
          queryBuilder.andWhere('channel.type = :type', { type });
        }

        const total = await queryBuilder.getCount();

        const { entities, raw } = await queryBuilder
          .orderBy('channel.createdAt', 'DESC')
          .addSelect('member.unreadCount', 'unreadCount')
          .addSelect('member.lastReadAt', 'lastReadAt')
          .addSelect('member.lastReadMessageId', 'lastReadMessageId')
          .skip(skip)
          .take(limit)
          .getRawAndEntities();

        const channelIds = entities.map((c) => c.id);
        let allMembers: ChannelMemberEntity[] = [];
        if (channelIds.length > 0) {
          allMembers = await this.channelMemberRepository.find({
            where: { channelId: In(channelIds) },
            select: ['channelId', 'memberId'],
          });
        }

        const data = entities.map((channel, index) => {
          const rawItem = raw[index];
          const memberIds = allMembers
            .filter((m) => m.channelId === channel.id)
            .map((m) => m.memberId);

          return {
            id: channel.id,
            name: channel.title ?? null,
            description: channel.description || null,
            type: channel.type,
            createdAt: channel.createdAt,
            isStar: channel.isStar,
            workspaceId: channel.workspaceId,
            memberIds,
            unreadCount: rawItem.unreadCount || 0,
            lastReadAt: rawItem.lastReadAt,
            lastReadMessageId: rawItem.lastReadMessageId,
          };
        });

        return {
          data,
          paging: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        } as unknown as IOffsetResponse<ChannelResponse[]>;
      },
    });
  }

  async getChannel(
    channelId: string,
    memberId: string,
  ): Promise<ChannelResponse> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });

    if (!channel) {
      throw new RpcException(CHANNEL_ERROR.CHANNEL_NOT_FOUND);
    }

    // Check if user is member of the channel
    const isMember = await this.channelMemberRepository.findOne({
      where: { channelId, memberId },
    });

    if (!isMember) {
      throw new RpcException(CHANNEL_ERROR.USER_NOT_MEMBER);
    }

    const members = await this.channelMemberRepository.find({
      where: { channelId },
      select: ['memberId'],
    });

    return this.mapChannelToResponse(
      channel,
      isMember,
      members.map((m) => m.memberId),
    );
  }

  async getChannelBasicInfo(channelId: string): Promise<ChannelResponse> {
    const channel = await this.channelRepository.findOne({
      where: { id: channelId },
    });

    if (!channel) {
      throw new RpcException(CHANNEL_ERROR.CHANNEL_NOT_FOUND);
    }

    // Just map basic info without unread metadata
    return this.mapChannelToResponse(channel);
  }

  async toggleStar(dto: ToggleStarDto): Promise<ChannelResponse> {
    const { channelId } = dto;
    const updatedChannel = await this.dataSource.transaction(
      async (manager) => {
        const channel = await manager.findOne(ChannelEntity, {
          where: { id: channelId },
        });

        if (!channel) {
          throw new RpcException(CHANNEL_ERROR.CHANNEL_NOT_FOUND);
        }

        channel.isStar = !channel.isStar;
        try {
          return await manager.save(channel);
        } catch (error) {
          if (error instanceof OptimisticLockVersionMismatchError) {
            throw new RpcException(DATABASE_ERROR.OPTIMISTIC_LOCK_CONFLICT);
          }
          throw error;
        }
      },
    );

    // Invalidate cache for all channel members because star status changed
    const members = await this.channelMemberRepository.find({
      where: { channelId: updatedChannel.id },
      select: ['memberId'],
    });
    const trackerKeys = members.map((m) =>
      CACHE.CHANNEL.TRACKERS.LIST_VERSION(
        updatedChannel.workspaceId,
        m.memberId,
      ),
    );
    await this.cachedService.invalidateListBulk(trackerKeys);

    this.logger.log(
      'Updated channel: ',
      JSON.stringify(updatedChannel, null, 2),
    );

    return this.mapChannelToResponse(updatedChannel);
  }
}
