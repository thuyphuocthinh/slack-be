import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { ChannelMemberEntity } from '../entity/channel_member.entity';
import { ChannelEntity } from '../entity/channel.entity';
import { ChannelMemberDto } from '../dto/channel-member.dto';
import { AddBatchMembersDto } from '../dto/add-batch-members.dto';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  CHANNEL_ERROR,
  NAME_SERVICE_TCP,
  WORKSPACE_MESSAGE_PATTERNS,
  WorkspaceRoleEnum,
  ChannelTypeEnum,
} from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { ChannelMemberResponse } from '../type/channel.response';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { RemoveMemberDto } from '../dto/remove-member.dto';

@Injectable()
export class ChannelMemberService {
  private readonly logger = new Logger(ChannelMemberService.name);

  constructor(
    @InjectRepository(ChannelMemberEntity)
    private readonly channelMemberRepository: Repository<ChannelMemberEntity>,
    @InjectRepository(ChannelEntity)
    private readonly channelRepository: Repository<ChannelEntity>,
    private readonly dataSource: DataSource,
    @Inject(NAME_SERVICE_TCP.WORKSPACE_SERVICE)
    private readonly workspaceClient: ClientProxy,
    private readonly cachedService: CachedService,
  ) {}

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
    return await firstValueFrom(
      this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER, {
        workspaceId,
        userId,
      }),
    );
  }


  private mapMemberToResponse(
    member: ChannelMemberEntity,
  ): ChannelMemberResponse {
    return {
      memberId: member.memberId,
    };
  }

  async addMember(dto: ChannelMemberDto): Promise<string> {
    const { channelId, targetMember, performerId } = dto;

    const { workspaceId, memberId } = await this.dataSource.transaction(
      async (manager) => {
        const channel = await manager.findOne(ChannelEntity, {
          where: { id: channelId },
        });

        if (!channel) {
          throw new RpcException(CHANNEL_ERROR.CHANNEL_NOT_FOUND);
        }

        if (channel.type === ChannelTypeEnum.DIRECT) {
          throw new RpcException(
            CHANNEL_ERROR.CANNOT_ADD_MEMBER_TO_DIRECT_CHANNEL,
          );
        }

        // Only OWNER and ADMIN can add members to channels
        await this.checkWorkspacePermission(channel.workspaceId, performerId, [
          WorkspaceRoleEnum.OWNER,
          WorkspaceRoleEnum.ADMIN,
        ]);

        const { memberId } = targetMember;

        const existingMember = await manager.findOne(ChannelMemberEntity, {
          where: { channelId, memberId },
        });

        if (existingMember) {
          throw new RpcException(CHANNEL_ERROR.USER_ALREADY_MEMBER);
        }

        const newMember = manager.create(ChannelMemberEntity, {
          channelId,
          memberId,
        });

        await manager.save(newMember);

        return { workspaceId: channel.workspaceId, memberId };
      },
    );

    // Invalidate cache for target member
    this.cachedService
      .invalidateList(
        CACHE.CHANNEL.TRACKERS.LIST_VERSION(workspaceId, memberId),
      )
      .catch((err) =>
        this.logger.error(`Cache invalidation failed: ${err.message}`),
      );

    // Invalidate channel members list cache
    this.cachedService
      .invalidateList(CACHE.CHANNEL.TRACKERS.MEMBERS_VERSION(channelId))
      .catch((err) =>
        this.logger.error(
          `Channel members cache invalidation failed: ${err.message}`,
        ),
      );

    this.logger.log('Added member: ', JSON.stringify(dto, null, 2));

    return 'success';
  }

  async addBatchMembers(dto: AddBatchMembersDto): Promise<string> {
    const { channelId, targetMembers, performerId } = dto;

    const { workspaceId, newMemberIds } = await this.dataSource.transaction(
      async (manager) => {
        const channel = await manager.findOne(ChannelEntity, {
          where: { id: channelId },
        });

        if (!channel) {
          throw new RpcException(CHANNEL_ERROR.CHANNEL_NOT_FOUND);
        }

        if (channel.type === ChannelTypeEnum.DIRECT) {
          throw new RpcException(
            CHANNEL_ERROR.CANNOT_ADD_MEMBER_TO_DIRECT_CHANNEL,
          );
        }

        // Only OWNER and ADMIN can add members to channels
        await this.checkWorkspacePermission(channel.workspaceId, performerId, [
          WorkspaceRoleEnum.OWNER,
          WorkspaceRoleEnum.ADMIN,
        ]);

        const targetMemberIds = targetMembers.map((m) => m.memberId);

        const existingMembers = await manager.find(ChannelMemberEntity, {
          where: {
            channelId,
            memberId: In(targetMemberIds),
          },
        });

        const existingMemberIds = new Set(
          existingMembers.map((m) => m.memberId),
        );
        const newMembers = targetMembers.filter(
          (m) => !existingMemberIds.has(m.memberId),
        );

        if (newMembers.length === 0) {
          return { workspaceId: channel.workspaceId, newMemberIds: [] };
        }

        const memberEntities = newMembers.map((m) =>
          manager.create(ChannelMemberEntity, {
            channelId,
            memberId: m.memberId,
          }),
        );

        await manager.save(memberEntities);

        return {
          workspaceId: channel.workspaceId,
          newMemberIds: newMembers.map((m) => m.memberId),
        };
      },
    );

    if (newMemberIds.length > 0) {
      // Invalidate cache for all new members
      const trackerKeys = newMemberIds.map((id) =>
        CACHE.CHANNEL.TRACKERS.LIST_VERSION(workspaceId, id),
      );
      await this.cachedService.invalidateListBulk(trackerKeys);

      // Invalidate channel members list cache
      await this.cachedService.invalidateList(
        CACHE.CHANNEL.TRACKERS.MEMBERS_VERSION(channelId),
      );
    }

    this.logger.log('Added batch members: ', JSON.stringify(dto, null, 2));

    return 'success';
  }

  async removeMember(dto: RemoveMemberDto): Promise<string> {
    const { channelId, targetMemberId, performerId } = dto;

    const { workspaceId } = await this.dataSource.transaction(
      async (manager) => {
        const channel = await manager.findOne(ChannelEntity, {
          where: { id: channelId },
        });

        if (!channel) {
          throw new RpcException(CHANNEL_ERROR.CHANNEL_NOT_FOUND);
        }

        if (channel.type === ChannelTypeEnum.DIRECT) {
          throw new RpcException(
            CHANNEL_ERROR.CANNOT_REMOVE_MEMBER_IN_DIRECT_CHANNEL,
          );
        }

        // Hierarchy logic based on Workspace roles
        const performer = await this.checkWorkspacePermission(
          channel.workspaceId,
          performerId,
          [WorkspaceRoleEnum.OWNER, WorkspaceRoleEnum.ADMIN],
        );

        const target = await this.getWorkspaceMember(
          channel.workspaceId,
          targetMemberId,
        );

        if (target.role === WorkspaceRoleEnum.OWNER) {
          throw new RpcException(CHANNEL_ERROR.CANNOT_REMOVE_OWNER);
        }

        if (
          performer.role === WorkspaceRoleEnum.ADMIN &&
          target.role === WorkspaceRoleEnum.ADMIN
        ) {
          throw new RpcException(CHANNEL_ERROR.NOT_ALLOWED);
        }

        const member = await manager.findOne(ChannelMemberEntity, {
          where: { channelId, memberId: targetMemberId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!member) {
          throw new RpcException(CHANNEL_ERROR.USER_NOT_MEMBER);
        }

        await manager.remove(member);

        return { workspaceId: channel.workspaceId };
      },
    );

    // Invalidate cache for target member
    this.cachedService
      .invalidateList(
        CACHE.CHANNEL.TRACKERS.LIST_VERSION(workspaceId, targetMemberId),
      )
      .catch((err) =>
        this.logger.error(`Cache invalidation failed: ${err.message}`),
      );

    // Invalidate channel members list cache
    this.cachedService
      .invalidateList(CACHE.CHANNEL.TRACKERS.MEMBERS_VERSION(channelId))
      .catch((err) =>
        this.logger.error(
          `Channel members cache invalidation failed: ${err.message}`,
        ),
      );

    this.logger.log('Removed member: ', JSON.stringify(dto, null, 2));

    return 'success';
  }

  async getMembers(channelId: string): Promise<ChannelMemberResponse[]> {
    return await this.cachedService.getOrSetList({
      trackerKey: CACHE.CHANNEL.TRACKERS.MEMBERS_VERSION(channelId),
      keyBuilder: (v) => CACHE.CHANNEL.KEYS.MEMBERS(channelId, v),
      ttl: TTL.SHORT,
      fetcher: async () => {
        const members = await this.channelMemberRepository.find({
          where: { channelId },
        });

        return members.map((member) => this.mapMemberToResponse(member));
      },
    });
  }

  async leaveChannel(channelId: string, memberId: string): Promise<string> {
    const { workspaceId } = await this.dataSource.transaction(
      async (manager) => {
        const channel = await manager.findOne(ChannelEntity, {
          where: { id: channelId },
        });

        if (!channel) {
          throw new RpcException(CHANNEL_ERROR.CHANNEL_NOT_FOUND);
        }

        const member = await manager.findOne(ChannelMemberEntity, {
          where: { channelId, memberId },
          lock: { mode: 'pessimistic_write' },
        });

        if (!member) {
          throw new RpcException(CHANNEL_ERROR.NOT_IN_CHANNEL);
        }

        await manager.remove(member);

        return { workspaceId: channel.workspaceId };
      },
    );

    // Invalidate cache for member
    this.cachedService
      .invalidateList(
        CACHE.CHANNEL.TRACKERS.LIST_VERSION(workspaceId, memberId),
      )
      .catch((err) =>
        this.logger.error(`Cache invalidation failed: ${err.message}`),
      );

    // Invalidate channel members list cache
    this.cachedService
      .invalidateList(CACHE.CHANNEL.TRACKERS.MEMBERS_VERSION(channelId))
      .catch((err) =>
        this.logger.error(
          `Channel members cache invalidation failed: ${err.message}`,
        ),
      );

    this.logger.log(
      'User left channel: ',
      JSON.stringify({ channelId, memberId }, null, 2),
    );

    return 'User left channel successfully';
  }

  async incrementUnreadCount(
    channelId: string,
    senderId: string,
  ): Promise<{ memberId: string; unreadCount: number }[]> {
    await this.channelMemberRepository
      .createQueryBuilder()
      .update(ChannelMemberEntity)
      .set({ unreadCount: () => 'unread_count + 1' })
      .where('channel_id = :channelId AND member_id != :senderId', {
        channelId,
        senderId,
      })
      .execute();

    // Lấy lại danh sách member và unread_count mới để bắn socket
    const updatedMembers = await this.channelMemberRepository.find({
      where: { channelId },
      select: ['memberId', 'unreadCount'],
    });

    return updatedMembers;
  }

  async markAsRead(
    channelId: string,
    memberId: string,
    lastReadMessageId: string,
  ): Promise<void> {
    await this.channelMemberRepository.update(
      { channelId, memberId },
      {
        unreadCount: 0,
        lastReadMessageId,
        lastReadAt: new Date(),
      },
    );
  }

  async removeMemberFromAllChannels(
    workspaceId: string,
    memberId: string,
  ): Promise<void> {
    // 1. Find all channels in this workspace where this user is a member
    const memberships = await this.channelMemberRepository
      .createQueryBuilder('member')
      .innerJoin('channels', 'channel', 'channel.id = member.channel_id')
      .where('channel.workspace_id = :workspaceId', { workspaceId })
      .andWhere('member.member_id = :memberId', { memberId })
      .select('member.channel_id', 'channelId')
      .getRawMany();

    if (memberships.length === 0) return;

    const channelIds = memberships.map((m) => m.channelId);

    // 2. Remove the memberships
    await this.channelMemberRepository.delete({
      channelId: In(channelIds),
      memberId,
    });

    // 3. Invalidate cache for the member's channel list
    await this.cachedService
      .invalidateList(
        CACHE.CHANNEL.TRACKERS.LIST_VERSION(workspaceId, memberId),
      )
      .catch((err) =>
        this.logger.error(`Cache invalidation failed: ${err.message}`),
      );

    // 4. Invalidate members list for each channel
    await Promise.all(
      channelIds.map((id) =>
        this.cachedService
          .invalidateList(CACHE.CHANNEL.TRACKERS.MEMBERS_VERSION(id))
          .catch((err) =>
            this.logger.error(
              `Channel members cache invalidation failed for ${id}: ${err.message}`,
            ),
          ),
      ),
    );

    this.logger.log(
      `Removed member ${memberId} from all channels in workspace ${workspaceId}`,
    );
  }
  async getUnreadSummary(
    workspaceId: string,
    memberId: string,
  ): Promise<{ unreadDmCount: number; hasUnreadChannels: boolean }> {
    const result = await this.channelMemberRepository
      .createQueryBuilder('member')
      .innerJoin('channels', 'channel', 'channel.id = member.channel_id')
      .where('channel.workspace_id = :workspaceId', { workspaceId })
      .andWhere('member.member_id = :memberId', { memberId })
      .select([
        'channel.type as type',
        'SUM(member.unread_count) as total_unread',
      ])
      .groupBy('channel.type')
      .getRawMany();

    let unreadDmCount = 0;
    let hasUnreadChannels = false;

    result.forEach((row) => {
      const count = parseInt(row.total_unread, 10);
      if (row.type === ChannelTypeEnum.DIRECT) {
        unreadDmCount = count;
      } else {
        if (count > 0) {
          hasUnreadChannels = true;
        }
      }
    });

    return { unreadDmCount, hasUnreadChannels };
  }
}
