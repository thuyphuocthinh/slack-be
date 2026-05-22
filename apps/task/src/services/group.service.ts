import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Between } from 'typeorm';
import { TaskGroupEntity } from '../entity/task_group.entity';
import {
  ChangeGroupOrderDto,
  CreateGroupDto,
  UpdateGroupDto,
} from '../dto/group.dto';
import { RpcException } from '@nestjs/microservices';
import { TASK_ERROR } from '@slack/constants';
import { IGroupResponse } from '../type/task.response';
import { TaskCommonService } from './task-common.service';
import { CACHE, CachedService } from '@slack/cached';

@Injectable()
export class GroupService {
  constructor(
    @InjectRepository(TaskGroupEntity)
    private readonly groupRepo: Repository<TaskGroupEntity>,
    private readonly commonService: TaskCommonService,
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
  ) {}

  async addGroupToBoard(
    dto: CreateGroupDto,
    requesterId: string,
  ): Promise<IGroupResponse> {
    return await this.dataSource.transaction(async (manager) => {
      await this.commonService.checkBoardMembership(
        dto.boardId,
        requesterId,
        manager,
      );

      const lastGroup = await manager.findOne(TaskGroupEntity, {
        where: { boardId: dto.boardId },
        order: { order: 'DESC' },
      });
      const nextOrder = lastGroup ? lastGroup.order + 1 : 0;

      const group = manager.create(TaskGroupEntity, {
        ...dto,
        order: nextOrder,
      });
      const saved = await manager.save(group);
      return this.mapGroupResponse(saved);
    });
  }

  async updateGroupInfo(
    id: string,
    dto: UpdateGroupDto,
    requesterId: string,
  ): Promise<IGroupResponse> {
    return await this.dataSource.transaction(async (manager) => {
      const group = await manager.findOne(TaskGroupEntity, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!group) throw new RpcException(TASK_ERROR.GROUP_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        group.boardId,
        requesterId,
        manager,
      );

      Object.assign(group, dto);
      const saved = await manager.save(group);
      return this.mapGroupResponse(saved);
    });
  }

  async removeGroupFromBoard(id: string, requesterId: string): Promise<string> {
    const msg = await this.dataSource.transaction(async (manager) => {
      const group = await manager.findOne(TaskGroupEntity, { where: { id } });
      if (!group) throw new RpcException(TASK_ERROR.GROUP_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        group.boardId,
        requesterId,
        manager,
      );

      await manager.remove(group);
      return `Group with ID ${id} has been deleted`;
    });

    await this.cachedService.invalidateList(
      CACHE.TASK.TRACKERS.TASK_LIST_VERSION(id),
    );

    return msg;
  }

  async getGroupsByBoardId(
    boardId: string,
    requesterId: string,
  ): Promise<IGroupResponse[]> {
    await this.commonService.checkBoardMembership(boardId, requesterId);

    const groups = await this.groupRepo.find({
      where: { boardId },
      order: { order: 'ASC' },
    });
    return groups.map((g) => this.mapGroupResponse(g));
  }

  private mapGroupResponse(group: TaskGroupEntity): IGroupResponse {
    return {
      id: group.id,
      boardId: group.boardId,
      name: group.name,
      order: group.order,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
    };
  }

  async changeGroupOrder(
    dto: ChangeGroupOrderDto,
    requesterId: string,
  ): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      const sourceGroup = await manager.findOneBy(TaskGroupEntity, {
        id: dto.sourceGroupId,
      });
      const targetGroup = await manager.findOneBy(TaskGroupEntity, {
        id: dto.targetGroupId,
      });

      if (!sourceGroup || !targetGroup)
        throw new RpcException(TASK_ERROR.GROUP_NOT_FOUND);
      if (sourceGroup.boardId !== targetGroup.boardId)
        throw new RpcException(TASK_ERROR.GROUPS_NOT_IN_SAME_BOARD);

      await this.commonService.checkBoardMembership(
        sourceGroup.boardId,
        requesterId,
        manager,
      );

      const { boardId, order: sOrder } = sourceGroup;
      const { order: tOrder } = targetGroup;

      if (sOrder === tOrder) return 'Group order remains the same';

      if (sOrder < tOrder) {
        await manager.update(
          TaskGroupEntity,
          {
            boardId,
            order: Between(sOrder + 1, tOrder),
          },
          { order: () => 'order - 1' },
        );
      } else {
        await manager.update(
          TaskGroupEntity,
          {
            boardId,
            order: Between(tOrder, sOrder - 1),
          },
          { order: () => 'order + 1' },
        );
      }

      sourceGroup.order = tOrder;
      await manager.save(sourceGroup);

      return 'Change group order successfully';
    });
  }
}
