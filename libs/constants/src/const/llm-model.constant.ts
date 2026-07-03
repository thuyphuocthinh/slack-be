/**
 * Registry ánh xạ 1 "model id" (giá trị user chọn, hoặc default hệ thống)
 * sang đúng strategy (Gemini/OpenAI/Anthropic) + tên model thật của SDK
 * provider đó — LlmStrategyFactory dùng bảng này để resolve. Thêm model
 * mới chỉ cần thêm 1 dòng ở đây, không đụng code strategy/factory.
 */
export type LlmStrategyId = 'gemini' | 'openai' | 'anthropic';

export interface LlmModelRegistryEntry {
  strategyId: LlmStrategyId;
  /** Tên model thật truyền cho SDK của provider đó. */
  model: string;
  label: string;
}

export const LLM_MODEL_REGISTRY: Record<string, LlmModelRegistryEntry> = {
  'gemini-2.0-flash': { strategyId: 'gemini', model: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  'gemini-2.5-flash': { strategyId: 'gemini', model: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  'gemini-2.5-pro': { strategyId: 'gemini', model: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  'gpt-4o-mini': { strategyId: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o mini' },
  'gpt-4o': { strategyId: 'openai', model: 'gpt-4o', label: 'GPT-4o' },
  // Chưa có ANTHROPIC_API_KEY để test thật — 2 dòng dưới CHƯA xác nhận đúng
  // model id hiện hành của Anthropic, kiểm tra lại https://docs.anthropic.com/en/docs/about-claude/models
  // trước khi bật thật (đổi giá trị "model" nếu cần, không cần đụng code strategy).
  'claude-haiku': { strategyId: 'anthropic', model: 'claude-3-5-haiku-20241022', label: 'Claude Haiku' },
  'claude-sonnet': { strategyId: 'anthropic', model: 'claude-3-5-sonnet-20241022', label: 'Claude Sonnet' },
};
