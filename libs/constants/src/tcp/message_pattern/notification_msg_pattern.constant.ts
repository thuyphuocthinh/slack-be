export const NOTIFICATION_MESSAGE_PATTERNS = {
  SEND_VERIFICATION_EMAIL: 'notification.send_verification_email',
  SEND_RESET_PASSWORD_EMAIL: 'notification.send_reset_password_email',
  SEND_MAIL: 'notification.send_mail',
  FETCH_NOTIFICATIONS: 'notification.fetch_notifications',
  PUSH_NOTIFICATION: 'notification.push_notification',
  MARK_AS_READ: 'notification.mark_as_read',
  MARK_ALL_AS_READ: 'notification.mark_all_as_read',
  GET_SETTINGS: 'notification.get_settings',
  UPDATE_SETTINGS: 'notification.update_settings',
  DELETE_NOTIFICATION: 'notification.delete_notification',
  GET_UNREAD_SUMMARY: 'notification.get_unread_summary',
} as const;
