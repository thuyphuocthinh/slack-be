export enum EQueueName {
  NOTIFICATION_QUEUE = 'notification',
  EMAIL_QUEUE = 'email',
  WORKSPACE_QUEUE = 'workspace',
  MESSAGE_QUEUE = 'message',
  CHANNEL_QUEUE = 'channel',
  AUDIT_QUEUE = 'audit',
  SOCKET_QUEUE = 'socket',
  TASK_QUEUE = 'task',
  RESOURCE_QUEUE = 'resource',
  OUTBOUND_WEBHOOK_QUEUE = 'outbound_webhook',
}

export enum EJobName {
  // Email
  SEND_VERIFICATION_EMAIL = 'send_verification_email',
  SEND_PASSWORD_RESET_EMAIL = 'send_password_reset_email',
  SEND_INVITE_EMAIL = 'send_invite_email',
  SEND_UNRECOGNIZED_DEVICE_EMAIL = 'send_unrecognized_device_email',

  // Notification
  CREATE_NOTIFICATION = 'create_notification',

  // Socket
  EMIT_EVENT = 'emit_event',
  EMIT_TO_USERS = 'emit_to_users',

  // Channel
  INCREMENT_UNREAD_COUNT = 'increment_unread_count',

  // Task
  TASK_DEADLINE_REMINDER = 'task_deadline_reminder',

  // Resource
  UPDATE_RESOURCE_METADATA = 'update_resource_metadata',

  // Audit
  SAVE_AUDIT_LOG = 'save_audit_log',

  // Webhook
  PROCESS_WEBHOOK_MESSAGE = 'process_webhook_message',
  DISPATCH_OUTBOUND_WEBHOOK = 'dispatch_outbound_webhook',
}

