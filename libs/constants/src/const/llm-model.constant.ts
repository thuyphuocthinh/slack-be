/**
 * Registry ánh xạ 1 "model id" (giá trị user chọn, hoặc default hệ thống)
 * sang đúng strategy (Gemini/OpenAI/Anthropic) + tên model thật của SDK
 * provider đó — LlmStrategyFactory dùng bảng này để resolve. Thêm model
 * mới chỉ cần thêm 1 dòng ở đây, không đụng code strategy/factory.
 */
export type LlmStrategyId = 'gemini' | 'openai' | 'anthropic';

export interface LlmModelRegistryEntry {
  strategyId: LlmStrategyId;
  model: string;
  label: string;
  pricePerMillionInputTokens: number;
  pricePerMillionOutputTokens: number;
}

export const LLM_MODEL_REGISTRY: Record<string, LlmModelRegistryEntry> = {
  'gemini-2.0-flash': {
    strategyId: 'gemini',
    model: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    pricePerMillionInputTokens: 0.1,
    pricePerMillionOutputTokens: 0.4,
  },
  'gemini-2.5-flash': {
    strategyId: 'gemini',
    model: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    pricePerMillionInputTokens: 0.3,
    pricePerMillionOutputTokens: 2.5,
  },
  'gemini-2.5-pro': {
    strategyId: 'gemini',
    model: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    pricePerMillionInputTokens: 1.25,
    pricePerMillionOutputTokens: 10,
  },
  // Free tier RPD=20, tách quota riêng với 2.0/2.5-flash (Google AI Studio
  // dashboard 2026-07-03: 2.0-flash còn 0/0 — hết được cấp free tier).
  'gemini-3.5-flash': {
    strategyId: 'gemini',
    model: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    // Model chưa công bố giá chính thức lúc viết — tạm dùng ngang 2.5-flash,
    // SỬA lại khi Google công bố giá thật.
    pricePerMillionInputTokens: 0.3,
    pricePerMillionOutputTokens: 2.5,
  },
  'gpt-4o-mini': {
    strategyId: 'openai',
    model: 'gpt-4o-mini',
    label: 'GPT-4o mini',
    pricePerMillionInputTokens: 0.15,
    pricePerMillionOutputTokens: 0.6,
  },
  'gpt-4o': {
    strategyId: 'openai',
    model: 'gpt-4o',
    label: 'GPT-4o',
    pricePerMillionInputTokens: 2.5,
    pricePerMillionOutputTokens: 10,
  },
  // Chưa có ANTHROPIC_API_KEY để test thật — 2 dòng dưới CHƯA xác nhận đúng
  // model id hiện hành của Anthropic, kiểm tra lại https://docs.anthropic.com/en/docs/about-claude/models
  // trước khi bật thật (đổi giá trị "model" nếu cần, không cần đụng code strategy).
  'claude-haiku': {
    strategyId: 'anthropic',
    model: 'claude-3-5-haiku-20241022',
    label: 'Claude Haiku',
    pricePerMillionInputTokens: 0.8,
    pricePerMillionOutputTokens: 4,
  },
  'claude-sonnet': {
    strategyId: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    label: 'Claude Sonnet',
    pricePerMillionInputTokens: 3,
    pricePerMillionOutputTokens: 15,
  },
};
