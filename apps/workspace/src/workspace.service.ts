import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, IsNull, In } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { WorkspaceEntity } from './entity/workspace.entity';
import { WorkspaceMemberEntity } from './entity/workspace_member.entity';
import { WorkspaceRoleEnum, MembershipStatus } from './types/workspace.enum';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { WORKSPACE_ERROR } from '@slack/constants';
import {
  CreateWorkspaceRequestDto,
  UpdateWorkspaceRequestDto,
  DeleteWorkspaceRequestDto,
  GetWorkspacesRequestDto,
} from './dto/workspace-request.dto';
import { WorkspaceResponseDto } from './dto/workspace-response.dto';
import { WorkspaceDto } from './dto/workspace.dto';
import { generateSlug, IOffsetResponse } from '@slack/common';
import { WorkspaceCommonService } from './services/workspace-common.service';

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
  ) {}

  // create workspace
  async createWorkspace(
    dto: CreateWorkspaceRequestDto,
  ): Promise<WorkspaceResponseDto> {
    const slug = generateSlug(dto.name);

    try {
      const savedWorkspace = await this.dataSource.transaction(
        async (manager) => {
          // 1. Insert Workspace
          const insertWsResult = await manager.insert(WorkspaceEntity, {
            name: dto.name,
            description: dto.description,
            slug,
          });
          const workspaceId = insertWsResult.identifiers[0].id;

          // 2. Insert Member
          await manager.insert(WorkspaceMemberEntity, {
            workspaceId: workspaceId,
            userId: dto.ownerUserId,
            role: WorkspaceRoleEnum.OWNER,
            status: MembershipStatus.ACTIVE,
          });

          return {
            id: workspaceId,
            name: dto.name,
            description: dto.description,
            slug,
            createdAt: new Date(),
          } as WorkspaceEntity;
        },
      );

      // Invalidate cache
      this.cachedService
        .invalidateList(
          CACHE.USER_WORKSPACE.TRACKERS.LIST_VERSION(dto.ownerUserId),
        )
        .catch((err) =>
          this.logger.error(`Cache invalidation failed: ${err.message}`),
        );

      return this.commonService.mapWorkspaceToDto(savedWorkspace);
    } catch (err) {
      if (err.code === '23505') {
        this.logger.warn(`Slug collision for ${slug}, retrying...`);
        return this.createWorkspace({
          ...dto,
          name: `${dto.name}-${Date.now()}`,
        });
      }
      throw err;
    }
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
          where: { id: workspaceId, deletedAt: IsNull() },
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

    workspace.deletedAt = new Date();
    await this.workspaceRepository.save(workspace);

    // Invalidate all members' workspace list cache
    const members = await this.memberRepository.find({
      where: { workspaceId: workspace.id },
    });

    for (const m of members) {
      await this.cachedService.invalidateList(
        CACHE.USER_WORKSPACE.TRACKERS.LIST_VERSION(m.userId),
      );
    }

    this.logger.log('Delete workspace', JSON.stringify(workspace));

    // delete cached
    this.cachedService.del(CACHE.WORKSPACE.KEYS.DETAIL(workspace.id));

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
          where: { id: In(workspaceIds), deletedAt: IsNull() },
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
