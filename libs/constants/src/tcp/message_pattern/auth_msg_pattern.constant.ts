export const AUTH_MESSAGE_PATTERNS = {
  REGISTER: 'auth.register',
  VERIFY_EMAIL: 'auth.verify_email',
  LOGIN: 'auth.login',
  REFRESH: 'auth.refresh',
  LOGIN_GOOGLE: 'auth.login_google',
  FORGOT_PASSWORD: 'auth.forgot_password',
  VERIFY_RESET_PASSWORD: 'auth.verify_reset_password',
  RESET_PASSWORD: 'auth.reset_password',
  LOGOUT: 'auth.logout',
  LOGOUT_ALL: 'auth.logout_all',
} as const;
