import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  EQueueName,
  BaseProcessor,
  EJobName,
  ITaskDeadlineJobData,
} from '@slack/queue';
import {
  NOTIFICATION_MESSAGE_PATTERNS,
  NAME_SERVICE_TCP,
  NotificationType,
} from '@slack/constants';
import { Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TaskEntity } from '../entity/task.entity';
import { TaskMemberEntity } from '../entity/task_member.entity';
import { firstValueFrom } from 'rxjs';

export interface ITaskProcessResult {
  success: boolean;
  recipients: number;
  reason?: string;
}

@Processor(EQueueName.TASK_QUEUE)
export class TaskProcessor extends BaseProcessor<
  ITaskDeadlineJobData,
  ITaskProcessResult,
  EJobName
> {
  constructor(
    @InjectRepository(TaskEntity)
    private readonly taskRepo: Repository<TaskEntity>,
    @InjectRepository(TaskMemberEntity)
    private readonly taskMemberRepo: Repository<TaskMemberEntity>,
    @Inject(NAME_SERVICE_TCP.NOTIFICATION_SERVICE)
    private readonly notificationClient: ClientProxy,
  ) {
    super();
  }

  async process(
    job: Job<ITaskDeadlineJobData, ITaskProcessResult, EJobName>,
  ): Promise<ITaskProcessResult> {
    const { taskId } = job.data;

    if (job.name === EJobName.TASK_DEADLINE_REMINDER) {
      try {
        // 1. Kiểm tra task còn tồn tại không
        const task = await this.taskRepo.findOne({
          where: { id: taskId },
          relations: ['group'],
        });

        if (!task) {
          this.logger.warn(
            `Task ${taskId} not found, skipping deadline reminder`,
          );
          return { success: false, reason: 'Task not found', recipients: 0 };
        }

        // 2. Lấy danh sách thành viên của task
        const members = await this.taskMemberRepo.find({
          where: { taskId },
        });

        if (members.length === 0) {
          this.logger.log(`Task ${taskId} has no members to notify`);
          return { success: true, recipients: 0 };
        }

        // 3. Gửi thông báo cho từng thành viên
        // Thông báo này sẽ được lưu vào bảng notification và bắn socket realtime
        const promises = members.map((member) => {
          return firstValueFrom(
            this.notificationClient.send(
              NOTIFICATION_MESSAGE_PATTERNS.PUSH_NOTIFICATION,
              {
                recipientId: member.memberId,
                type: NotificationType.TASK_DUE_SOON,
                templateKey: NotificationType.TASK_DUE_SOON,
                content: `Nhiệm vụ "${task.title}" sắp đến hạn!`,
                objectId: task.id,
                objectType: 'task',
                metadata: {
                  workspaceId: task.group.boardId,
                  groupId: task.groupId,
                },
              },
            ),
          ).catch((err) => {
            this.logger.error(
              `Failed to send notification to member ${member.memberId}: ${err.message}`,
            );
          });
        });

        await Promise.all(promises);
        this.logger.log(
          `Sent deadline reminders for task ${taskId} to ${members.length} members`,
        );

        return { success: true, recipients: members.length };
      } catch (error) {
        this.logger.error(
          `Failed to process task deadline reminder: ${error.message}`,
        );
        throw error;
      }
    }
    return { success: false, recipients: 0, reason: 'Unknown job name' };
  }
}
