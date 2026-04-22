import { Injectable, HttpStatus, Logger } from '@nestjs/common';
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
} from './dto/workspace-request.dto';
import { WorkspaceResponseDto } from './dto/workspace-response.dto';
import { WorkspaceDto } from './dto/workspace.dto';
import { generateSlug } from '@slack/common';
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

        return this.commonService.mapWorkspaceToDto(savedWorkspace);
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

  // get list workspace of user
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

    const res = workspaces.map((w) => this.commonService.mapWorkspaceToDto(w));

    await this.cachedService.set(key, res, TTL.LONG);

    return res;
  }
}
