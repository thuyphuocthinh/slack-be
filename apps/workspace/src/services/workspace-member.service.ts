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

    const existingMember = await this.memberRepository.findOne({
      where: { workspaceId: dto.workspaceId, userId: dto.userId },
    });

    if (existingMember && existingMember.status === MembershipStatus.ACTIVE) {
      throw new RpcException({
        statusCode: HttpStatus.CONFLICT,
        ...WORKSPACE_ERROR.ALREADY_MEMBER,
      });
    }

    let member: WorkspaceMemberEntity;
    if (existingMember) {
      existingMember.status = MembershipStatus.ACTIVE;
      existingMember.role = dto.role;
      existingMember.joinedAt = new Date();
      member = await this.memberRepository.save(existingMember);
    } else {
      member = this.memberRepository.create({
        workspaceId: dto.workspaceId,
        userId: dto.userId,
        role: dto.role,
        status: MembershipStatus.ACTIVE,
      });
      member = await this.memberRepository.save(member);
    }

    this.logger.log('Add member', JSON.stringify({ member }));
    this.cachedService.del(CACHE.WORKSPACE.KEYS.MEMBERS(dto.workspaceId));

    return this.commonService.mapMemberToDto(member);
  }

  async removeMember(dto: RemoveMemberRequestDto): Promise<string> {
    await this.commonService.checkPermission(dto.workspaceId, dto.adminUserId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

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

    targetMember.status = MembershipStatus.REMOVED;
    targetMember.removedAt = new Date();
    await this.memberRepository.save(targetMember);

    this.logger.log('Remove member', JSON.stringify({ targetMember }));
    this.cachedService.del(CACHE.WORKSPACE.KEYS.MEMBERS(dto.workspaceId));

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
    this.cachedService.del(CACHE.USER_WORKSPACE.KEYS.LIST(dto.userId));

    return 'Left workspace successfully';
  }

  async changeRole(
    dto: ChangeRoleRequestDto,
  ): Promise<WorkspaceMemberResponseDto> {
    await this.commonService.checkPermission(dto.workspaceId, dto.adminUserId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

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

    targetMember.role = dto.newRole;
    const updatedMember = await this.memberRepository.save(targetMember);

    this.logger.log(
      'Change role',
      JSON.stringify({ targetMember, updatedMember }),
    );
    this.cachedService.del(CACHE.WORKSPACE.KEYS.MEMBERS(dto.workspaceId));

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

          return {
            ...this.commonService.mapMemberToDto(member),
            firstName: user?.firstName ?? null,
            lastName: user?.lastName ?? null,
            email: user?.email ?? null,
            avatarUrl: user?.avatarUrl ?? null,
            systemRole: user?.systemRole ?? null,
          };
        });
      },
    );
  }

  async addBatchMembers(
    dto: AddBatchMembersRequestDto,
  ): Promise<WorkspaceMemberResponseDto[]> {
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

    const existingMembers = await this.memberRepository.find({
      where: {
        workspaceId: dto.workspaceId,
        userId: In(dto.userIds),
      },
    });

    const existingMap = new Map(existingMembers.map((m) => [m.userId, m]));

    let savedMembers: WorkspaceMemberEntity[] = [];

    await this.dataSource.transaction(async (manager) => {
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

    return savedMembers.map((member) => {
      const user = userMap.get(member.userId);

      return {
        ...this.commonService.mapMemberToDto(member),
        firstName: user?.firstName ?? null,
        lastName: user?.lastName ?? null,
        email: user?.email ?? null,
        avatarUrl: user?.avatarUrl ?? null,
        systemRole: user?.systemRole ?? null,
      };
    });
  }
}
