export const MESSAGE_MESSAGE_PATTERNS = {
  CREATE: 'message.create',
  GET_MESSAGES: 'message.get_messages',
  GET_BY_ID: 'message.get_by_id',
  UPDATE: 'message.update',
  DELETE: 'message.delete',
  TOGGLE_REACTION: 'message.toggle_reaction',
  TOGGLE_PIN: 'message.toggle_pin',
  SEARCH: 'message.search',
  GET_THREADS: 'message.get_threads',
} as const;
