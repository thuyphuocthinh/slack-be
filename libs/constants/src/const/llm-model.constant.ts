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
  // accuracy_problem.md — context window THẬT của model (theo công bố của
  // provider), dùng để tính ngân sách cap dữ liệu tool-result theo ĐÚNG model
  // đang xử lý nó (xem tool-result-size-cap.util.ts:resolveDataCharBudget),
  // thay vì 1 hằng số cố định không liên quan gì tới model đang dùng.
  contextWindowTokens: number;
}

export const LLM_MODEL_REGISTRY: Record<string, LlmModelRegistryEntry> = {
  'gemini-2.0-flash': {
    strategyId: 'gemini',
    model: 'gemini-2.0-flash',
    label: 'Gemini 2.0 Flash',
    pricePerMillionInputTokens: 0.1,
    pricePerMillionOutputTokens: 0.4,
    contextWindowTokens: 1_048_576,
  },
  'gemini-2.5-flash': {
    strategyId: 'gemini',
    model: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    pricePerMillionInputTokens: 0.3,
    pricePerMillionOutputTokens: 2.5,
    contextWindowTokens: 1_048_576,
  },
  'gemini-2.5-pro': {
    strategyId: 'gemini',
    model: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    pricePerMillionInputTokens: 1.25,
    pricePerMillionOutputTokens: 10,
    contextWindowTokens: 1_048_576,
  },
  // Free tier RPD=20, tách quota riêng với 2.0/2.5-flash (Google AI Studio
  // dashboard 2026-07-03: 2.0-flash còn 0/0 — hết được cấp free tier).
  'gemini-3.5-flash': {
    strategyId: 'gemini',
    model: 'gemini-3.5-flash',
    label: 'Gemini 3.5 Flash',
    // Model chưa công bố giá/context window chính thức lúc viết — tạm dùng
    // ngang 2.5-flash, SỬA lại khi Google công bố số liệu thật.
    pricePerMillionInputTokens: 0.3,
    pricePerMillionOutputTokens: 2.5,
    contextWindowTokens: 1_048_576,
  },
  'gpt-4o-mini': {
    strategyId: 'openai',
    model: 'openai/gpt-4o-mini',
    label: 'GPT-4o mini',
    pricePerMillionInputTokens: 0.15,
    pricePerMillionOutputTokens: 0.6,
    contextWindowTokens: 128_000,
  },
  // Rẻ hơn gpt-4o-mini ~33% ($0.10/$0.40 vs $0.15/$0.60) — OpenAI định vị cho
  // classification/routing/quyết định đơn giản, đúng việc SUPERVISOR_EVALUATE_MODEL
  // cần (xem accuracy_problem.md). Đi qua 9Router giống mọi model khác — CHƯA
  // xác nhận 9Router route được model id này, cần test thật trước khi tin dùng.
  'gpt-4.1-nano': {
    strategyId: 'openai',
    model: 'openai/gpt-4.1-nano',
    label: 'GPT-4.1 nano',
    pricePerMillionInputTokens: 0.1,
    pricePerMillionOutputTokens: 0.4,
    contextWindowTokens: 1_047_576,
  },
  'gpt-4o': {
    strategyId: 'openai',
    model: 'openai/gpt-4o',
    label: 'GPT-4o',
    pricePerMillionInputTokens: 2.5,
    pricePerMillionOutputTokens: 10,
    contextWindowTokens: 128_000,
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
    contextWindowTokens: 200_000,
  },
  'claude-sonnet': {
    strategyId: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    label: 'Claude Sonnet',
    pricePerMillionInputTokens: 3,
    pricePerMillionOutputTokens: 15,
    contextWindowTokens: 200_000,
  },
};

// Model embedding KHÔNG phải chat model (không có output tokens, không đi
// qua LlmStrategyFactory) — tách khỏi LLM_MODEL_REGISTRY, chỉ giữ giá
// tham khảo (USD/1 triệu token) để ước lượng chi phí (xem estimateEmbeddingCostUsd).
export const EMBEDDING_MODEL_PRICING: Record<string, number> = {
  'text-embedding-3-small': 0.02,
};
