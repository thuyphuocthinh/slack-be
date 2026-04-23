export enum NotificationType {
  // message
  MESSAGE_RECEIVED = 'MESSAGE_RECEIVED',
  MENTIONED_IN_MESSAGE = 'MENTIONED_IN_MESSAGE',
  REPLY_IN_THREAD = 'REPLY_IN_THREAD',

  // reaction
  REACTION_ADDED = 'REACTION_ADDED',

  // channel
  ADDED_TO_CHANNEL = 'ADDED_TO_CHANNEL',
  REMOVED_FROM_CHANNEL = 'REMOVED_FROM_CHANNEL',

  // task
  TASK_ASSIGNED = 'TASK_ASSIGNED',
  TASK_UPDATED = 'TASK_UPDATED',

  // system
  WORKSPACE_INVITED = 'WORKSPACE_INVITED',
}

export enum NotificationStatus {
  UNREAD = 'unread',
  READ = 'read',
  ARCHIVED = 'archived',
}
