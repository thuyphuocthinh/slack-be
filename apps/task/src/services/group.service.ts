import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { TaskGroupEntity } from '../entity/task_group.entity';
import { CreateGroupDto, UpdateGroupDto } from '../dto/group.dto';
import { RpcException } from '@nestjs/microservices';
import { TASK_ERROR } from '@slack/constants';
import { IGroupResponse } from '../type/task.response';
import { TaskCommonService } from './task-common.service';

@Injectable()
export class GroupService {
  constructor(
    @InjectRepository(TaskGroupEntity)
    private readonly groupRepo: Repository<TaskGroupEntity>,
    private readonly commonService: TaskCommonService,
    private readonly dataSource: DataSource,
  ) {}

  async addGroupToBoard(
    dto: CreateGroupDto,
    requesterId: string,
  ): Promise<IGroupResponse> {
    return await this.dataSource.transaction(async (manager) => {
      await this.commonService.checkBoardMembership(dto.boardId, requesterId);

      const group = manager.create(TaskGroupEntity, dto);
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

      await this.commonService.checkBoardMembership(group.boardId, requesterId);

      Object.assign(group, dto);
      const saved = await manager.save(group);
      return this.mapGroupResponse(saved);
    });
  }

  async removeGroupFromBoard(id: string, requesterId: string): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      const group = await manager.findOne(TaskGroupEntity, { where: { id } });
      if (!group) throw new RpcException(TASK_ERROR.GROUP_NOT_FOUND);

      await this.commonService.checkBoardMembership(group.boardId, requesterId);

      await manager.remove(group);
      return `Group with ID ${id} has been deleted`;
    });
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
}
