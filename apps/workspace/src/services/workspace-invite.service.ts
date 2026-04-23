import { Injectable, HttpStatus, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import { WorkspaceInviteEntity } from '../entity/workspace_invite.entity';
import { WorkspaceMemberEntity } from '../entity/workspace_member.entity';
import {
  WorkspaceRoleEnum,
  MembershipStatus,
  InviteStatus,
} from '../types/workspace.enum';
import {
  NAME_SERVICE_TCP,
  NOTIFICATION_MESSAGE_PATTERNS,
  USER_MESSAGE_PATTERNS,
  WORKSPACE_ERROR,
} from '@slack/constants';
import {
  InviteMemberRequestDto,
  JoinWorkspaceRequestDto,
  ResendInviteRequestDto,
  RevokeInviteRequestDto,
} from '../dto/workspace-request.dto';
import {
  WorkspaceInviteResponseDto,
  WorkspaceMemberResponseDto,
} from '../dto/workspace-response.dto';
import { v7 } from 'uuid';
import { CACHE, CachedService } from '@slack/cached';
import { firstValueFrom } from 'rxjs';
import { WorkspaceCommonService } from './workspace-common.service';
import { buildTTL } from '@slack/common';

@Injectable()
export class WorkspaceInviteService {
  private readonly logger = new Logger(WorkspaceInviteService.name);

  constructor(
    @InjectRepository(WorkspaceInviteEntity)
    private readonly inviteRepository: Repository<WorkspaceInviteEntity>,
    @InjectRepository(WorkspaceMemberEntity)
    private readonly memberRepository: Repository<WorkspaceMemberEntity>,
    @Inject(NAME_SERVICE_TCP.NOTIFICATION_SERVICE)
    private readonly notificationClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userClient: ClientProxy,
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
    private readonly commonService: WorkspaceCommonService,
  ) {}

  async inviteMember(
    dto: InviteMemberRequestDto,
  ): Promise<WorkspaceInviteResponseDto> {
    this.logger.log('Invite member', JSON.stringify(dto));
    await this.commonService.checkPermission(dto.workspaceId, dto.invitedBy, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

    const user = await firstValueFrom(
      this.userClient.send(USER_MESSAGE_PATTERNS.GET_USER_BY_EMAIL, {
        email: dto.email,
      }),
    );

    const savedInvite = await this.dataSource.transaction(async (manager) => {
      if (user) {
        const existingMember = await manager.findOne(WorkspaceMemberEntity, {
          where: {
            workspaceId: dto.workspaceId,
            userId: user.id,
            status: MembershipStatus.ACTIVE,
          },
        });

        if (existingMember) {
          throw new RpcException({
            statusCode: HttpStatus.CONFLICT,
            ...WORKSPACE_ERROR.ALREADY_MEMBER,
          });
        }
      }

      const existingInvite = await manager.findOne(WorkspaceInviteEntity, {
        where: {
          workspaceId: dto.workspaceId,
          email: dto.email,
          status: InviteStatus.PENDING,
        },
      });

      if (existingInvite) {
        throw new RpcException({
          statusCode: HttpStatus.CONFLICT,
          ...WORKSPACE_ERROR.ALREADY_INVITED,
        });
      }

      const token = v7();
      const invite = manager.create(WorkspaceInviteEntity, {
        workspaceId: dto.workspaceId,
        email: dto.email,
        role: dto.role,
        invitedBy: dto.invitedBy,
        tokenHash: token,
        expiresAt: new Date(Date.now() + buildTTL('DAY', 7)),
      });

      return await manager.save(invite);
    });

    const workspace = await this.commonService.findWorkspaceById(
      dto.workspaceId,
    );

    this.notificationClient.emit(NOTIFICATION_MESSAGE_PATTERNS.SEND_MAIL, {
      to: dto.email,
      subject: 'Invite to workspace',
      template: 'workspace_invitation',
      context: {
        workspaceName: workspace?.name,
        token: savedInvite.tokenHash,
      },
    });
    this.logger.log('Invite member', savedInvite);
    return this.commonService.mapInviteToDto(savedInvite);
  }

  async joinWorkspace(
    dto: JoinWorkspaceRequestDto,
  ): Promise<WorkspaceMemberResponseDto> {
    const savedMember = await this.dataSource.transaction(async (manager) => {
      const invite = await manager.findOne(WorkspaceInviteEntity, {
        where: { tokenHash: dto.token, status: InviteStatus.PENDING },
        lock: { mode: 'pessimistic_write' },
      });

      if (!invite || invite.expiresAt < new Date()) {
        throw new RpcException({
          statusCode: HttpStatus.BAD_REQUEST,
          ...WORKSPACE_ERROR.INVALID_OR_EXPIRED_TOKEN,
        });
      }

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
    this.cachedService.del(
      CACHE.WORKSPACE.KEYS.MEMBERS(savedMember.workspaceId),
    );

    return this.commonService.mapMemberToDto(savedMember);
  }

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

    await this.commonService.checkPermission(
      invite.workspaceId,
      dto.adminUserId,
      [WorkspaceRoleEnum.OWNER, WorkspaceRoleEnum.ADMIN],
    );

    invite.tokenHash = v7();
    invite.expiresAt = new Date(Date.now() + buildTTL('DAY', 7));
    invite.status = InviteStatus.PENDING;

    const updatedInvite = await this.inviteRepository.save(invite);

    const workspace = await this.commonService.findWorkspaceById(
      invite.workspaceId,
    );

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
    return this.commonService.mapInviteToDto(updatedInvite);
  }

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

    await this.commonService.checkPermission(
      invite.workspaceId,
      dto.adminUserId,
      [WorkspaceRoleEnum.OWNER, WorkspaceRoleEnum.ADMIN],
    );

    invite.status = InviteStatus.REVOKED;
    await this.inviteRepository.save(invite);

    this.logger.log('Revoke invite', invite);

    return 'Invitation revoked successfully';
  }
}
