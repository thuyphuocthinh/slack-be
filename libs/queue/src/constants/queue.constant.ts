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
  INCOMING_WEBHOOK_QUEUE = 'incoming_webhook',
  LINK_PREVIEW_QUEUE = 'link_preview',
  CALENDAR_QUEUE = 'calendar',
  INTEGRATION_SYNC_QUEUE = 'integration_sync',
}

export enum EJobName {
  // Email
  SEND_VERIFICATION_EMAIL = 'send_verification_email',
  SEND_PASSWORD_RESET_EMAIL = 'send_password_reset_email',
  SEND_INVITE_EMAIL = 'send_invite_email',
  SEND_UNRECOGNIZED_DEVICE_EMAIL = 'send_unrecognized_device_email',
  SEND_GENERIC_EMAIL = 'send_generic_email',

  // Notification
  CREATE_NOTIFICATION = 'create_notification',
  SEND_PUSH_NOTIFICATION = 'send_push_notification',

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
  PROCESS_INCOMING_WEBHOOK = 'process_incoming_webhook',
  GENERATE_LINK_PREVIEW = 'generate_link_preview',

  // Calendar
  CALENDAR_REQUEST_CREATED = 'calendar_request_created',
  CALENDAR_REQUEST_REVIEWED = 'calendar_request_reviewed',
  CALENDAR_EXPORT_EXCEL = 'calendar_export_excel',

  // Integrations Sync
  SYNC_CALENDAR_SHIFT = 'sync_calendar_shift',
  DELETE_CALENDAR_SHIFT = 'delete_calendar_shift',
}

