import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { WorkspaceEntity } from '../entity/workspace.entity';
import { WorkspaceMemberEntity } from '../entity/workspace_member.entity';
import { WorkspaceRoleEnum, MembershipStatus } from '../types/workspace.enum';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { SYSTEM_ERRORS, WORKSPACE_ERROR } from '@slack/constants';
import {
  CreateWorkspaceRequestDto,
  UpdateWorkspaceRequestDto,
  DeleteWorkspaceRequestDto,
  GetWorkspacesRequestDto,
} from '../dto/workspace-request.dto';
import { WorkspaceResponseDto } from '../dto/workspace-response.dto';
import { WorkspaceDto } from '../dto/workspace.dto';
import { generateSlug, IOffsetResponse, AuditAction, AuditEntityType } from '@slack/common';
import { WorkspaceCommonService } from './workspace-common.service';
import { EJobName, EQueueName, QueueService } from '@slack/queue';

@Injectable()
export class WorkspaceService {
  private readonly logger = new Logger(WorkspaceService.name);

  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    @InjectRepository(WorkspaceMemberEntity)
    private readonly memberRepository: Repository<WorkspaceMemberEntity>,
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
    private readonly commonService: WorkspaceCommonService,
    private readonly queueService: QueueService,
  ) {}


  // create workspace
  async createWorkspace(
    dto: CreateWorkspaceRequestDto,
  ): Promise<WorkspaceResponseDto> {
    const currentDto = { ...dto };
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
      const slug = generateSlug(currentDto.name);
      try {
        const savedWorkspace = await this.dataSource.transaction(
          async (manager) => {
            const insertWsResult = await manager.insert(WorkspaceEntity, {
              name: currentDto.name,
              description: currentDto.description,
              slug,
            });
            const workspaceId = insertWsResult.identifiers[0].id;

            await manager.insert(WorkspaceMemberEntity, {
              workspaceId: workspaceId,
              userId: currentDto.ownerUserId,
              role: WorkspaceRoleEnum.OWNER,
              status: MembershipStatus.ACTIVE,
            });

            return {
              id: workspaceId,
              name: currentDto.name,
              description: currentDto.description,
              slug,
              createdAt: new Date(),
            } as WorkspaceEntity;
          },
        );

        this.cachedService
          .invalidateList(
            CACHE.USER_WORKSPACE.TRACKERS.LIST_VERSION(currentDto.ownerUserId),
          )
          .catch((err) =>
            this.logger.error(`Cache invalidation failed: ${err.message}`),
          );

        this.queueService.addJob(EQueueName.AUDIT_QUEUE, EJobName.SAVE_AUDIT_LOG, {
          action: AuditAction.WORKSPACE_CREATED,
          actorId: currentDto.ownerUserId,
          entityType: AuditEntityType.WORKSPACE,
          entityId: savedWorkspace.id,
          metadata: { name: savedWorkspace.name, slug: savedWorkspace.slug },
        });

        return this.commonService.mapWorkspaceToDto(savedWorkspace);

      } catch (err) {
        if (err.code === '23505' && retries < maxRetries - 1) {
          retries++;
          this.logger.warn(
            `Slug collision for ${slug}, retrying ${retries}/${maxRetries}...`,
          );
          currentDto.name = `${dto.name}-${Math.floor(Math.random() * 10000)}`;
          continue;
        }
        throw err;
      }
    }
    throw new RpcException(SYSTEM_ERRORS.INTERNAL_SERVER_ERROR);
  }

  // update workspace
  async updateWorkspace(
    dto: UpdateWorkspaceRequestDto,
  ): Promise<WorkspaceResponseDto> {
    await this.commonService.checkPermission(dto.workspaceId, dto.updatedBy, [
      WorkspaceRoleEnum.OWNER,
      WorkspaceRoleEnum.ADMIN,
    ]);

    const workspace = await this.commonService.findWorkspaceById(
      dto.workspaceId,
    );

    if (dto.name) {
      workspace.name = dto.name;
    }
    if (dto.description) {
      workspace.description = dto.description;
    }
    if (dto.logo) {
      workspace.logo = dto.logo;
    }

    const updatedWorkspace = await this.workspaceRepository.save(workspace);
    await this.cachedService.del(CACHE.WORKSPACE.KEYS.DETAIL(dto.workspaceId));

    // Invalidate all members' workspace list cache because workspace info (name/logo) changed
    const members = await this.memberRepository.find({
      where: { workspaceId: dto.workspaceId },
      select: ['userId'],
    });
    const trackerKeys = members.map((m) =>
      CACHE.USER_WORKSPACE.TRACKERS.LIST_VERSION(m.userId),
    );
    await this.cachedService.invalidateListBulk(trackerKeys);

    this.queueService.addJob(EQueueName.AUDIT_QUEUE, EJobName.SAVE_AUDIT_LOG, {
      action: AuditAction.WORKSPACE_RENAMED,
      actorId: dto.updatedBy,
      entityType: AuditEntityType.WORKSPACE,
      entityId: dto.workspaceId,
      metadata: { name: updatedWorkspace.name },
    });

    return this.commonService.mapWorkspaceToDto(updatedWorkspace);

  }

  // detail workspace
  async getDetailWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceDto> {
    // check permission
    await this.commonService.isMemberOfWorkspace(workspaceId, userId);
    return this.cachedService.getOrSetDetail(
      CACHE.WORKSPACE.KEYS.DETAIL(workspaceId),
      TTL.LONG,
      async () => {
        const workspace = await this.workspaceRepository.findOne({
          where: { id: workspaceId },
        });
        if (!workspace) {
          throw new RpcException(WORKSPACE_ERROR.WORKSPACE_NOT_FOUND);
        }
        return this.commonService.mapWorkspaceToDto(workspace);
      },
    );
  }

  // delete workspace by owner
  async deleteWorkspace(dto: DeleteWorkspaceRequestDto): Promise<string> {
    await this.commonService.checkPermission(dto.workspaceId, dto.ownerUserId, [
      WorkspaceRoleEnum.OWNER,
    ]);

    const workspace = await this.commonService.findWorkspaceById(
      dto.workspaceId,
    );

    // 1. Get members before deletion for cache invalidation
    const members = await this.memberRepository.find({
      where: { workspaceId: workspace.id },
      select: ['userId'],
    });

    // 2. Hard delete workspace (related entities like members, invites, and links are deleted via CASCADE)
    await this.workspaceRepository.delete({ id: workspace.id });

    // 3. Invalidate all members' workspace list cache in bulk
    const trackerKeys = members.map((m) =>
      CACHE.USER_WORKSPACE.TRACKERS.LIST_VERSION(m.userId),
    );
    await this.cachedService.invalidateListBulk(trackerKeys);

    // 4. Invalidate individual membership cache for all members
    await Promise.all(
      members.map((m) =>
        this.cachedService.del(
          CACHE.WORKSPACE.KEYS.IS_MEMBER(workspace.id, m.userId),
        ),
      ),
    );

    this.logger.log('Hard delete workspace', JSON.stringify(workspace));

    // delete cached
    this.cachedService.del(CACHE.WORKSPACE.KEYS.DETAIL(workspace.id));
    this.cachedService.del(CACHE.WORKSPACE.KEYS.MEMBERS(workspace.id));

    this.queueService.addJob(EQueueName.AUDIT_QUEUE, EJobName.SAVE_AUDIT_LOG, {
      action: AuditAction.WORKSPACE_DELETED,
      actorId: dto.ownerUserId,
      entityType: AuditEntityType.WORKSPACE,
      entityId: workspace.id,
      metadata: { name: workspace.name },
    });


    return 'Workspace deleted successfully';

  }

  // get list workspace of user
  async getListWorkspaceOfUser(
    dto: GetWorkspacesRequestDto,
  ): Promise<IOffsetResponse<WorkspaceResponseDto[]>> {
    const { userId, page = 1, limit = 20 } = dto;

    return this.cachedService.getOrSetList({
      trackerKey: CACHE.USER_WORKSPACE.TRACKERS.LIST_VERSION(userId),
      keyBuilder: (version) =>
        CACHE.USER_WORKSPACE.KEYS.LIST(userId, version, page, limit),
      ttl: TTL.LONG,
      fetcher: async () => {
        const skip = (page - 1) * limit;
        const [members, total] = await this.memberRepository.findAndCount({
          where: { userId, status: MembershipStatus.ACTIVE },
          skip,
          take: limit,
          order: { createdAt: 'DESC' },
        });

        const workspaceIds = members.map((m) => m.workspaceId);
        if (workspaceIds.length === 0) {
          return {
            data: [],
            paging: {
              page,
              limit,
              total: 0,
              totalPages: 0,
            },
          } as unknown as IOffsetResponse<WorkspaceResponseDto[]>;
        }

        const workspaces = await this.workspaceRepository.find({
          where: { id: In(workspaceIds) },
        });

        const workspaceDtos = workspaceIds
          .map((id) => {
            const w = workspaces.find((ws) => ws.id === id);
            return w ? this.commonService.mapWorkspaceToDto(w) : null;
          })
          .filter((w) => w !== null);

        return {
          data: workspaceDtos,
          paging: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        } as unknown as IOffsetResponse<WorkspaceResponseDto[]>;
      },
    });
  }

  async checkPermission(dto: {
    workspaceId: string;
    userId: string;
    allowedRoles: WorkspaceRoleEnum[];
  }) {
    return await this.commonService.checkPermission(
      dto.workspaceId,
      dto.userId,
      dto.allowedRoles,
    );
  }
}
