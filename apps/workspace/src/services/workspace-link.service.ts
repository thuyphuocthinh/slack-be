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
import { CACHE, CachedService } from '@slack/cached';
import { WorkspaceCommonService } from './workspace-common.service';

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
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      status: WorkspaceLinkStatus.ACTIVE,
      maxUsage: dto.maxUsage,
    });

    this.logger.log('Generate link', link);

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
    const links = await this.linkRepository.find({
      where: { workspaceId },
    });
    return links.map((link) => this.commonService.mapLinkToDto(link));
  }

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

    return this.commonService.mapMemberToDto(newMember);
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

    this.logger.log('Delete link', link);

    return 'Link deleted successfully';
  }
}
