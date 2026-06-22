import { Processor } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import {
  BaseProcessor,
  EQueueName,
  EJobName,
  ICalendarRequestCreatedJobData,
  ICalendarRequestReviewedJobData,
} from '@slack/queue';
import {
  NAME_SERVICE_TCP,
  WORKSPACE_MESSAGE_PATTERNS,
  NOTIFICATION_MESSAGE_PATTERNS,
  NotificationType,
  NotificationObjectType,
} from '@slack/constants';
import { CalendarRequestType } from '../types/calendar.enum';


@Processor(EQueueName.CALENDAR_QUEUE, { concurrency: 5 })
export class CalendarProcessor extends BaseProcessor<
  any,
  void,
  EJobName
> {
  protected readonly logger = new Logger(CalendarProcessor.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.WORKSPACE_SERVICE)
    private readonly workspaceClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.NOTIFICATION_SERVICE)
    private readonly notificationClient: ClientProxy,
  ) {
    super();
  }

  async process(job: Job<any, void, EJobName>): Promise<void> {
    switch (job.name) {
      case EJobName.CALENDAR_REQUEST_CREATED:
        await this.handleCalendarRequestCreated(job);
        break;
      case EJobName.CALENDAR_REQUEST_REVIEWED:
        await this.handleCalendarRequestReviewed(job);
        break;
      default:
        this.logger.warn(`Unknown job name in CalendarProcessor: ${job.name}`);
    }
  }

  private async getWorkspaceAdmins(workspaceId: string): Promise<string[]> {
    try {
      const adminIds = await lastValueFrom(
        this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_WORKSPACE_ADMINS, {
          workspaceId,
        }),
      );
      if (!adminIds || !Array.isArray(adminIds)) return [];
      return adminIds;
    } catch (error) {
      this.logger.error(`Error fetching workspace admins: ${error.message}`);
      return [];
    }
  }

  private async handleCalendarRequestCreated(
    job: Job<ICalendarRequestCreatedJobData, void, EJobName>,
  ): Promise<void> {
    const { requestId, workspaceId, requesterId, requesterName, requestType, durationDays } = job.data;

    const requestTypeMap: Record<string, string> = {
      [CalendarRequestType.LEAVE_PAID]: 'nghỉ phép có lương',
      [CalendarRequestType.LEAVE_UNPAID]: 'nghỉ không lương',
      [CalendarRequestType.LEAVE_SICK]: 'nghỉ ốm',
      [CalendarRequestType.OFF_SHIFT]: 'chờ xếp ca',
      [CalendarRequestType.CALENDAR_OPEN_REQUEST]: 'mở lịch điểm danh',
    };
    
    const translatedType = requestTypeMap[requestType] || requestType;

    // Notify all admins in the workspace about the new request
    const adminIds = await this.getWorkspaceAdmins(workspaceId);

    // Remove requester from adminIds if they are an admin
    const recipientIds = adminIds.filter(id => id !== requesterId);

    if (recipientIds.length === 0) return;

    const content = `${requesterName} đã gửi yêu cầu ${translatedType} (${durationDays} ngày).`;

    const promises = recipientIds.map((adminId: string) => {
      return lastValueFrom(
        this.notificationClient.send(NOTIFICATION_MESSAGE_PATTERNS.PUSH_NOTIFICATION, {
          recipientId: adminId,
          type: NotificationType.CALENDAR_REQUEST_CREATED,
          templateKey: NotificationType.CALENDAR_REQUEST_CREATED,
          objectId: requestId,
          objectType: NotificationObjectType.CALENDAR,
          workspaceId,
          content,
          metadata: {
            actorId: requesterId,
            actorName: requesterName,
            requestId,
            requestType,
            durationDays,
          },
        }),
      ).catch(err => {
        this.logger.error(`Failed to push notification to ${adminId}: ${err.message}`);
      });
    });

    await Promise.all(promises);
    this.logger.log(`Notified ${recipientIds.length} admins about new calendar request ${requestId}`);
  }

  private async handleCalendarRequestReviewed(
    job: Job<ICalendarRequestReviewedJobData, void, EJobName>,
  ): Promise<void> {
    const { requestId, workspaceId, requesterId, reviewerId, reviewerName, status } = job.data;

    const action = status === 'APPROVED' ? 'được chấp thuận' : 'bị từ chối';
    const type = status === 'APPROVED'
      ? NotificationType.CALENDAR_REQUEST_APPROVED
      : NotificationType.CALENDAR_REQUEST_REJECTED;

    const promises: Promise<void>[] = [];

    // 1. Notify the original requester (if not the reviewer)
    if (requesterId !== reviewerId) {
      const requesterContent = `Yêu cầu lịch làm việc của bạn đã ${action} bởi ${reviewerName}.`;
      promises.push(
        lastValueFrom(
          this.notificationClient.send(NOTIFICATION_MESSAGE_PATTERNS.PUSH_NOTIFICATION, {
            recipientId: requesterId,
            type,
            templateKey: type,
            objectId: requestId,
            objectType: NotificationObjectType.CALENDAR,
            workspaceId,
            content: requesterContent,
            metadata: {
              actorId: reviewerId,
              actorName: reviewerName,
              requestId,
              status,
            },
          }),
        ).catch(err => this.logger.error(`Failed to notify requester ${requesterId}: ${err.message}`))
      );
    }

    // 2. Notify all admins and owners (except the reviewer)
    const adminIds = await this.getWorkspaceAdmins(workspaceId);
    const adminRecipients = adminIds.filter(id => id !== reviewerId);

    const adminContent = `Yêu cầu lịch làm việc của một nhân viên vừa ${action} bởi ${reviewerName}.`;
    
    adminRecipients.forEach(adminId => {
      promises.push(
        lastValueFrom(
          this.notificationClient.send(NOTIFICATION_MESSAGE_PATTERNS.PUSH_NOTIFICATION, {
            recipientId: adminId,
            type,
            templateKey: type,
            objectId: requestId,
            objectType: NotificationObjectType.CALENDAR,
            workspaceId,
            content: adminContent,
            metadata: {
              actorId: reviewerId,
              actorName: reviewerName,
              requestId,
              status,
            },
          }),
        ).catch(err => this.logger.error(`Failed to notify admin ${adminId}: ${err.message}`))
      );
    });

    await Promise.all(promises);
    this.logger.log(`Notified requester and ${adminRecipients.length} admins about request ${requestId} being ${status}`);
  }
}
