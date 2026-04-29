import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ChecklistEntity } from '../entity/checklist.entity';
import { ChecklistItemEntity } from '../entity/checklist_item.entity';
import { TaskEntity } from '../entity/task.entity';
import {
  CreateChecklistDto,
  UpdateChecklistDto,
  AddChecklistItemDto,
  UpdateChecklistItemDto,
} from '../dto/checklist.dto';
import { RpcException } from '@nestjs/microservices';
import { DATABASE_ERROR, TASK_ERROR } from '@slack/constants';
import { OptimisticLockVersionMismatchError } from 'typeorm';
import { TaskCommonService } from './task-common.service';
import {
  IChecklistResponse,
  IChecklistItemResponse,
} from '../type/task.response';

@Injectable()
export class ChecklistService {
  constructor(
    @InjectRepository(ChecklistEntity)
    private readonly checklistRepo: Repository<ChecklistEntity>,
    @InjectRepository(ChecklistItemEntity)
    private readonly itemRepo: Repository<ChecklistItemEntity>,
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    private readonly commonService: TaskCommonService,
    private readonly dataSource: DataSource,
  ) {}

  async createChecklist(
    dto: CreateChecklistDto,
    requesterId: string,
  ): Promise<IChecklistResponse> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id: dto.taskId },
        relations: ['group'],
      });
      if (!task || !task.group)
        throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
        manager,
      );

      const checklist = manager.create(ChecklistEntity, dto);
      const saved = await manager.save(checklist);
      return this.mapChecklistResponse(saved);
    });
  }

  async updateChecklist(
    id: string,
    dto: UpdateChecklistDto,
    requesterId: string,
  ): Promise<IChecklistResponse> {
    return await this.dataSource.transaction(async (manager) => {
      const checklist = await manager.findOne(ChecklistEntity, {
        where: { id },
        relations: ['task', 'task.group', 'items'],
      });
      if (!checklist || !checklist.task || !checklist.task.group) {
        throw new RpcException(TASK_ERROR.CHECKLIST_NOT_FOUND);
      }

      await this.commonService.checkBoardMembership(
        checklist.task.group.boardId,
        requesterId,
        manager,
      );

      Object.assign(checklist, dto);
      try {
        const saved = await manager.save(checklist);
        return this.mapChecklistResponse(saved);
      } catch (error) {
        if (error instanceof OptimisticLockVersionMismatchError) {
          throw new RpcException(DATABASE_ERROR.OPTIMISTIC_LOCK_CONFLICT);
        }
        throw error;
      }
    });
  }

  async deleteChecklist(id: string, requesterId: string): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      const checklist = await manager.findOne(ChecklistEntity, {
        where: { id },
        relations: ['task', 'task.group'],
      });
      if (!checklist || !checklist.task || !checklist.task.group) {
        throw new RpcException(TASK_ERROR.CHECKLIST_NOT_FOUND);
      }

      await this.commonService.checkBoardMembership(
        checklist.task.group.boardId,
        requesterId,
        manager,
      );

      await manager.remove(checklist);
      return `Checklist with ID ${id} has been deleted`;
    });
  }

  async getChecklistsInTask(
    taskId: string,
    requesterId: string,
  ): Promise<IChecklistResponse[]> {
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      relations: ['group'],
    });
    if (!task || !task.group) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

    await this.commonService.checkBoardMembership(
      task.group.boardId,
      requesterId,
    );

    const checklists = await this.checklistRepo.find({
      where: { taskId },
      relations: ['items'],
    });

    return checklists.map((c) => this.mapChecklistResponse(c));
  }

  async addChecklistItem(
    dto: AddChecklistItemDto,
    requesterId: string,
  ): Promise<IChecklistItemResponse> {
    return await this.dataSource.transaction(async (manager) => {
      const checklist = await manager.findOne(ChecklistEntity, {
        where: { id: dto.checklistId },
        relations: ['task', 'task.group'],
      });
      if (!checklist || !checklist.task || !checklist.task.group) {
        throw new RpcException(TASK_ERROR.CHECKLIST_NOT_FOUND);
      }

      await this.commonService.checkBoardMembership(
        checklist.task.group.boardId,
        requesterId,
        manager,
      );

      const item = manager.create(ChecklistItemEntity, dto);
      const saved = await manager.save(item);
      return this.mapChecklistItemResponse(saved);
    });
  }

  async updateChecklistItem(
    id: string,
    dto: UpdateChecklistItemDto,
    requesterId: string,
  ): Promise<IChecklistItemResponse> {
    return await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(ChecklistItemEntity, {
        where: { id },
        relations: ['checklist', 'checklist.task', 'checklist.task.group'],
      });
      if (
        !item ||
        !item.checklist ||
        !item.checklist.task ||
        !item.checklist.task.group
      ) {
        throw new RpcException(TASK_ERROR.CHECKLIST_ITEM_NOT_FOUND);
      }

      await this.commonService.checkBoardMembership(
        item.checklist.task.group.boardId,
        requesterId,
        manager,
      );

      Object.assign(item, dto);
      try {
        const saved = await manager.save(item);
        return this.mapChecklistItemResponse(saved);
      } catch (error) {
        if (error instanceof OptimisticLockVersionMismatchError) {
          throw new RpcException(DATABASE_ERROR.OPTIMISTIC_LOCK_CONFLICT);
        }
        throw error;
      }
    });
  }

  async deleteChecklistItem(id: string, requesterId: string): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(ChecklistItemEntity, {
        where: { id },
        relations: ['checklist', 'checklist.task', 'checklist.task.group'],
      });
      if (
        !item ||
        !item.checklist ||
        !item.checklist.task ||
        !item.checklist.task.group
      ) {
        throw new RpcException(TASK_ERROR.CHECKLIST_ITEM_NOT_FOUND);
      }

      await this.commonService.checkBoardMembership(
        item.checklist.task.group.boardId,
        requesterId,
        manager,
      );

      await manager.remove(item);
      return `Checklist item with ID ${id} has been deleted`;
    });
  }

  async toggleChecklistItem(
    id: string,
    requesterId: string,
  ): Promise<IChecklistItemResponse> {
    return await this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(ChecklistItemEntity, {
        where: { id },
        relations: ['checklist', 'checklist.task', 'checklist.task.group'],
      });
      if (
        !item ||
        !item.checklist ||
        !item.checklist.task ||
        !item.checklist.task.group
      ) {
        throw new RpcException(TASK_ERROR.CHECKLIST_ITEM_NOT_FOUND);
      }

      await this.commonService.checkBoardMembership(
        item.checklist.task.group.boardId,
        requesterId,
        manager,
      );

      item.isCompleted = !item.isCompleted;
      try {
        const saved = await manager.save(item);
        return this.mapChecklistItemResponse(saved);
      } catch (error) {
        if (error instanceof OptimisticLockVersionMismatchError) {
          throw new RpcException(DATABASE_ERROR.OPTIMISTIC_LOCK_CONFLICT);
        }
        throw error;
      }
    });
  }

  private mapChecklistResponse(checklist: ChecklistEntity): IChecklistResponse {
    return {
      id: checklist.id,
      taskId: checklist.taskId,
      name: checklist.name,
      items: checklist.items
        ? checklist.items.map((i) => this.mapChecklistItemResponse(i))
        : [],
    };
  }

  private mapChecklistItemResponse(
    item: ChecklistItemEntity,
  ): IChecklistItemResponse {
    return {
      id: item.id,
      checklistId: item.checklistId,
      content: item.content,
      isCompleted: item.isCompleted,
    };
  }
}
