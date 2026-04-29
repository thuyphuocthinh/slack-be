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
  USER_MESSAGE_PATTERNS,
  WORKSPACE_MESSAGE_PATTERNS,
  WorkspaceRoleEnum,
  ChannelTypeEnum,
  USER_ERROR,
} from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { ChannelMemberResponse } from '../type/channel.response';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { MemberType } from '../type/member.type';
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
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    private readonly cachedService: CachedService,
  ) { }

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

  private async checkUserExist(userId: string) {
    const user = await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, { id: userId }),
    );
    if (!user) {
      throw new RpcException(USER_ERROR.USER_NOT_FOUND);
    }
    return user;
  }

  private mapMemberToResponse(
    member: ChannelMemberEntity,
  ): ChannelMemberResponse {
    return {
      id: member.id,
      email: member.email,
      firstName: member.firstName ?? null,
      lastName: member.lastName ?? null,
      avatarUrl: member.avatarUrl ?? null,
    };
  }

  async addMember(dto: ChannelMemberDto): Promise<string> {
    const { channelId, targetMember, performerId } = dto;

    await this.dataSource.transaction(async (manager) => {
      const channel = await manager.findOne(ChannelEntity, {
        where: { id: channelId },
      });

      if (!channel) {
        throw new RpcException(CHANNEL_ERROR.CHANNEL_NOT_FOUND);
      }

      if (channel.type === ChannelTypeEnum.DIRECT) {
        throw new RpcException(CHANNEL_ERROR.CANNOT_ADD_MEMBER_TO_DIRECT_CHANNEL);
      }

      // Only OWNER and ADMIN can add members to channels
      await this.checkWorkspacePermission(channel.workspaceId, performerId, [
        WorkspaceRoleEnum.OWNER,
        WorkspaceRoleEnum.ADMIN,
      ]);

      const { memberId, email, firstName, lastName, avatarUrl } = targetMember;

      const existingMember = await manager.findOne(ChannelMemberEntity, {
        where: { channelId, memberId },
      });

      if (existingMember) {
        throw new RpcException(CHANNEL_ERROR.USER_ALREADY_MEMBER);
      }

      const newMember = manager.create(ChannelMemberEntity, {
        channelId,
        memberId,
        email,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        avatarUrl: avatarUrl ?? null,
      });

      await manager.save(newMember);

      // Invalidate cache for target member
      this.cachedService
        .invalidateList(
          CACHE.CHANNEL.TRACKERS.LIST_VERSION(channel.workspaceId, memberId),
        )
        .catch((err) =>
          this.logger.error(`Cache invalidation failed: ${err.message}`),
        );

      // Invalidate channel members list cache
      this.cachedService
        .invalidateList(CACHE.CHANNEL.TRACKERS.MEMBERS_VERSION(channelId))
        .catch((err) =>
          this.logger.error(`Channel members cache invalidation failed: ${err.message}`),
        );
    });

    this.logger.log('Added member: ', JSON.stringify(dto, null, 2));

    return 'success';
  }

  async addBatchMembers(dto: AddBatchMembersDto): Promise<string> {
    const { channelId, targetMembers, performerId } = dto;

    await this.dataSource.transaction(async (manager) => {
      const channel = await manager.findOne(ChannelEntity, {
        where: { id: channelId },
      });

      if (!channel) {
        throw new RpcException(CHANNEL_ERROR.CHANNEL_NOT_FOUND);
      }

      if (channel.type === ChannelTypeEnum.DIRECT) {
        throw new RpcException(CHANNEL_ERROR.CANNOT_ADD_MEMBER_TO_DIRECT_CHANNEL);
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

      const existingMemberIds = new Set(existingMembers.map((m) => m.memberId));
      const newMembers = targetMembers.filter(
        (m) => !existingMemberIds.has(m.memberId),
      );

      if (newMembers.length === 0) {
        return;
      }

      const memberEntities = newMembers.map((m) =>
        manager.create(ChannelMemberEntity, {
          channelId,
          memberId: m.memberId,
          email: m.email,
          firstName: m.firstName || null,
          lastName: m.lastName || null,
          avatarUrl: m.avatarUrl || null,
        }),
      );

      await manager.save(memberEntities);

      // Invalidate cache for all new members
      await Promise.all(
        newMembers.map((m) =>
          this.cachedService
            .invalidateList(
              CACHE.CHANNEL.TRACKERS.LIST_VERSION(channel.workspaceId, m.memberId),
            )
            .catch((err) =>
              this.logger.error(
                `Cache invalidation failed for ${m.memberId}: ${err.message}`,
              ),
            ),
        ),
      );

      // Invalidate channel members list cache
      await this.cachedService.invalidateList(
        CACHE.CHANNEL.TRACKERS.MEMBERS_VERSION(channelId),
      );
    });

    this.logger.log('Added batch members: ', JSON.stringify(dto, null, 2));

    return 'success';
  }

  async removeMember(dto: RemoveMemberDto): Promise<string> {
    const { channelId, targetMemberId, performerId } = dto;

    return await this.dataSource.transaction(async (manager) => {
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

      // Invalidate cache for target member
      this.cachedService
        .invalidateList(
          CACHE.CHANNEL.TRACKERS.LIST_VERSION(channel.workspaceId, targetMemberId),
        )
        .catch((err) =>
          this.logger.error(`Cache invalidation failed: ${err.message}`),
        );

      // Invalidate channel members list cache
      this.cachedService
        .invalidateList(CACHE.CHANNEL.TRACKERS.MEMBERS_VERSION(channelId))
        .catch((err) =>
          this.logger.error(`Channel members cache invalidation failed: ${err.message}`),
        );

      this.logger.log('Removed member: ', JSON.stringify(dto, null, 2));

      return 'success';
    });
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
    return await this.dataSource.transaction(async (manager) => {
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

      // Invalidate cache for member
      this.cachedService
        .invalidateList(
          CACHE.CHANNEL.TRACKERS.LIST_VERSION(channel.workspaceId, memberId),
        )
        .catch((err) =>
          this.logger.error(`Cache invalidation failed: ${err.message}`),
        );

      // Invalidate channel members list cache
      this.cachedService
        .invalidateList(CACHE.CHANNEL.TRACKERS.MEMBERS_VERSION(channelId))
        .catch((err) =>
          this.logger.error(`Channel members cache invalidation failed: ${err.message}`),
        );

      this.logger.log(
        'User left channel: ',
        JSON.stringify({ channelId, memberId }, null, 2),
      );

      return 'User left channel successfully';
    });
  }
}
