import { Injectable, HttpStatus, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull, In } from 'typeorm';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { WorkspaceEntity } from './entity/workspace.entity';
import { WorkspaceMemberEntity } from './entity/workspace_member.entity';
import { WorkspaceInviteEntity } from './entity/workspace_invite.entity';
import { WorkspaceLinkEntity } from './entity/workspace_link.entity';
import {
  WorkspaceRoleEnum,
  MembershipStatus,
  InviteStatus,
  WorkspaceLinkStatus,
} from './types/workspace.enum';
import {
  DATABASE_ERROR,
  NAME_SERVICE_TCP,
  NOTIFICATION_MESSAGE_PATTERNS,
  USER_MESSAGE_PATTERNS,
  WORKSPACE_ERROR,
} from '@slack/constants';
import {
  CreateWorkspaceRequestDto,
  InviteMemberRequestDto,
  AddMemberRequestDto,
  RemoveMemberRequestDto,
  JoinWorkspaceRequestDto,
  LeaveWorkspaceRequestDto,
  ChangeRoleRequestDto,
  TransferOwnershipRequestDto,
  DeleteWorkspaceRequestDto,
  ResendInviteRequestDto,
  RevokeInviteRequestDto,
  GenerateLinkRequestDto,
  JoinLinkRequestDto,
  DisableLinkRequestDto,
  DeleteLinkRequestDto,
  UpdateWorkspaceRequestDto,
} from './dto/workspace-request.dto';
import {
  WorkspaceResponseDto,
  WorkspaceMemberResponseDto,
  WorkspaceInviteResponseDto,
  WorkspaceLinkResponseDto,
} from './dto/workspace-response.dto';
import {
  WorkspaceDto,
  WorkspaceMemberDto,
  WorkspaceInviteDto,
} from './dto/workspace.dto';
import { v7 } from 'uuid';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { generateSlug } from '@slack/common';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectRepository(WorkspaceMemberEntity)
    private readonly memberRepository: Repository<WorkspaceMemberEntity>,
    @InjectRepository(WorkspaceInviteEntity)
    private readonly inviteRepository: Repository<WorkspaceInviteEntity>,
    @InjectRepository(WorkspaceLinkEntity)
    private readonly linkRepository: Repository<WorkspaceLinkEntity>,
    @Inject(NAME_SERVICE_TCP.NOTIFICATION_SERVICE)
    private readonly notificationClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
  ) {}

  private mapWorkspaceToDto(workspace: WorkspaceEntity): WorkspaceDto {
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      description: workspace.description,
      logo: workspace.logo,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    };
  }

  private mapMemberToDto(member: WorkspaceMemberEntity): WorkspaceMemberDto {
    return {
      id: member.id,
      workspaceId: member.workspaceId,
      userId: member.userId,
      role: member.role,
      status: member.status,
      joinedAt: member.joinedAt,
      createdAt: member.createdAt,
    };
  }

  private mapInviteToDto(invite: WorkspaceInviteEntity): WorkspaceInviteDto {
    return {
      id: invite.id,
      workspaceId: invite.workspaceId,
      email: invite.email,
      role: invite.role,
      status: invite.status,
      invitedBy: invite.invitedBy,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    };
  }

  private mapLinkToDto(link: WorkspaceLinkEntity): WorkspaceLinkResponseDto {
    return {
      id: link.id,
      workspaceId: link.workspaceId,
      token: link.tokenHash,
      type: link.type,
      status: link.status,
      maxUsage: link.maxUsage,
      usedCount: link.usedCount,
      createdAt: link.createdAt,
    };
  }

  // create workspace
  async createWorkspace(
    dto: CreateWorkspaceRequestDto,
  ): Promise<WorkspaceResponseDto> {
    for (let i = 0; i < 3; i++) {
      const slug = generateSlug(dto.name);

      try {
        const savedWorkspace = await this.dataSource.transaction(
          async (manager) => {
            const workspace = manager.create(WorkspaceEntity, {
              name: dto.name,
              description: dto.description,
              slug,
            });
            const ws = await manager.save(workspace);

            const member = manager.create(WorkspaceMemberEntity, {
              workspaceId: ws.id,
              userId: dto.ownerUserId,
              role: WorkspaceRoleEnum.OWNER,
              status: MembershipStatus.ACTIVE,
            });
            await manager.save(member);

            return ws;
          },
        );

        await this.cachedService.del(
          CACHE.USER_WORKSPACE.KEYS.LIST(dto.ownerUserId),
        );

        return this.mapWorkspaceToDto(savedWorkspace);
      } catch (err) {
        if (err.code === '23505') continue; // duplicate slug → retry
        throw err;
      }
    }

    throw new RpcException({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      ...WORKSPACE_ERROR.FAILED_TO_CREATE_WORKSPACE,
    });
  }

  // update workspace
  async updateWorkspace(
    dto: UpdateWorkspaceRequestDto,
  ): Promise<WorkspaceResponseDto> {
    await this.checkPermission(dto.workspaceId, dto.updatedBy, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

    const workspace = await this.workspaceRepository.findOne({
      where: { id: dto.workspaceId, deletedAt: IsNull() },
    });
    if (!workspace) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...WORKSPACE_ERROR.WORKSPACE_NOT_FOUND,
      });
    }
    if (dto.name) {
      workspace.name = dto.name;
    }
    if (dto.description) {
      workspace.description = dto.description;
    }

    const updatedWorkspace = await this.workspaceRepository.save(workspace);

    await this.cachedService.del(CACHE.WORKSPACE.KEYS.DETAIL(dto.workspaceId));

    return this.mapWorkspaceToDto(updatedWorkspace);
  }

  // detail workspace
  async getDetailWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceDto> {
    // check permission
    await this.isMemberOfWorkspace(workspaceId, userId);
    return this.cachedService.getOrSetDetail(
      CACHE.WORKSPACE.KEYS.DETAIL(workspaceId),
      TTL.LONG,
      async () => {
        const workspace = await this.workspaceRepository.findOne({
          where: { id: workspaceId, deletedAt: IsNull() },
        });
        if (!workspace) {
          throw new RpcException(WORKSPACE_ERROR.WORKSPACE_NOT_FOUND);
        }
        return this.mapWorkspaceToDto(workspace);
      },
    );
  }

  // invite member
  async inviteMember(
    dto: InviteMemberRequestDto,
  ): Promise<WorkspaceInviteResponseDto> {
    await this.checkPermission(dto.workspaceId, dto.invitedBy, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

    const existingMember = await this.memberRepository.findOne({
      where: {
        workspaceId: dto.workspaceId,
        userId: dto.email,
        status: MembershipStatus.ACTIVE,
      },
    });
    if (existingMember) {
      throw new RpcException({
        statusCode: HttpStatus.CONFLICT,
        ...WORKSPACE_ERROR.ALREADY_MEMBER,
      });
    }

    const token = v7();
    const invite = this.inviteRepository.create({
      workspaceId: dto.workspaceId,
      email: dto.email,
      role: dto.role,
      invitedBy: dto.invitedBy,
      tokenHash: token,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });

    const savedInvite = await this.inviteRepository.save(invite);

    const workspace = await this.workspaceRepository.findOne({
      where: { id: dto.workspaceId, deletedAt: IsNull() },
    });

    this.notificationClient.emit(NOTIFICATION_MESSAGE_PATTERNS.SEND_MAIL, {
      to: dto.email,
      subject: 'Invite to workspace',
      template: 'workspace_invitation',
      context: {
        workspaceName: workspace?.name,
        token,
      },
    });
    this.logger.log('Invite member', savedInvite);
    return this.mapInviteToDto(savedInvite);
  }

  // add member direct
  async addMember(
    dto: AddMemberRequestDto,
  ): Promise<WorkspaceMemberResponseDto> {
    await this.checkPermission(dto.workspaceId, dto.adminUserId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

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

    this.cachedService.del(CACHE.USER_WORKSPACE.KEYS.LIST(dto.userId));

    return this.mapMemberToDto(member);
  }

  // remove member
  async removeMember(dto: RemoveMemberRequestDto): Promise<string> {
    await this.checkPermission(dto.workspaceId, dto.adminUserId, [
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

    this.cachedService.del(CACHE.USER_WORKSPACE.KEYS.LIST(dto.targetUserId));

    return 'Member removed successfully';
  }

  // join workspace by invite token
  async joinWorkspace(
    dto: JoinWorkspaceRequestDto,
  ): Promise<WorkspaceMemberResponseDto> {
    const invite = await this.inviteRepository.findOne({
      where: { tokenHash: dto.token, status: InviteStatus.PENDING },
    });

    if (!invite || invite.expiresAt < new Date()) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        ...WORKSPACE_ERROR.INVALID_OR_EXPIRED_TOKEN,
      });
    }

    const savedMember = await this.dataSource.transaction(async (manager) => {
      invite.status = InviteStatus.ACCEPTED;
      invite.acceptedAt = new Date();
      await manager.save(invite);

      const member = manager.create(WorkspaceMemberEntity, {
        workspaceId: invite.workspaceId,
        userId: dto.userId,
        role: invite.role,
        status: MembershipStatus.ACTIVE,
      });
      return await manager.save(member);
    });

    this.logger.log('Join workspace', JSON.stringify({ savedMember }));

    this.cachedService.del(CACHE.USER_WORKSPACE.KEYS.LIST(dto.userId));

    return this.mapMemberToDto(savedMember);
  }

  // leave workspace
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
        ...WORKSPACE_ERROR.CANNOT_REMOVE_OWNER,
      });
    }

    member.status = MembershipStatus.REMOVED;
    member.removedAt = new Date();
    await this.memberRepository.save(member);

    this.logger.log('Leave workspace', JSON.stringify({ member }));

    this.cachedService.del(CACHE.USER_WORKSPACE.KEYS.LIST(dto.userId));

    return 'Left workspace successfully';
  }

  // change role of member
  async changeRole(
    dto: ChangeRoleRequestDto,
  ): Promise<WorkspaceMemberResponseDto> {
    await this.checkPermission(dto.workspaceId, dto.adminUserId, [
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

    return this.mapMemberToDto(updatedMember);
  }

  // transfer ownership
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

  // delete workspace by owner
  async deleteWorkspace(dto: DeleteWorkspaceRequestDto): Promise<string> {
    await this.checkPermission(dto.workspaceId, dto.ownerUserId, [
      WorkspaceRoleEnum.OWNER,
    ]);

    const workspace = await this.workspaceRepository.findOne({
      where: { id: dto.workspaceId, deletedAt: IsNull() },
    });

    if (!workspace) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...WORKSPACE_ERROR.WORKSPACE_NOT_FOUND,
      });
    }

    workspace.deletedAt = new Date();
    await this.workspaceRepository.save(workspace);

    // cần invalidate tất cả member của workspace
    const members = await this.memberRepository.find({
      where: { workspaceId: workspace.id },
    });

    for (const m of members) {
      await this.cachedService.del(CACHE.USER_WORKSPACE.KEYS.LIST(m.userId));
    }

    this.logger.log('Delete workspace', JSON.stringify(workspace));

    // delete cached
    this.cachedService.del(CACHE.WORKSPACE.KEYS.DETAIL(workspace.id));

    return 'Workspace deleted successfully';
  }

  // resend invite
  async resendInvite(
    dto: ResendInviteRequestDto,
  ): Promise<WorkspaceInviteResponseDto> {
    const invite = await this.inviteRepository.findOne({
      where: { id: dto.inviteId },
    });

    if (!invite) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...WORKSPACE_ERROR.INVITE_NOT_FOUND,
      });
    }

    await this.checkPermission(invite.workspaceId, dto.adminUserId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

    invite.tokenHash = v7();
    invite.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    invite.status = InviteStatus.PENDING;

    const updatedInvite = await this.inviteRepository.save(invite);

    const workspace = await this.workspaceRepository.findOne({
      where: { id: invite.workspaceId, deletedAt: IsNull() },
    });

    this.notificationClient.emit(NOTIFICATION_MESSAGE_PATTERNS.SEND_MAIL, {
      to: invite.email,
      subject: 'Invite to workspace',
      template: 'workspace_invitation',
      context: {
        workspaceName: workspace?.name,
        token: updatedInvite.tokenHash,
      },
    });
    this.logger.log('Resend invite', updatedInvite);
    return this.mapInviteToDto(updatedInvite);
  }

  // revoke invite
  async revokeInvite(dto: RevokeInviteRequestDto): Promise<string> {
    const invite = await this.inviteRepository.findOne({
      where: { id: dto.inviteId },
    });

    if (!invite) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...WORKSPACE_ERROR.INVITE_NOT_FOUND,
      });
    }

    await this.checkPermission(invite.workspaceId, dto.adminUserId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

    invite.status = InviteStatus.REVOKED;
    await this.inviteRepository.save(invite);

    this.logger.log('Revoke invite', invite);

    return 'Invitation revoked successfully';
  }

  // generate PUBLIC INVITE link
  async generateLink(
    dto: GenerateLinkRequestDto,
  ): Promise<WorkspaceLinkResponseDto> {
    await this.checkPermission(dto.workspaceId, dto.adminUserId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

    const link = await this.linkRepository.save({
      workspaceId: dto.workspaceId,
      tokenHash: v7(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: WorkspaceLinkStatus.ACTIVE,
      maxUsage: dto.maxUsage,
    });

    this.logger.log('Generate link', link);

    return this.mapLinkToDto(link);
  }

  async getLinks(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceLinkResponseDto[]> {
    await this.checkPermission(workspaceId, userId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);
    const links = await this.linkRepository.find({
      where: { workspaceId },
    });
    return links.map((link) => this.mapLinkToDto(link));
  }

  // join link
  async joinLink(dto: JoinLinkRequestDto): Promise<WorkspaceMemberResponseDto> {
    const link = await this.linkRepository.findOne({
      where: { tokenHash: dto.token },
    });

    if (!link) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...WORKSPACE_ERROR.LINK_NOT_FOUND,
      });
    }

    if (
      link.status === WorkspaceLinkStatus.EXPIRED ||
      link.expiresAt < new Date()
    ) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        ...WORKSPACE_ERROR.LINK_EXPIRED,
      });
    }

    if (link.usedCount >= link.maxUsage) {
      throw new RpcException({
        statusCode: HttpStatus.BAD_REQUEST,
        ...WORKSPACE_ERROR.LINK_MAX_USAGE,
      });
    }

    const member = await this.memberRepository.findOne({
      where: { workspaceId: link.workspaceId, userId: dto.userId },
    });

    if (member) {
      throw new RpcException({
        statusCode: HttpStatus.CONFLICT,
        ...WORKSPACE_ERROR.ALREADY_MEMBER,
      });
    }

    const newMember = this.memberRepository.create({
      workspaceId: link.workspaceId,
      userId: dto.userId,
      role: WorkspaceRoleEnum.MEMBER,
      status: MembershipStatus.ACTIVE,
    });

    await this.dataSource.transaction(async (manager) => {
      await manager.save(newMember);
      link.usedCount++;
      await manager.save(link);
    });

    this.logger.log('Join link', newMember);

    this.cachedService.del(CACHE.USER_WORKSPACE.KEYS.LIST(dto.userId));

    return this.mapMemberToDto(newMember);
  }

  // disable link
  async disableLink(dto: DisableLinkRequestDto): Promise<string> {
    await this.checkPermission(dto.workspaceId, dto.adminUserId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

    const link = await this.linkRepository.findOne({
      where: { workspaceId: dto.workspaceId, id: dto.linkId },
    });

    if (!link) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...WORKSPACE_ERROR.LINK_NOT_FOUND,
      });
    }

    link.status = WorkspaceLinkStatus.EXPIRED;
    await this.linkRepository.save(link);

    this.logger.log('Disable link', link);

    return 'Link disabled successfully';
  }

  // delete link
  async deleteLink(dto: DeleteLinkRequestDto): Promise<string> {
    await this.checkPermission(dto.workspaceId, dto.adminUserId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

    const link = await this.linkRepository.findOne({
      where: { workspaceId: dto.workspaceId, id: dto.linkId },
    });

    if (!link) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...WORKSPACE_ERROR.LINK_NOT_FOUND,
      });
    }

    await this.linkRepository.remove(link);

    this.logger.log('Delete link', link);

    return 'Link deleted successfully';
  }

  // get list workspace of user (paginations?)
  async getListWorkspaceOfUser(userId: string): Promise<WorkspaceDto[]> {
    const key = CACHE.USER_WORKSPACE.KEYS.LIST(userId);

    const cached = await this.cachedService.get(key);
    if (cached) return cached as WorkspaceDto[];

    const members = await this.memberRepository.find({
      where: { userId, status: MembershipStatus.ACTIVE },
    });

    const workspaceIds = members.map((m) => m.workspaceId);

    if (workspaceIds.length === 0) return [];

    const workspaces = await this.workspaceRepository.find({
      where: { id: In(workspaceIds), deletedAt: IsNull() },
    });

    const res = workspaces.map((w) => this.mapWorkspaceToDto(w));

    await this.cachedService.set(key, res, TTL.LONG);

    return res;
  }

  // get list members of a workspace (pagination?)
  async getListMembersOfWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceMemberResponseDto[]> {
    await this.isMemberOfWorkspace(workspaceId, userId);
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

        return members.map((member) => ({
          ...this.mapMemberToDto(member),
          user: userMap.get(member.userId) ?? null,
        }));
      },
    );
  }

  // Helpers
  private async isMemberOfWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<boolean> {
    const key = CACHE.WORKSPACE.KEYS.IS_MEMBER(workspaceId, userId);
    try {
      const member = await this.cachedService.getOrSetDetail(
        key,
        TTL.SHORT,
        async () => {
          return this.memberRepository.findOne({
            where: {
              workspaceId,
              userId,
              status: MembershipStatus.ACTIVE,
            },
          });
        },
      );

      if (!member) {
        throw new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...WORKSPACE_ERROR.NOT_MEMBER,
        });
      }
    } catch (error) {
      this.logger.error('Error checking member of workspace', error);
      throw new RpcException({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        ...DATABASE_ERROR.NOT_FOUND,
      });
    }

    return true;
  }

  private async checkPermission(
    workspaceId: string,
    userId: string,
    allowedRoles: WorkspaceRoleEnum[],
  ) {
    const member = await this.memberRepository.findOne({
      where: { workspaceId, userId, status: MembershipStatus.ACTIVE },
    });

    if (!member || !allowedRoles.includes(member.role)) {
      throw new RpcException({
        statusCode: HttpStatus.FORBIDDEN,
        ...WORKSPACE_ERROR.NOT_ALLOWED,
      });
    }
  }
}
