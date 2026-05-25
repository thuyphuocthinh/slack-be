import { UserSettings } from '../types/user.setting';

export const DEFAULT_USER_PREFERENCE: UserSettings = {
  ui: {
    theme: 'light',
    language: 'vi',
    density: 'comfortable',
  },

  notification: {
    desktop: true,
    mention_only: false,
  },

  messaging: {
    enter_to_send: true,
    show_preview: true,
  },

  privacy: {
    allow_dm_from: 'everyone',
  },
};
