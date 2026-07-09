export const ORCHESTRATION_MESSAGE_PATTERNS = {
  GET_PROVIDERS: 'orchestration.get_providers',
  INITIATE_CONNECT: 'orchestration.initiate_connect',
  SUBMIT_CREDENTIALS: 'orchestration.submit_credentials',
  DISCONNECT_PROVIDER: 'orchestration.disconnect_provider',
  RESOLVE_APPROVAL: 'orchestration.resolve_approval',
  TRIGGER_PROMPT: 'orchestration.trigger_prompt',
  REGISTER_DYNAMIC_PROVIDER: 'orchestration.register_dynamic_provider',
  DELETE_DYNAMIC_PROVIDER: 'orchestration.delete_dynamic_provider',
} as const;
