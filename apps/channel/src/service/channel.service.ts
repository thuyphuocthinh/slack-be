import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
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
  USER_MESSAGE_PATTERNS,
  WORKSPACE_MESSAGE_PATTERNS,
  WorkspaceRoleEnum,
  ChannelTypeEnum,
  USER_ERROR,
  DATABASE_ERROR,
} from '@slack/constants';
import { Inject, Logger } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import { ChannelResponse } from '../type/channel.response';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { IOffsetResponse } from '@slack/common';
import { MemberType } from '../type/member.type';

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
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    private readonly cachedService: CachedService,
  ) {}

  private mapChannelToResponse(
    channel: ChannelEntity,
    member?: ChannelMemberEntity,
  ): ChannelResponse {
    return {
      id: channel.id,
      name: channel.title,
      description: channel.description || null,
      type: channel.type,
      createdAt: channel.createdAt,
      isStar: channel.isStar,
      workspaceId: channel.workspaceId,
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

    const allMemberIds = [...new Set([memberId, ...targetMemberIds])];

    const users = await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_BATCH_USER_BY_IDS, {
        ids: allMemberIds,
      }),
    );

    if (!users || users.length !== allMemberIds.length) {
      throw new RpcException(USER_ERROR.SOME_USER_NOT_FOUND);
    }

    // Determine title: other person's name for 1-on-1, or joined names for group DM
    let title: string;
    if (allMemberIds.length === 2) {
      const otherUser = users.find((u) => u.id !== memberId);
      title = `${otherUser.firstName} ${otherUser.lastName}`.trim();
    } else if (allMemberIds.length === 1) {
      const currentUser = users[0];
      title = `${currentUser.firstName} ${currentUser.lastName} (you)`.trim();
    } else {
      title = users
        .map((u: MemberType) => `${u.firstName} ${u.lastName}`.trim())
        .join(', ');
    }

    return await this.dataSource.transaction(async (manager) => {
      // Check if a DIRECT channel with these EXACT members already exists in this workspace
      const existingChannels = await manager
        .createQueryBuilder(ChannelEntity, 'channel')
        .innerJoin('channel_members', 'm', 'm.channel_id = channel.id')
        .where('channel.workspaceId = :workspaceId', { workspaceId })
        .andWhere('channel.type = :type', { type: ChannelTypeEnum.DIRECT })
        .andWhere('m.memberId = :memberId', { memberId })
        .getMany();

      for (const channel of existingChannels) {
        const members = await manager.find(ChannelMemberEntity, {
          where: { channelId: channel.id },
        });
        const currentMemberIds = members.map((m) => m.memberId).sort();
        const searchMemberIds = [...allMemberIds].sort();

        if (
          JSON.stringify(currentMemberIds) === JSON.stringify(searchMemberIds)
        ) {
          return channel;
        }
      }

      const channel = manager.create(ChannelEntity, {
        workspaceId,
        title,
        type: ChannelTypeEnum.DIRECT,
        description,
      });

      const saved = await manager.save(channel);

      const userMap = new Map(users.map((u: MemberType) => [u.id, u]));

      const members = allMemberIds.map((id) => {
        const user = userMap.get(id) as MemberType;
        return manager.create(ChannelMemberEntity, {
          channelId: saved.id,
          memberId: id,
          email: user?.email,
          firstName: user?.firstName,
          lastName: user?.lastName,
          avatarUrl: user?.avatarUrl,
        });
      });

      await manager.save(members);

      return saved;
    });
  }

  private async createGroupChannel(
    dto: CreateChannelDto,
  ): Promise<ChannelEntity> {
    const { workspaceId, title, description, memberId } = dto;

    // Only OWNER can create group channels
    await this.checkWorkspacePermission(workspaceId, memberId, [
      WorkspaceRoleEnum.OWNER,
    ]);

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

      const user = await firstValueFrom(
        this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, {
          id: memberId,
        }),
      );

      const member = manager.create(ChannelMemberEntity, {
        channelId: saved.id,
        memberId,
        email: user?.email,
        firstName: user?.firstName,
        lastName: user?.lastName,
        avatarUrl: user?.avatarUrl,
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

    await this.cachedService.invalidateList(
      CACHE.CHANNEL.TRACKERS.LIST_VERSION(workspaceId, memberId),
    );

    this.logger.log(
      `Created ${type} channel: `,
      JSON.stringify(savedChannel, null, 2),
    );

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

      await this.cachedService.invalidateList(
        CACHE.CHANNEL.TRACKERS.LIST_VERSION(savedChannel.workspaceId, memberId),
      );

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

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(ChannelMemberEntity, { channelId });
      await manager.delete(ChannelEntity, { id: channelId });
    });

    await this.cachedService.invalidateList(
      CACHE.CHANNEL.TRACKERS.LIST_VERSION(channel.workspaceId, memberId),
    );

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

        const data = entities.map((channel, index) => {
          const rawItem = raw[index];
          return {
            id: channel.id,
            name: channel.title,
            description: channel.description || null,
            type: channel.type,
            createdAt: channel.createdAt,
            isStar: channel.isStar,
            workspaceId: channel.workspaceId,
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

    return this.mapChannelToResponse(channel, isMember);
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

    this.logger.log(
      'Updated channel: ',
      JSON.stringify(updatedChannel, null, 2),
    );

    return this.mapChannelToResponse(updatedChannel);
  }
}
