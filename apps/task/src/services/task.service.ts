import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { TaskEntity } from '../entity/task.entity';
import { LabelEntity } from '../entity/label.entity';
import { TaskMemberEntity } from '../entity/task_member.entity';
import { CreateTaskDto, UpdateTaskDto } from '../dto/task.dto';
import { RpcException } from '@nestjs/microservices';
import { TASK_ERROR } from '@slack/constants';
import { ITaskResponse } from '../type/task.response';
import { BoardMemberEntity } from '../entity/board_member.entity';
import { TaskCommonService } from './task-common.service';
import { TaskGroupEntity } from '../entity/task_group.entity';
import { TaskAttachmentEntity } from '../entity/task_attachment.entity';

@Injectable()
export class TaskService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(LabelEntity)
    private readonly labelRepo: Repository<LabelEntity>,
    @InjectRepository(TaskMemberEntity)
    private readonly taskMemberRepo: Repository<TaskMemberEntity>,
    @InjectRepository(BoardMemberEntity)
    private readonly boardMemberRepo: Repository<BoardMemberEntity>,
    private readonly dataSource: DataSource,
    private readonly commonService: TaskCommonService,
  ) {}

  async createNewTask(
    dto: CreateTaskDto,
    requesterId: string,
  ): Promise<ITaskResponse> {
    return await this.dataSource.transaction(async (manager) => {
      const group = await manager.findOne(TaskGroupEntity, {
        where: { id: dto.groupId },
      });
      if (!group) throw new RpcException(TASK_ERROR.GROUP_NOT_FOUND);
      await this.commonService.checkBoardMembership(group.boardId, requesterId);

      const task = manager.create(TaskEntity, dto);
      const saved = await manager.save(task);
      return this.mapTaskResponse(saved);
    });
  }

  async updateTaskDetails(
    id: string,
    dto: UpdateTaskDto,
    requesterId: string,
  ): Promise<ITaskResponse> {
    const { labelIds, ...updateData } = dto;

    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id },
        relations: ['labels', 'group'],
        lock: { mode: 'pessimistic_write' },
      });

      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
      );

      if (labelIds !== undefined) {
        task.labels = labelIds.length
          ? await manager.findBy(LabelEntity, { id: In(labelIds) })
          : [];
      }

      Object.assign(task, updateData);
      const updatedTask = await manager.save(task);

      if (dto.dueDate) {
        // TODO: Bắn vào BullMQ để cập nhật/tạo job mới cho deadline
      }

      return this.mapTaskResponse(updatedTask);
    });
  }

  async removeTask(id: string, requesterId: string): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id },
        relations: ['group'],
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
      );

      await manager.remove(task);
      return `Task with ID ${id} has been deleted`;
    });
  }

  async getTaskDetails(
    id: string,
    requesterId: string,
  ): Promise<ITaskResponse> {
    const task = await this.taskRepo.findOne({
      where: { id },
      relations: ['labels', 'group'],
    });
    if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

    await this.commonService.checkBoardMembership(
      task.group.boardId,
      requesterId,
    );

    return this.mapTaskResponse(task);
  }

  async getTasksInGroup(
    groupId: string,
    requesterId: string,
  ): Promise<ITaskResponse[]> {
    const group = await this.dataSource
      .getRepository(TaskGroupEntity)
      .findOneBy({ id: groupId });
    if (!group) throw new RpcException(TASK_ERROR.GROUP_NOT_FOUND);
    await this.commonService.checkBoardMembership(group.boardId, requesterId);

    const tasks = await this.taskRepo.find({
      where: { groupId },
      order: { order: 'ASC' },
      relations: ['labels'],
    });
    return tasks.map((t) => this.mapTaskResponse(t));
  }

  async assignMemberToTask(
    taskId: string,
    memberId: string,
    requesterId: string,
  ): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        relations: ['group', 'group.board'],
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
      );

      const boardMembers = await manager.find(BoardMemberEntity, {
        where: { boardId: task.group.boardId },
      });
      if (!boardMembers.some((m) => m.memberId === memberId))
        throw new RpcException(TASK_ERROR.MEMBER_NOT_IN_BOARD);

      const existing = await manager.findOne(TaskMemberEntity, {
        where: { taskId, memberId },
      });
      if (existing)
        throw new RpcException(TASK_ERROR.MEMBER_ALREADY_ASSIGNED_TO_TASK);

      const taskMember = manager.create(TaskMemberEntity, { taskId, memberId });
      await manager.save(taskMember);
      return 'Assign member to task successfully';
    });
  }

  async unassignMemberFromTask(
    taskId: string,
    memberId: string,
    requesterId: string,
  ): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        relations: ['group'],
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
      );

      const result = await manager.delete(TaskMemberEntity, {
        taskId,
        memberId,
      });
      if (result.affected === 0)
        throw new RpcException(TASK_ERROR.MEMBER_NOT_ASSIGNED_TO_TASK);
      return 'Unassign member from task successfully';
    });
  }

  async toggleTaskLabel(
    taskId: string,
    labelId: string,
    requesterId: string,
  ): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        relations: ['labels', 'group'],
        lock: { mode: 'pessimistic_write' },
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
      );

      const label = await manager.findOne(LabelEntity, {
        where: { id: labelId },
      });
      if (!label) throw new RpcException(TASK_ERROR.LABEL_NOT_FOUND);

      if (task.labels.some((l) => l.id === labelId)) {
        task.labels = task.labels.filter((l) => l.id !== labelId);
      } else {
        task.labels.push(label);
      }
      await manager.save(task);
      return 'Toggle label from task successfully';
    });
  }

  private mapTaskResponse(task: TaskEntity): ITaskResponse {
    return {
      id: task.id,
      groupId: task.groupId,
      title: task.title,
      description: task.description,
      dueDate: task.dueDate,
      order: task.order,
      labels: task.labels
        ? task.labels.map((l) => ({
            id: l.id,
            workspaceId: l.workspaceId,
            name: l.name,
            color: l.color,
          }))
        : [],
      // members
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  // add attachments (title - link), no need to upload => reduce costs and time
  async addAttachmentToTask(
    taskId: string,
    title: string,
    link: string,
    requesterId: string,
  ): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        relations: ['group'],
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
      );

      const attachment = manager.create(TaskAttachmentEntity, {
        taskId,
        title,
        link,
      });
      await manager.save(attachment);
      return 'Add attachment to task successfully';
    });
  }

  async updateAttachment(
    taskId: string,
    attachmentId: string,
    title: string,
    link: string,
    requesterId: string,
  ): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        relations: ['group'],
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
      );

      const attachment = await manager.findOne(TaskAttachmentEntity, {
        where: { id: attachmentId },
      });
      if (!attachment) throw new RpcException(TASK_ERROR.ATTACHMENT_NOT_FOUND);

      attachment.title = title;
      attachment.link = link;
      await manager.save(attachment);
      return 'Update attachment successfully';
    });
  }

  async removeAttachment(
    taskId: string,
    attachmentId: string,
    requesterId: string,
  ): Promise<string> {
    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        relations: ['group'],
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
      );

      const attachment = await manager.findOne(TaskAttachmentEntity, {
        where: { id: attachmentId },
      });
      if (!attachment) throw new RpcException(TASK_ERROR.ATTACHMENT_NOT_FOUND);

      await manager.remove(attachment);
      return 'Remove attachment successfully';
    });
  }
}
