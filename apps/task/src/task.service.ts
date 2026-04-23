import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { TaskEntity } from './entity/task.entity';
import { LabelEntity } from './entity/label.entity';
import { CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { RpcException } from '@nestjs/microservices';
import { TASK_ERROR } from '@slack/constants';

@Injectable()
export class TaskService {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(LabelEntity)
    private readonly labelRepo: Repository<LabelEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateTaskDto) {
    const { labelIds, ...taskData } = dto;

    return await this.dataSource.transaction(async (manager) => {
      const task = manager.create(TaskEntity, taskData);

      if (labelIds?.length) {
        task.labels = await manager.findBy(LabelEntity, { id: In(labelIds) });
      }

      const savedTask = await manager.save(task);

      if (dto.dueDate) {
        // TODO: Bắn vào BullMQ để tạo job nhắc nhở (reminder) hoặc xử lý khi đến hạn
        // logic: this.bullmqService.addJob('task-reminder', { taskId: savedTask.id }, { delay: ... });
      }

      return savedTask;
    });
  }

  async update(id: string, dto: UpdateTaskDto) {
    const { labelIds, ...updateData } = dto;

    return await this.dataSource.transaction(async (manager) => {
      const task = await manager.findOne(TaskEntity, {
        where: { id },
        relations: ['labels'],
        lock: { mode: 'pessimistic_write' },
      });

      if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);

      if (labelIds !== undefined) {
        task.labels = labelIds.length
          ? await manager.findBy(LabelEntity, { id: In(labelIds) })
          : [];
      }

      Object.assign(task, updateData);
      const updatedTask = await manager.save(task);

      if (dto.dueDate) {
        // TODO: Bắn vào BullMQ để cập nhật/tạo job mới cho deadline
        // logic: this.bullmqService.addJob('task-reminder', { taskId: updatedTask.id }, { delay: ... });
      }

      return updatedTask;
    });
  }

  async delete(id: string) {
    const result = await this.taskRepo.delete(id);
    if (result.affected === 0)
      throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);
    return { success: true };
  }

  async findOne(id: string) {
    const task = await this.taskRepo.findOne({
      where: { id },
      relations: ['labels'],
    });
    if (!task) throw new RpcException(TASK_ERROR.TASK_NOT_FOUND);
    return task;
  }

  async findMany(groupId: string) {
    return await this.taskRepo.find({
      where: { groupId },
      order: { order: 'ASC' },
      relations: ['labels'],
    });
  }

  getHello(): string {
    return 'Hello World!';
  }
}
