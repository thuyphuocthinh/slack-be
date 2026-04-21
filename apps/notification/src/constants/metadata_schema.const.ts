import { z } from 'zod';
import {
  NOTIFICATION_TEMPLATE_KEYS,
  NotificationTemplateKey,
} from './notification.const';

export const NotificationMetadataSchema = {
  // ======================
  // MESSAGE
  // ======================
  [NOTIFICATION_TEMPLATE_KEYS.MESSAGE_RECEIVED]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    messageId: z.string(),
    channelId: z.string(),
    channelName: z.string(),
    snippet: z.string().optional(),
  }),

  [NOTIFICATION_TEMPLATE_KEYS.MENTIONED_IN_MESSAGE]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    messageId: z.string(),
    channelId: z.string(),
    channelName: z.string(),
    snippet: z.string(),
  }),

  [NOTIFICATION_TEMPLATE_KEYS.REPLY_IN_THREAD]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    messageId: z.string(),
    threadId: z.string(),
    snippet: z.string().optional(),
  }),

  [NOTIFICATION_TEMPLATE_KEYS.MESSAGE_REACTION_ADDED]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    messageId: z.string(),
    reaction: z.string(), // 👍 ❤️ 😂
  }),

  // ======================
  // CHANNEL
  // ======================
  [NOTIFICATION_TEMPLATE_KEYS.USER_ADDED_TO_CHANNEL]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    targetUserId: z.string(),
    channelId: z.string(),
    channelName: z.string(),
  }),

  [NOTIFICATION_TEMPLATE_KEYS.USER_REMOVED_FROM_CHANNEL]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    targetUserId: z.string(),
    channelId: z.string(),
    channelName: z.string(),
  }),

  [NOTIFICATION_TEMPLATE_KEYS.CHANNEL_CREATED]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    channelId: z.string(),
    channelName: z.string(),
  }),

  [NOTIFICATION_TEMPLATE_KEYS.CHANNEL_RENAMED]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    channelId: z.string(),
    oldName: z.string(),
    newName: z.string(),
  }),

  // ======================
  // WORKSPACE
  // ======================
  [NOTIFICATION_TEMPLATE_KEYS.INVITED_TO_WORKSPACE]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    workspaceId: z.string(),
    workspaceName: z.string(),
  }),

  [NOTIFICATION_TEMPLATE_KEYS.JOINED_WORKSPACE]: z.object({
    userId: z.string(),
    userName: z.string(),
    workspaceId: z.string(),
    workspaceName: z.string(),
  }),

  // ======================
  // TASK
  // ======================
  [NOTIFICATION_TEMPLATE_KEYS.TASK_ASSIGNED]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    taskId: z.string(),
    taskTitle: z.string(),
  }),

  [NOTIFICATION_TEMPLATE_KEYS.TASK_UPDATED]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    taskId: z.string(),
    taskTitle: z.string(),
    changes: z.record(z.string(), z.any()).optional(), // flexible
  }),

  // ======================
  // SYSTEM
  // ======================
  [NOTIFICATION_TEMPLATE_KEYS.SYSTEM_ANNOUNCEMENT]: z.object({
    title: z.string(),
    content: z.string(),
  }),
} as const;

export type MetadataOf<T extends NotificationTemplateKey> = z.infer<
  (typeof NotificationMetadataSchema)[T]
>;
