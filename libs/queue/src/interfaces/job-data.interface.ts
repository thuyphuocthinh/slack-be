import { EJobName } from '../constants/queue.constant';

export interface IInviteJobData {
  to: string;
  subject: string;
  template: string;
  context: Record<string, any>;
}

export interface IEmailJobData {
  email: string;
  code: string;
}

export interface IPushNotificationData {
  recipientId: string;
  type: string;
  templateKey?: string;
  content?: string;
  objectId?: string;
  objectType?: string;
  metadata?: any;
  workspaceId: string;
}

export interface ICreateNotificationJobData {
  channelId: string;
  channelName: string;
  senderId: string;
  senderName: string;
  messageId: string;
  mentions?: any[];
  parentId?: string;
  workspaceId: string;
  content: string;
}

export interface IEmitEventJobData {
  event: string;
  room?: string | string[];
  data: any;
}

export interface IIncrementUnreadJobData {
  channelId: string;
  senderId: string;
}

export interface ITaskDeadlineJobData {
  taskId: string;
}

export interface IUpdateResourceMetadataJobData {
  resourceIds: string[];
  refType: string;
  refId: string;
}

export type TJobData = {
  [EJobName.SEND_VERIFICATION_EMAIL]: IEmailJobData;
  [EJobName.SEND_INVITE_EMAIL]: IInviteJobData;
  [EJobName.SEND_PASSWORD_RESET_EMAIL]: IEmailJobData;
  [EJobName.CREATE_NOTIFICATION]: ICreateNotificationJobData;
  [EJobName.EMIT_EVENT]: IEmitEventJobData;
  [EJobName.INCREMENT_UNREAD_COUNT]: IIncrementUnreadJobData;
  [EJobName.TASK_DEADLINE_REMINDER]: ITaskDeadlineJobData;
  [EJobName.UPDATE_RESOURCE_METADATA]: IUpdateResourceMetadataJobData;
};
