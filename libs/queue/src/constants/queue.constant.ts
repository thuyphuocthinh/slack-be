export enum EQueueName {
  NOTIFICATION_QUEUE = 'notification',
  EMAIL_QUEUE = 'email',
  WORKSPACE_QUEUE = 'workspace',
  MESSAGE_QUEUE = 'message',
  CHANNEL_QUEUE = 'channel',
  AUDIT_QUEUE = 'audit',
  SOCKET_QUEUE = 'socket',
}

export enum EJobName {
  SEND_VERIFICATION_EMAIL = 'send_verification_email',
  SEND_PASSWORD_RESET_EMAIL = 'send_password_reset_email',
  SEND_INVITE_EMAIL = 'send_invite_email',
}
