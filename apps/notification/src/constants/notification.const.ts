export const NOTIFICATION_TEMPLATE_KEYS = {
  // message
  MESSAGE_RECEIVED: 'message_received',
  MENTIONED_IN_MESSAGE: 'mentioned_in_message',
  REPLY_IN_THREAD: 'reply_in_thread',
  MESSAGE_REACTION_ADDED: 'message_reaction_added',

  // channel
  USER_ADDED_TO_CHANNEL: 'user_added_to_channel',
  USER_REMOVED_FROM_CHANNEL: 'user_removed_from_channel',
  CHANNEL_CREATED: 'channel_created',
  CHANNEL_RENAMED: 'channel_renamed',

  // workspace
  INVITED_TO_WORKSPACE: 'invited_to_workspace',
  JOINED_WORKSPACE: 'joined_workspace',

  // task
  TASK_ASSIGNED: 'task_assigned',
  TASK_UPDATED: 'task_updated',

  // system
  SYSTEM_ANNOUNCEMENT: 'system_announcement',
} as const;

export type NotificationTemplateKey =
  (typeof NOTIFICATION_TEMPLATE_KEYS)[keyof typeof NOTIFICATION_TEMPLATE_KEYS];
