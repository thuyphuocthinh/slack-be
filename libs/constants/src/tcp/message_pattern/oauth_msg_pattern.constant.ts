export const OAUTH_MESSAGE_PATTERNS = {
  // Developer Console
  CREATE_CLIENT: 'oauth.create_client',
  GET_CLIENTS: 'oauth.get_clients',
  GET_CLIENT_DETAILS: 'oauth.get_client_details',
  UPDATE_CLIENT: 'oauth.update_client',
  REGENERATE_CLIENT_SECRET: 'oauth.regenerate_client_secret',
  DELETE_CLIENT: 'oauth.delete_client',
  
  // OAuth Server Flow
  GET_AUTHORIZE_DETAILS: 'oauth.get_authorize_details',
  APPROVE_CONSENT: 'oauth.approve_consent',
  EXCHANGE_TOKEN: 'oauth.exchange_token',
  GET_USERINFO: 'oauth.get_userinfo',
  VERIFY_TOKEN_SCOPE: 'oauth.verify_token_scope',
  REVOKE_TOKEN: 'oauth.revoke_token',
  GET_AUTHORIZED_CLIENTS: 'oauth.get_authorized_clients',
  REVOKE_AUTHORIZED_CLIENT: 'oauth.revoke_authorized_client',
} as const;
