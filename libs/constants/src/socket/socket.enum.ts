export enum ESocketEvent {
  // Connection & Auth
  SERVER_READY = 'server_ready',
  PING = 'ping',
  PONG = 'pong',

  // Message
  MESSAGE_RECEIVED = 'message_received',
  MESSAGE_UPDATED = 'message_updated',
  MESSAGE_DELETED = 'message_deleted',

  // Reaction
  REACTION_UPDATED = 'reaction_updated',

  // Channel Subscription
  SUBSCRIBE_CHANNEL = 'subscribe_channel',
  UNSUBSCRIBE_CHANNEL = 'unsubscribe_channel',
  SUBSCRIBED = 'subscribed',
  UNSUBSCRIBED = 'unsubscribed',

  // Thread Subscription
  SUBSCRIBE_THREAD = 'subscribe_thread',
  UNSUBSCRIBE_THREAD = 'unsubscribe_thread',
  THREAD_SUBSCRIBED = 'thread_subscribed',
  THREAD_UNSUBSCRIBED = 'thread_unsubscribed',

  // Notification / Unread
  UNREAD_COUNT_UPDATED = 'unread_count_updated',
  CHANNEL_UNREAD_UPDATED = 'channel_unread_updated',

  // MARK READ MESSAGE
  MESSAGE_READ = 'message_read',
}
