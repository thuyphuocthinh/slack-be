import { z } from 'zod';
import { NotificationType } from '@slack/constants';

export const NotificationMetadataSchema = {
  // ======================
  // MESSAGE
  // ======================
  [NotificationType.MESSAGE_RECEIVED]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    messageId: z.string(),
    channelId: z.string(),
    channelName: z.string().nullable().optional(),
    snippet: z.string().optional(),
  }).passthrough(),

  [NotificationType.MENTIONED_IN_MESSAGE]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    messageId: z.string(),
    channelId: z.string(),
    channelName: z.string().nullable().optional(),
    snippet: z.string().optional(),
  }).passthrough(),

  [NotificationType.REPLY_IN_THREAD]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    messageId: z.string(),
    threadId: z.string().optional(),
    parentId: z.string().optional(),
    channelId: z.string().optional(),
    channelName: z.string().nullable().optional(),
    snippet: z.string().optional(),
  }).passthrough(),

  [NotificationType.MESSAGE_REACTION_ADDED]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    messageId: z.string(),
    reaction: z.string(), // 👍 ❤️ 😂
  }).passthrough(),

  // ======================
  // CHANNEL
  // ======================
  [NotificationType.USER_ADDED_TO_CHANNEL]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    targetUserId: z.string(),
    channelId: z.string(),
    channelName: z.string(),
  }),

  [NotificationType.USER_REMOVED_FROM_CHANNEL]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    targetUserId: z.string(),
    channelId: z.string(),
    channelName: z.string(),
  }),

  [NotificationType.CHANNEL_CREATED]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    channelId: z.string(),
    channelName: z.string(),
  }),

  [NotificationType.CHANNEL_RENAMED]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    channelId: z.string(),
    oldName: z.string(),
    newName: z.string(),
  }),

  // ======================
  // WORKSPACE
  // ======================
  [NotificationType.INVITED_TO_WORKSPACE]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    workspaceId: z.string(),
    workspaceName: z.string(),
  }),

  [NotificationType.JOINED_WORKSPACE]: z.object({
    userId: z.string(),
    userName: z.string(),
    workspaceId: z.string(),
    workspaceName: z.string(),
  }),

  // ======================
  // TASK
  // ======================
  [NotificationType.TASK_ASSIGNED]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    taskId: z.string(),
    taskTitle: z.string(),
  }),

  [NotificationType.TASK_UPDATED]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    taskId: z.string(),
    taskTitle: z.string(),
    changes: z.record(z.string(), z.any()).optional(), // flexible
  }),

  // ======================
  // SYSTEM
  // ======================
  [NotificationType.SYSTEM_ANNOUNCEMENT]: z.object({
    title: z.string(),
    content: z.string(),
  }),

  [NotificationType.WORKSPACE_INVITED]: z.object({
    actorId: z.string(),
    actorName: z.string(),
    workspaceId: z.string(),
  }),
} as const;

export type NotificationTemplateKey = NotificationType;
