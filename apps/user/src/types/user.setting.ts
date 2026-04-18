export interface UserSettings {
  ui: {
    theme: 'light' | 'dark';
    language: 'vi' | 'en';
    density: 'comfortable' | 'compact';
  };

  notification: {
    desktop: boolean;
    mention_only: boolean;
  };

  messaging: {
    enter_to_send: boolean;
    show_preview: boolean;
  };

  privacy: {
    allow_dm_from: 'everyone' | 'members' | 'none';
  };
}
