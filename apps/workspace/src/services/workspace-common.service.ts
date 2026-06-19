import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { WorkspaceMemberEntity } from '../entity/workspace_member.entity';
import { WorkspaceEntity } from '../entity/workspace.entity';
import { WorkspaceInviteEntity } from '../entity/workspace_invite.entity';
import { WorkspaceLinkEntity } from '../entity/workspace_link.entity';
import { WorkspaceSsoConfigEntity } from '../entity/workspace_sso_config.entity';
import { WorkspaceRoleEnum, MembershipStatus } from '../types/workspace.enum';
import { WORKSPACE_ERROR } from '@slack/constants';
import {
  WorkspaceDto,
  WorkspaceMemberDto,
  WorkspaceInviteDto,
  WorkspaceSsoConfigDto,
} from '../dto/workspace.dto';
import { WorkspaceLinkResponseDto } from '../dto/workspace-response.dto';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { UserType } from '../types/user.type';

@Injectable()
export class WorkspaceCommonService {
  private readonly logger = new Logger(WorkspaceCommonService.name);

  constructor(
    @InjectRepository(WorkspaceMemberEntity)
    private readonly memberRepository: Repository<WorkspaceMemberEntity>,
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly cachedService: CachedService,
  ) {}

  mapWorkspaceToDto(workspace: WorkspaceEntity): WorkspaceDto {
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

  mapMemberToDto(member: WorkspaceMemberEntity): WorkspaceMemberDto {
    return {
      workspaceId: member.workspaceId,
      userId: member.userId,
      role: member.role,
      employmentType: member.employmentType,
      status: member.status,
      joinedAt: member.joinedAt,
      createdAt: member.createdAt,
    };
  }

  mapMemberWithUserToDto(
    member: WorkspaceMemberEntity,
    user?: UserType,
  ): WorkspaceMemberDto {
    return {
      ...this.mapMemberToDto(member),
      firstName: user?.firstName ?? null,
      lastName: user?.lastName ?? null,
      email: user?.email ?? null,
      avatarUrl: user?.avatarUrl ?? null,
      systemRole: user?.systemRole ?? null,
    };
  }

  mapInviteToDto(invite: WorkspaceInviteEntity): WorkspaceInviteDto {
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

  mapLinkToDto(link: WorkspaceLinkEntity): WorkspaceLinkResponseDto {
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

  mapSsoConfigToDto(
    config: WorkspaceSsoConfigEntity,
    maskSecret = true,
  ): WorkspaceSsoConfigDto {
    return {
      id: config.id,
      workspaceId: config.workspaceId,
      domain: config.domain,
      providerType: config.providerType,
      entryPoint: config.entryPoint,
      idpCert: config.idpCert,
      issuer: config.issuer,
      clientId: config.clientId,
      clientSecret: config.clientSecret
        ? maskSecret
          ? '********'
          : config.clientSecret
        : undefined,
      discoveryUrl: config.discoveryUrl,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  async isMemberOfWorkspace(
    workspaceId: string,
    userId: string,
  ): Promise<boolean> {
    await this.findWorkspaceById(workspaceId);

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
      if (error instanceof RpcException) throw error;
      this.logger.error('Error checking member of workspace', error);
      throw error;
    }

    return true;
  }

  async checkPermission(
    workspaceId: string,
    userId: string,
    allowedRoles: WorkspaceRoleEnum[],
  ): Promise<WorkspaceMemberEntity> {
    await this.findWorkspaceById(workspaceId);

    try {
      const key = CACHE.WORKSPACE.KEYS.IS_MEMBER(workspaceId, userId);
      const member = await this.cachedService.getOrSetDetail(
        key,
        TTL.SHORT,
        async () => {
          return this.memberRepository.findOne({
            where: { workspaceId, userId, status: MembershipStatus.ACTIVE },
          });
        },
      );

      if (!member || !allowedRoles.includes(member.role)) {
        throw new RpcException({
          statusCode: HttpStatus.FORBIDDEN,
          ...WORKSPACE_ERROR.NOT_ALLOWED,
        });
      }
      return member;
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error('Error checking member of workspace', error);
      throw error;
    }
  }

  async findWorkspaceById(workspaceId: string) {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(workspaceId)) {
      throw new RpcException({
        statusCode: HttpStatus.NOT_FOUND,
        ...WORKSPACE_ERROR.WORKSPACE_NOT_FOUND,
      });
    }

    const key = CACHE.WORKSPACE.KEYS.DETAIL(workspaceId);
    try {
      const workspace = await this.cachedService.getOrSetDetail(
        key,
        TTL.MEDIUM,
        async () => {
          return this.workspaceRepository.findOne({
            where: { id: workspaceId },
          });
        },
      );

      if (!workspace) {
        throw new RpcException({
          statusCode: HttpStatus.NOT_FOUND,
          ...WORKSPACE_ERROR.WORKSPACE_NOT_FOUND,
        });
      }
      return workspace;
    } catch (error) {
      if (error instanceof RpcException) throw error;
      // Handle potential DB errors like invalid UUID format that might have bypassed the regex
      if ((error as any).code === '22P02') {
        throw new RpcException({
          statusCode: HttpStatus.NOT_FOUND,
          ...WORKSPACE_ERROR.WORKSPACE_NOT_FOUND,
        });
      }
      this.logger.error('Error finding workspace', error);
      throw error;
    }
  }
}
