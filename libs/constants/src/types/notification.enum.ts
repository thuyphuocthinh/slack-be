export enum NotificationType {
  // message
  MESSAGE_RECEIVED = 'message_received',
  MENTIONED_IN_MESSAGE = 'mentioned_in_message',
  REPLY_IN_THREAD = 'reply_in_thread',
  MESSAGE_REACTION_ADDED = 'message_reaction_added',

  // channel
  USER_ADDED_TO_CHANNEL = 'user_added_to_channel',
  USER_REMOVED_FROM_CHANNEL = 'user_removed_from_channel',
  CHANNEL_CREATED = 'channel_created',
  CHANNEL_RENAMED = 'channel_renamed',

  // workspace
  INVITED_TO_WORKSPACE = 'invited_to_workspace',
  JOINED_WORKSPACE = 'joined_workspace',

  // task
  TASK_ASSIGNED = 'task_assigned',
  TASK_UPDATED = 'task_updated',
  TASK_DUE_SOON = 'task_due_soon',

  // system
  SYSTEM_ANNOUNCEMENT = 'system_announcement',
  WORKSPACE_INVITED = 'workspace_invited',

  // calendar
  CALENDAR_REQUEST_CREATED = 'calendar_request_created',
  CALENDAR_REQUEST_APPROVED = 'calendar_request_approved',
  CALENDAR_REQUEST_REJECTED = 'calendar_request_rejected',
}

export enum NotificationStatus {
  UNREAD = 'unread',
  READ = 'read',
  ARCHIVED = 'archived',
}

export enum NotificationObjectType {
  MESSAGE = 'MESSAGE',
  CHANNEL = 'CHANNEL',
  WORKSPACE = 'WORKSPACE',
  TASK = 'TASK',
  CALENDAR = 'CALENDAR',
}
