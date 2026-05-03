import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  DataSource,
  In,
  OptimisticLockVersionMismatchError,
} from 'typeorm';
import { TaskEntity } from '../entity/task.entity';
import { LabelEntity } from '../entity/label.entity';
import { TaskMemberEntity } from '../entity/task_member.entity';
import { CreateTaskDto, UpdateTaskDto } from '../dto/task.dto';
import { RpcException } from '@nestjs/microservices';
import { DATABASE_ERROR, TASK_ERROR } from '@slack/constants';
import { ITaskResponse } from '../type/task.response';
import { BoardMemberEntity } from '../entity/board_member.entity';
import { TaskCommonService } from './task-common.service';
import { TaskGroupEntity } from '../entity/task_group.entity';
import { TaskAttachmentEntity } from '../entity/task_attachment.entity';
import { IOffsetResponse } from '@slack/common';
import { QueryTaskDto } from '../dto/task.dto';
import { CACHE, CachedService, TTL } from '@slack/cached';
import { EJobName, EQueueName, QueueService } from '@slack/queue';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(LabelEntity)
    private readonly labelRepo: Repository<LabelEntity>,
    @InjectRepository(TaskMemberEntity)
    private readonly taskMemberRepo: Repository<TaskMemberEntity>,
    @InjectRepository(TaskGroupEntity)
    private readonly groupRepo: Repository<TaskGroupEntity>,
    @InjectRepository(BoardMemberEntity)
    private readonly boardMemberRepo: Repository<BoardMemberEntity>,
    private readonly dataSource: DataSource,
    private readonly commonService: TaskCommonService,
    private readonly cachedService: CachedService,
    private readonly queueService: QueueService,
  ) {}

  async createNewTask(
    dto: CreateTaskDto,
    requesterId: string,
  ): Promise<ITaskResponse> {
    const { result, saved } = await this.dataSource.transaction(
      async (manager) => {
        const group = await manager.findOne(TaskGroupEntity, {
          where: { id: dto.groupId },
        });
        if (!group) throw new RpcException(TASK_ERROR.GROUP_NOT_FOUND);
        await this.commonService.checkBoardMembership(
          group.boardId,
          requesterId,
          manager,
        );

        const task = manager.create(TaskEntity, dto);
        const saved = await manager.save(task);
        const result = this.mapTaskResponse(saved);

        return { result, saved };
      },
    );

    await this.cachedService.invalidateList(
      CACHE.TASK.TRACKERS.TASK_LIST_VERSION(dto.groupId),
    );

    if (saved.dueDate) {
      await this.handleTaskDeadlineJob(saved.id, saved.dueDate);
    }

    return result;
  }

  async updateTaskDetails(
    id: string,
    dto: UpdateTaskDto,
    requesterId: string,
  ): Promise<ITaskResponse> {
    const { labelIds, ...updateData } = dto;

    const { result, updatedTask } = await this.dataSource.transaction(
      async (manager) => {
        const task = await manager.findOne(TaskEntity, {
          where: { id },
          relations: ['labels', 'group', 'members'],
        });

        if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

        await this.commonService.checkBoardMembership(
          task.group.boardId,
          requesterId,
          manager,
        );

        if (labelIds !== undefined) {
          task.labels = labelIds.length
            ? await manager.findBy(LabelEntity, { id: In(labelIds) })
            : [];
        }

        Object.assign(task, updateData);
        try {
          const updatedTask = await manager.save(task);
          const result = this.mapTaskResponse(updatedTask);

          return { result, updatedTask };
        } catch (error) {
          if (error instanceof OptimisticLockVersionMismatchError) {
            throw new RpcException(DATABASE_ERROR.OPTIMISTIC_LOCK_CONFLICT);
          }
          throw error;
        }
      },
    );

    await this.cachedService.invalidateList(
      CACHE.TASK.TRACKERS.TASK_LIST_VERSION(updatedTask.groupId),
    );

    await this.handleTaskDeadlineJob(updatedTask.id, updatedTask.dueDate);

    return result;
  }

  async removeTask(id: string, requesterId: string): Promise<string> {
    const { groupId } = await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id },
        relations: ['group'],
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
        manager,
      );

      const groupId = task.groupId;
      await manager.remove(task);

      return { groupId };
    });

    await this.cachedService.invalidateList(
      CACHE.TASK.TRACKERS.TASK_LIST_VERSION(groupId),
    );

    await this.handleTaskDeadlineJob(id, null);

    return `Task with ID ${id} has been deleted`;
  }

  async getTaskDetails(
    id: string,
    requesterId: string,
  ): Promise<ITaskResponse> {
    const task = await this.taskRepo.findOne({
      where: { id },
      relations: ['labels', 'group', 'members'],
    });
    if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

    await this.commonService.checkBoardMembership(
      task.group.boardId,
      requesterId,
    );

    return this.mapTaskResponse(task);
  }

  async getTasksInGroup(
    queryDto: QueryTaskDto,
    requesterId: string,
  ): Promise<IOffsetResponse<ITaskResponse[]>> {
    const { groupId, page = 1 } = queryDto;
    const limit = Math.min(queryDto.limit || 20, 100);

    const group = await this.getGroupById(groupId);
    await this.commonService.checkBoardMembership(group.boardId, requesterId);

    return await this.cachedService.getOrSetList({
      trackerKey: CACHE.TASK.TRACKERS.TASK_LIST_VERSION(groupId),
      keyBuilder: (version) =>
        CACHE.TASK.KEYS.TASK_LIST(groupId, version, page, limit),
      ttl: TTL.LONG,
      fetcher: async () => {
        const skip = (page - 1) * limit;

        const query = this.taskRepo
          .createQueryBuilder('task')
          .leftJoinAndSelect('task.labels', 'label')
          .leftJoinAndSelect('task.members', 'member')
          .where('task.groupId = :groupId', { groupId })
          .orderBy('task.order', 'ASC')
          .skip(skip)
          .take(limit);

        const [items, total] = await query.getManyAndCount();

        const responseData = items.map((t) => this.mapTaskResponse(t));

        return {
          data: responseData,
          paging: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        } as unknown as IOffsetResponse<ITaskResponse[]>;
      },
    });
  }

  async assignMemberToTask(
    taskId: string,
    memberId: string,
    requesterId: string,
  ): Promise<string> {
    const { groupId } = await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        relations: ['group', 'group.board'],
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
        manager,
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

      try {
        const taskMember = manager.create(TaskMemberEntity, {
          taskId,
          memberId,
        });
        await manager.save(taskMember);

        return { groupId: task.groupId };
      } catch (error) {
        if (error instanceof OptimisticLockVersionMismatchError) {
          throw new RpcException(DATABASE_ERROR.OPTIMISTIC_LOCK_CONFLICT);
        }
        throw error;
      }
    });

    await this.cachedService.invalidateList(
      CACHE.TASK.TRACKERS.TASK_LIST_VERSION(groupId),
    );

    return 'Assign member to task successfully';
  }

  async unassignMemberFromTask(
    taskId: string,
    memberId: string,
    requesterId: string,
  ): Promise<string> {
    const { groupId } = await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        relations: ['group'],
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
        manager,
      );

      const result = await manager.delete(TaskMemberEntity, {
        taskId,
        memberId,
      });
      if (result.affected === 0)
        throw new RpcException(TASK_ERROR.MEMBER_NOT_ASSIGNED_TO_TASK);

      return { groupId: task.groupId };
    });

    await this.cachedService.invalidateList(
      CACHE.TASK.TRACKERS.TASK_LIST_VERSION(groupId),
    );

    return 'Unassign member from task successfully';
  }

  async toggleTaskLabel(
    taskId: string,
    labelId: string,
    requesterId: string,
  ): Promise<string> {
    const { groupId } = await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        relations: ['labels', 'group'],
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
        manager,
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

      try {
        await manager.save(task);

        return { groupId: task.groupId };
      } catch (error) {
        if (error instanceof OptimisticLockVersionMismatchError) {
          throw new RpcException(DATABASE_ERROR.OPTIMISTIC_LOCK_CONFLICT);
        }
        throw error;
      }
    });

    await this.cachedService.invalidateList(
      CACHE.TASK.TRACKERS.TASK_LIST_VERSION(groupId),
    );

    return 'Toggle label from task successfully';
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
            boardId: l.boardId,
            name: l.name,
            color: l.color,
          }))
        : [],
      members: task.members
        ? task.members.map((m) => ({
            id: m.id,
            taskId: m.taskId,
            memberId: m.memberId,
          }))
        : [],
      attachments: task.attachments
        ? task.attachments.map((a) => ({
            id: a.id,
            taskId: a.taskId,
            title: a.title,
            link: a.link,
          }))
        : [],
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
    const { groupId } = await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        relations: ['group'],
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
        manager,
      );

      const attachment = manager.create(TaskAttachmentEntity, {
        taskId,
        title,
        link,
      });

      await manager.save(attachment);

      return { groupId: task.groupId };
    });

    await this.cachedService.invalidateList(
      CACHE.TASK.TRACKERS.TASK_LIST_VERSION(groupId),
    );

    return 'Add attachment to task successfully';
  }

  async updateAttachment(
    taskId: string,
    attachmentId: string,
    title: string,
    link: string,
    requesterId: string,
  ): Promise<string> {
    const { groupId } = await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        relations: ['group'],
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
        manager,
      );

      const attachment = await manager.findOne(TaskAttachmentEntity, {
        where: { id: attachmentId },
      });
      if (!attachment) throw new RpcException(TASK_ERROR.ATTACHMENT_NOT_FOUND);

      attachment.title = title;
      attachment.link = link;
      try {
        await manager.save(attachment);

        return { groupId: task.groupId };
      } catch (error) {
        if (error instanceof OptimisticLockVersionMismatchError) {
          throw new RpcException(DATABASE_ERROR.OPTIMISTIC_LOCK_CONFLICT);
        }
        throw error;
      }
    });

    await this.cachedService.invalidateList(
      CACHE.TASK.TRACKERS.TASK_LIST_VERSION(groupId),
    );

    return 'Update attachment successfully';
  }

  async removeAttachment(
    taskId: string,
    attachmentId: string,
    requesterId: string,
  ): Promise<string> {
    const { groupId } = await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id: taskId },
        relations: ['group'],
      });
      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      await this.commonService.checkBoardMembership(
        task.group.boardId,
        requesterId,
        manager,
      );

      const attachment = await manager.findOne(TaskAttachmentEntity, {
        where: { id: attachmentId },
      });
      if (!attachment) throw new RpcException(TASK_ERROR.ATTACHMENT_NOT_FOUND);

      await manager.remove(attachment);

      return { groupId: task.groupId };
    });

    await this.cachedService.invalidateList(
      CACHE.TASK.TRACKERS.TASK_LIST_VERSION(groupId),
    );

    return 'Remove attachment successfully';
  }

  async getGroupById(groupId: string): Promise<TaskGroupEntity> {
    return await this.cachedService.getOrSetDetail(
      CACHE.TASK.KEYS.GROUP_DETAIL(groupId),
      TTL.LONG,
      async () => {
        const group = await this.groupRepo.findOneBy({ id: groupId });
        if (!group) throw new RpcException(TASK_ERROR.GROUP_NOT_FOUND);
        return group;
      },
    );
  }

  private async handleTaskDeadlineJob(taskId: string, dueDate: Date | null) {
    const jobId = `task_deadline_${taskId}`;

    try {
      // Xóa job cũ trước khi add mới hoặc gỡ bỏ hoàn toàn
      await this.queueService.removeJob(EQueueName.TASK_QUEUE, jobId);

      if (!dueDate) {
        return;
      }

      const now = Date.now();
      const deadline = new Date(dueDate).getTime();

      // Thông báo trước 30 phút. Nếu còn ít hơn 30 phút thì bắn ngay lập tức (delay = 0)
      const reminderBuffer = 30 * 60 * 1000;
      let delay = deadline - now - reminderBuffer;

      if (delay < 0) {
        delay = 0;
      }

      // Nếu task đã quá hạn thì không cần add job nữa
      if (deadline < now) {
        return;
      }

      await this.queueService.addJob(
        EQueueName.TASK_QUEUE,
        EJobName.TASK_DEADLINE_REMINDER,
        { taskId },
        { delay, jobId }, // Dùng jobId cố định để ghi đè (overwrite) job cũ nếu có
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle deadline job for task ${taskId}: ${error.message}`,
      );
    }
  }
}
