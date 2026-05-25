import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { WorkspaceLinkEntity } from '../entity/workspace_link.entity';
import { WorkspaceMemberEntity } from '../entity/workspace_member.entity';
import {
  WorkspaceRoleEnum,
  MembershipStatus,
  WorkspaceLinkStatus,
} from '../types/workspace.enum';
import { WORKSPACE_ERROR } from '@slack/constants';
import {
  GenerateLinkRequestDto,
  JoinLinkRequestDto,
  DisableLinkRequestDto,
  DeleteLinkRequestDto,
} from '../dto/workspace-request.dto';
import {
  WorkspaceLinkResponseDto,
  WorkspaceMemberResponseDto,
} from '../dto/workspace-response.dto';
import { v7 } from 'uuid';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { WorkspaceCommonService } from './workspace-common.service';
import { buildTTL } from '@slack/common';

@Injectable()
export class WorkspaceLinkService {
  private readonly logger = new Logger(WorkspaceLinkService.name);

  constructor(
    @InjectRepository(WorkspaceLinkEntity)
    private readonly linkRepository: Repository<WorkspaceLinkEntity>,
    @InjectRepository(WorkspaceMemberEntity)
    private readonly memberRepository: Repository<WorkspaceMemberEntity>,
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
    private readonly commonService: WorkspaceCommonService,
  ) {}

  async generateLink(
    dto: GenerateLinkRequestDto,
  ): Promise<WorkspaceLinkResponseDto> {
    await this.commonService.checkPermission(dto.workspaceId, dto.adminUserId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

    const link = await this.linkRepository.save({
      workspaceId: dto.workspaceId,
      tokenHash: v7(),
      expiresAt: new Date(Date.now() + buildTTL('DAY', 7)),
      status: WorkspaceLinkStatus.ACTIVE,
      maxUsage: dto.maxUsage,
    });

    this.logger.log('Generate link', link);
    this.cachedService.del(CACHE.WORKSPACE.KEYS.LINKS(dto.workspaceId));

    return this.commonService.mapLinkToDto(link);
  }

  async getLinks(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceLinkResponseDto[]> {
    await this.commonService.checkPermission(workspaceId, userId, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);
    return this.cachedService.getOrSetDetail(
      CACHE.WORKSPACE.KEYS.LINKS(workspaceId),
      TTL.MEDIUM,
      async () => {
        const links = await this.linkRepository.find({
          where: { workspaceId },
        });
        return links.map((link) => this.commonService.mapLinkToDto(link));
      },
    );
  }

  async joinLink(dto: JoinLinkRequestDto): Promise<WorkspaceMemberResponseDto> {
    const savedMember = await this.dataSource.transaction(async (manager) => {
      const link = await manager.findOne(WorkspaceLinkEntity, {
        where: { tokenHash: dto.token },
        lock: { mode: 'pessimistic_write' },
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

      const existingMember = await manager.findOne(WorkspaceMemberEntity, {
        where: { workspaceId: link.workspaceId, userId: dto.userId },
      });

      if (existingMember) {
        throw new RpcException({
          statusCode: HttpStatus.CONFLICT,
          ...WORKSPACE_ERROR.ALREADY_MEMBER,
        });
      }

      const member = manager.create(WorkspaceMemberEntity, {
        workspaceId: link.workspaceId,
        userId: dto.userId,
        role: WorkspaceRoleEnum.MEMBER,
        status: MembershipStatus.ACTIVE,
      });

      const saved = await manager.save(member);
      link.usedCount++;
      await manager.save(link);

      return saved;
    });

    this.logger.log('Join link', savedMember);

    await this.cachedService.invalidateList(
      CACHE.USER_WORKSPACE.TRACKERS.LIST_VERSION(dto.userId),
    );

    return this.commonService.mapMemberToDto(savedMember);
  }

  async disableLink(dto: DisableLinkRequestDto): Promise<string> {
    await this.commonService.checkPermission(dto.workspaceId, dto.adminUserId, [
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

    this.cachedService.del(CACHE.WORKSPACE.KEYS.LINKS(dto.workspaceId));
    this.logger.log('Disable link', link);

    return 'Link disabled successfully';
  }

  async deleteLink(dto: DeleteLinkRequestDto): Promise<string> {
    await this.commonService.checkPermission(dto.workspaceId, dto.adminUserId, [
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

    this.cachedService.del(CACHE.WORKSPACE.KEYS.LINKS(dto.workspaceId));
    this.logger.log('Delete link', link);

    return 'Link deleted successfully';
  }
}
