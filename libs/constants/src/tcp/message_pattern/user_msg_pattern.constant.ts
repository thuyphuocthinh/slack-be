export const USER_MESSAGE_PATTERNS = {
  CREATE_USER: 'user.create',
  CHANGE_USER_STATUS: 'user.change_status',
  GET_USER_BY_ID: 'user.get_by_id',
  IS_USER_ENABLE_TWO_FACTOR: 'user.is_enable_two_factor',
  CHANGE_AVATAR: 'user.change_avatar',
  UPDATE_INFO: 'user.update_info',
  CHANGE_PASSWORD: 'user.change_password',
  GET_USER_PREFERENCE: 'user.get_preference',
  UPDATE_USER_PREFERENCE: 'user.update_preference',
} as const;
