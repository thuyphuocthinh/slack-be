import { Injectable, HttpStatus, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { WorkspaceMemberEntity } from '../entity/workspace_member.entity';
import { WorkspaceRoleEnum, MembershipStatus } from '../types/workspace.enum';
import {
  NAME_SERVICE_TCP,
  USER_MESSAGE_PATTERNS,
  WORKSPACE_ERROR,
  CHANNEL_MESSAGE_PATTERN,
} from '@slack/constants';
import {
  AddMemberRequestDto,
  RemoveMemberRequestDto,
  LeaveWorkspaceRequestDto,
  ChangeRoleRequestDto,
  TransferOwnershipRequestDto,
  AddBatchMembersRequestDto,
} from '../dto/workspace-request.dto';
import { WorkspaceMemberResponseDto } from '../dto/workspace-response.dto';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { firstValueFrom } from 'rxjs';
import { UserType } from '../types/user.type';
import { WorkspaceCommonService } from './workspace-common.service';

@Injectable()
export class WorkspaceMemberService {
  private readonly logger = new Logger(WorkspaceMemberService.name);

  constructor(
    @InjectRepository(WorkspaceMemberEntity)
    private readonly memberRepository: Repository<WorkspaceMemberEntity>,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
    private readonly commonService: WorkspaceCommonService,
  ) {}

  async addMember(
    dto: AddMemberRequestDto,
  ): Promise<WorkspaceMemberResponseDto> {
    await this.commonService.checkPermission(dto.workspaceId, dto.adminUserId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

    await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, {
        id: dto.userId,
      }),
    );

    const member = await this.dataSource.transaction(async (manager) => {
      const existingMember = await manager.findOne(WorkspaceMemberEntity, {
        where: { workspaceId: dto.workspaceId, userId: dto.userId },
      });

      if (existingMember && existingMember.status === MembershipStatus.ACTIVE) {
        throw new RpcException({
          statusCode: HttpStatus.CONFLICT,
          ...WORKSPACE_ERROR.ALREADY_MEMBER,
        });
      }

      if (existingMember) {
        existingMember.status = MembershipStatus.ACTIVE;
        existingMember.role = dto.role;
        existingMember.joinedAt = new Date();
        return await manager.save(existingMember);
      } else {
        const newMember = manager.create(WorkspaceMemberEntity, {
          workspaceId: dto.workspaceId,
          userId: dto.userId,
          role: dto.role,
          status: MembershipStatus.ACTIVE,
        });
        return await manager.save(newMember);
      }
    });

    this.logger.log('Add member', JSON.stringify({ member }));
    this.cachedService.del(CACHE.WORKSPACE.KEYS.MEMBERS(dto.workspaceId));
    this.cachedService.del(
      CACHE.WORKSPACE.KEYS.IS_MEMBER(dto.workspaceId, dto.userId),
    );
    await this.cachedService.invalidateList(
      CACHE.USER_WORKSPACE.TRACKERS.LIST_VERSION(dto.userId),
    );

    return this.commonService.mapMemberToDto(member);
  }

  async removeMember(dto: RemoveMemberRequestDto): Promise<string> {
    const adminMember = await this.commonService.checkPermission(
      dto.workspaceId,
      dto.adminUserId,
      [WorkspaceRoleEnum.OWNER, WorkspaceRoleEnum.ADMIN],
    );

    const targetMember = await this.memberRepository.findOne({
      where: {
        workspaceId: dto.workspaceId,
        userId: dto.targetUserId,
        status: MembershipStatus.ACTIVE,
      },
    });

    if (!targetMember) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...WORKSPACE_ERROR.MEMBER_NOT_FOUND,
      });
    }

    if (targetMember.role === WorkspaceRoleEnum.OWNER) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...WORKSPACE_ERROR.CANNOT_REMOVE_OWNER,
      });
    }

    // Role Hierarchy Check: ADMIN cannot remove another ADMIN
    if (
      adminMember.role === WorkspaceRoleEnum.ADMIN &&
      targetMember.role === WorkspaceRoleEnum.ADMIN
    ) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...WORKSPACE_ERROR.NOT_ALLOWED,
      });
    }

    targetMember.status = MembershipStatus.REMOVED;
    targetMember.removedAt = new Date();
    await this.memberRepository.save(targetMember);

    this.logger.log('Remove member', JSON.stringify({ targetMember }));
    this.cachedService.del(CACHE.WORKSPACE.KEYS.MEMBERS(dto.workspaceId));
    this.cachedService.del(
      CACHE.WORKSPACE.KEYS.IS_MEMBER(dto.workspaceId, dto.targetUserId),
    );
    await this.cachedService.invalidateList(
      CACHE.USER_WORKSPACE.TRACKERS.LIST_VERSION(dto.targetUserId),
    );

    // Cleanup channel memberships
    this.channelClient.emit(
      CHANNEL_MESSAGE_PATTERN.REMOVE_MEMBER_FROM_ALL_CHANNELS,
      {
        workspaceId: dto.workspaceId,
        memberId: dto.targetUserId,
      },
    );

    return 'Member removed successfully';
  }

  async leaveWorkspace(dto: LeaveWorkspaceRequestDto): Promise<string> {
    const member = await this.memberRepository.findOne({
      where: {
        workspaceId: dto.workspaceId,
        userId: dto.userId,
        status: MembershipStatus.ACTIVE,
      },
    });

    if (!member) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...WORKSPACE_ERROR.MEMBER_NOT_FOUND,
      });
    }

    if (member.role === WorkspaceRoleEnum.OWNER) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...WORKSPACE_ERROR.CANNOT_LEAVE_WORKSPACE,
      });
    }

    member.status = MembershipStatus.REMOVED;
    member.removedAt = new Date();
    await this.memberRepository.save(member);

    this.logger.log('Leave workspace', JSON.stringify({ member }));
    await this.cachedService.invalidateList(
      CACHE.USER_WORKSPACE.TRACKERS.LIST_VERSION(dto.userId),
    );
    this.cachedService.del(CACHE.WORKSPACE.KEYS.MEMBERS(dto.workspaceId));
    this.cachedService.del(
      CACHE.WORKSPACE.KEYS.IS_MEMBER(dto.workspaceId, dto.userId),
    );

    // Cleanup channel memberships
    this.channelClient.emit(
      CHANNEL_MESSAGE_PATTERN.REMOVE_MEMBER_FROM_ALL_CHANNELS,
      {
        workspaceId: dto.workspaceId,
        memberId: dto.userId,
      },
    );

    return 'Left workspace successfully';
  }

  async changeRole(
    dto: ChangeRoleRequestDto,
  ): Promise<WorkspaceMemberResponseDto> {
    const adminMember = await this.commonService.checkPermission(
      dto.workspaceId,
      dto.adminUserId,
      [WorkspaceRoleEnum.OWNER, WorkspaceRoleEnum.ADMIN],
    );

    const targetMember = await this.memberRepository.findOne({
      where: {
        workspaceId: dto.workspaceId,
        userId: dto.targetUserId,
        status: MembershipStatus.ACTIVE,
      },
    });

    if (!targetMember) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...WORKSPACE_ERROR.MEMBER_NOT_FOUND,
      });
    }

    if (targetMember.role === WorkspaceRoleEnum.OWNER) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...WORKSPACE_ERROR.CANNOT_REMOVE_OWNER,
      });
    }

    // Role Hierarchy Check: ADMIN cannot change another ADMIN
    if (
      adminMember.role === WorkspaceRoleEnum.ADMIN &&
      targetMember.role === WorkspaceRoleEnum.ADMIN
    ) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...WORKSPACE_ERROR.NOT_ALLOWED,
      });
    }

    targetMember.role = dto.newRole;
    const updatedMember = await this.memberRepository.save(targetMember);

    this.logger.log(
      'Change role',
      JSON.stringify({ targetMember, updatedMember }),
    );
    this.cachedService.del(CACHE.WORKSPACE.KEYS.MEMBERS(dto.workspaceId));
    this.cachedService.del(
      CACHE.WORKSPACE.KEYS.IS_MEMBER(dto.workspaceId, dto.targetUserId),
    );

    return this.commonService.mapMemberToDto(updatedMember);
  }

  async transferOwnership(dto: TransferOwnershipRequestDto): Promise<string> {
    const currentOwner = await this.memberRepository.findOne({
      where: {
        workspaceId: dto.workspaceId,
        userId: dto.ownerUserId,
        role: WorkspaceRoleEnum.OWNER,
        status: MembershipStatus.ACTIVE,
      },
    });

    if (!currentOwner) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...WORKSPACE_ERROR.NOT_ALLOWED,
      });
    }

    const targetMember = await this.memberRepository.findOne({
      where: {
        workspaceId: dto.workspaceId,
        userId: dto.targetUserId,
        status: MembershipStatus.ACTIVE,
      },
    });

    if (!targetMember) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...WORKSPACE_ERROR.MEMBER_NOT_FOUND,
      });
    }

    await this.dataSource.transaction(async (manager) => {
      currentOwner.role = WorkspaceRoleEnum.ADMIN;
      await manager.save(currentOwner);

      targetMember.role = WorkspaceRoleEnum.OWNER;
      await manager.save(targetMember);
    });

    this.logger.log(
      'Transfer ownership',
      JSON.stringify({ currentOwner, targetMember }),
    );

    // Invalidate members list cache because roles changed
    await this.cachedService.del(CACHE.WORKSPACE.KEYS.MEMBERS(dto.workspaceId));

    // Invalidate individual membership cache
    this.cachedService.del(
      CACHE.WORKSPACE.KEYS.IS_MEMBER(dto.workspaceId, dto.ownerUserId),
    );
    this.cachedService.del(
      CACHE.WORKSPACE.KEYS.IS_MEMBER(dto.workspaceId, dto.targetUserId),
    );

    return 'Ownership transferred successfully';
  }

  async getListMembersOfWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMemberResponseDto[]> {
    await this.commonService.isMemberOfWorkspace(workspaceId, userId);
    return this.cachedService.getOrSetDetail(
      CACHE.WORKSPACE.KEYS.MEMBERS(workspaceId),
      TTL.LONG,
      async () => {
        const members = await this.memberRepository.find({
          where: { workspaceId, status: MembershipStatus.ACTIVE },
        });

        const userIds = [...new Set(members.map((m) => m.userId))];

        const users = await firstValueFrom(
          this.userClient.send(USER_MESSAGE_PATTERNS.GET_BATCH_USER_BY_IDS, {
            ids: userIds,
          }),
        );

        const userMap = new Map(users.map((u) => [u.id, u]));

        return members.map((member) => {
          const user = userMap.get(member.userId) as UserType;
          return this.commonService.mapMemberWithUserToDto(member, user);
        });
      },
    );
  }

  async addBatchMembers(
    dto: AddBatchMembersRequestDto,
  ): Promise<WorkspaceMemberResponseDto[]> {
    if (dto.userIds.length > 20) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        ...WORKSPACE_ERROR.BATCH_SIZE_EXCEEDS_LIMIT,
      });
    }

    await this.commonService.checkPermission(dto.workspaceId, dto.adminUserId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

    const users: UserType[] = await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_BATCH_USER_BY_IDS, {
        ids: dto.userIds,
      }),
    );

    const userMap = new Map(users.map((u) => [u.id, u]));

    let savedMembers: WorkspaceMemberEntity[] = [];

    await this.dataSource.transaction(async (manager) => {
      const existingMembers = await manager.find(WorkspaceMemberEntity, {
        where: {
          workspaceId: dto.workspaceId,
          userId: In(dto.userIds),
        },
        lock: { mode: 'pessimistic_write' },
      });

      const existingMap = new Map(existingMembers.map((m) => [m.userId, m]));
      const toSave: WorkspaceMemberEntity[] = [];

      for (const userId of dto.userIds) {
        const existing = existingMap.get(userId);

        if (existing) {
          if (existing.status !== MembershipStatus.ACTIVE) {
            existing.status = MembershipStatus.ACTIVE;
            existing.role = dto.role ?? existing.role;
            existing.joinedAt = new Date();
            toSave.push(existing);
          }
          continue;
        }

        const member = manager.create(WorkspaceMemberEntity, {
          workspaceId: dto.workspaceId,
          userId,
          role: dto.role ?? WorkspaceRoleEnum.MEMBER,
          status: MembershipStatus.ACTIVE,
        });

        toSave.push(member);
      }

      savedMembers = await manager.save(toSave);
    });

    await this.cachedService.del(CACHE.WORKSPACE.KEYS.MEMBERS(dto.workspaceId));

    // Invalidate individual membership cache
    const isMemberKeys = dto.userIds.map((userId) =>
      CACHE.WORKSPACE.KEYS.IS_MEMBER(dto.workspaceId, userId),
    );
    await Promise.all(isMemberKeys.map((key) => this.cachedService.del(key)));

    // Invalidate workspace list cache for all added/updated users
    const trackerKeys = dto.userIds.map((userId) =>
      CACHE.USER_WORKSPACE.TRACKERS.LIST_VERSION(userId),
    );
    await this.cachedService.invalidateListBulk(trackerKeys);

    return savedMembers.map((member) => {
      const user = userMap.get(member.userId);
      return this.commonService.mapMemberWithUserToDto(member, user);
    });
  }

  async getMemberByUserId(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMemberEntity> {
    const member = await this.memberRepository.findOne({
      where: { workspaceId, userId, status: MembershipStatus.ACTIVE },
    });
    if (!member) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...WORKSPACE_ERROR.MEMBER_NOT_FOUND,
      });
    }
    return member;
  }

  async getMemberDetail(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMemberResponseDto> {
    const member = await this.getMemberByUserId(workspaceId, userId);

    const user = await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, {
        id: userId,
      }),
    );

    return this.commonService.mapMemberWithUserToDto(member, user);
  }

  async addMemberSso(dto: { workspaceId: string; userId: string }): Promise<WorkspaceMemberResponseDto> {
    await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_ID, {
        id: dto.userId,
      }),
    );

    const member = await this.dataSource.transaction(async (manager) => {
      const existingMember = await manager.findOne(WorkspaceMemberEntity, {
        where: { workspaceId: dto.workspaceId, userId: dto.userId },
      });

      if (existingMember && existingMember.status === MembershipStatus.ACTIVE) {
        return existingMember;
      }

      if (existingMember) {
        existingMember.status = MembershipStatus.ACTIVE;
        existingMember.role = WorkspaceRoleEnum.MEMBER;
        existingMember.joinedAt = new Date();
        return await manager.save(existingMember);
      } else {
        const newMember = manager.create(WorkspaceMemberEntity, {
          workspaceId: dto.workspaceId,
          userId: dto.userId,
          role: WorkspaceRoleEnum.MEMBER,
          status: MembershipStatus.ACTIVE,
        });
        return await manager.save(newMember);
      }
    });

    this.logger.log('Add member SSO', JSON.stringify({ member }));
    this.cachedService.del(CACHE.WORKSPACE.KEYS.MEMBERS(dto.workspaceId));
    this.cachedService.del(
      CACHE.WORKSPACE.KEYS.IS_MEMBER(dto.workspaceId, dto.userId),
    );
    await this.cachedService.invalidateList(
      CACHE.USER_WORKSPACE.TRACKERS.LIST_VERSION(dto.userId),
    );

    return this.commonService.mapMemberToDto(member);
  }
}
