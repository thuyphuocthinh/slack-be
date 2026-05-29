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

export interface IUnrecognizedDeviceEmailJobData {
  email: string;
  ipAddress?: string;
  userAgent?: string;
  time: string;
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
  reaction?: string;
  recipientId?: string;
}

export interface IEmitEventJobData {
  event: string;
  room?: string | string[];
  data: any;
}

export interface IEmitToUsersJobData {
  event: string;
  userIds: string[];
  data: Record<string, unknown>;
}

export interface IIncrementUnreadJobData {
  channelId: string;
  senderId: string;
}

export interface ITaskDeadlineJobData {
  taskId: string;
  groupId: string;
  boardId: string;
}

export interface IUpdateResourceMetadataJobData {
  resourceIds: string[];
  refType: string;
  refId: string;
}

export interface IAuditJobData {
  action: string;
  actorId?: string;
  targetId?: string;
  entityType: string;
  entityId: string;
  metadata?: Record<string, any>;
}

export interface IProcessWebhookMessageJobData {
  channelId: string;
  workspaceId: string;
  webhookId: string;
  customName?: string;
  customAvatarUrl?: string;
  content: string;
  attachments?: Record<string, unknown>[];
}

export interface IDispatchOutboundWebhookJobData {
  appId: string;
  eventType: string;
  workspaceId: string;
  payload: Record<string, unknown>;
}

export type TJobData = {
  [EJobName.SEND_VERIFICATION_EMAIL]: IEmailJobData;
  [EJobName.SEND_INVITE_EMAIL]: IInviteJobData;
  [EJobName.SEND_PASSWORD_RESET_EMAIL]: IEmailJobData;
  [EJobName.CREATE_NOTIFICATION]: ICreateNotificationJobData;
  [EJobName.EMIT_EVENT]: IEmitEventJobData;
  [EJobName.EMIT_TO_USERS]: IEmitToUsersJobData;
  [EJobName.INCREMENT_UNREAD_COUNT]: IIncrementUnreadJobData;
  [EJobName.TASK_DEADLINE_REMINDER]: ITaskDeadlineJobData;
  [EJobName.UPDATE_RESOURCE_METADATA]: IUpdateResourceMetadataJobData;
  [EJobName.SAVE_AUDIT_LOG]: IAuditJobData;
  [EJobName.PROCESS_WEBHOOK_MESSAGE]: IProcessWebhookMessageJobData;
  [EJobName.DISPATCH_OUTBOUND_WEBHOOK]: IDispatchOutboundWebhookJobData;
  [EJobName.SEND_UNRECOGNIZED_DEVICE_EMAIL]: IUnrecognizedDeviceEmailJobData;
};

