import { getCurrentRunTree } from 'langsmith/traceable';
import { EMBEDDING_MODEL_PRICING, LLM_MODEL_REGISTRY } from '@slack/constants';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  // OpenAI trả về khi prompt cache hit (prefix giống hệt lần gọi trước) —
  // phần này được tính giá rẻ hơn hẳn input thường. undefined/0 = không cache.
  cachedTokens?: number;
}

// Giai đoạn 4, Step 7 — giá THAM KHẢO (USD/1 triệu token), lấy từ
// LLM_MODEL_REGISTRY (libs/constants). Không có API nào trả giá thật theo
// từng model — cần tự cập nhật tay khi provider đổi giá, chỉ để ước lượng
// tương đối cho việc theo dõi chi phí, không phải số trên hoá đơn thật.
export function estimateCostUsd(
  modelId: string,
  usage: TokenUsage,
): number | null {
  let entry = LLM_MODEL_REGISTRY[modelId];
  if (!entry) {
    // Reverse lookup cho trường hợp dùng 9Router (modelId bị gắn thêm tiền tố openai/...)
    entry = Object.values(LLM_MODEL_REGISTRY).find(
      (e) => e.model === modelId,
    ) as any;
  }
  if (!entry) return null;
  return (
    (usage.inputTokens / 1_000_000) * entry.pricePerMillionInputTokens +
    (usage.outputTokens / 1_000_000) * entry.pricePerMillionOutputTokens
  );
}

// Embedding không có output tokens — giá tra riêng ở EMBEDDING_MODEL_PRICING
// (KHÔNG phải LLM_MODEL_REGISTRY, model đó không phải chat model).
export function estimateEmbeddingCostUsd(
  modelId: string,
  inputTokens: number,
): number | null {
  const pricePerMillion = EMBEDDING_MODEL_PRICING[modelId];
  if (pricePerMillion === undefined) return null;
  return (inputTokens / 1_000_000) * pricePerMillion;
}

// Cùng convention gắn usage_metadata với attachLlmCostMetadata() — chỉ dùng
// được từ bên trong 1 hàm đã bọc traceable() với run_type: 'llm'.
export function attachEmbeddingCostMetadata(
  modelId: string,
  inputTokens: number,
): void {
  const runTree = getCurrentRunTree(true);
  if (!runTree) return;

  const totalCostUsd = estimateEmbeddingCostUsd(modelId, inputTokens);
  runTree.metadata = {
    usage_metadata: {
      input_tokens: inputTokens,
      total_tokens: inputTokens,
      ...(totalCostUsd !== null ? { total_cost: totalCostUsd } : {}),
    },
  };
}

// Gắn usage/chi phí ước lượng vào LangSmith trace của lượt gọi LLM HIỆN TẠI —
// chỉ dùng được từ bên TRONG 1 hàm đã bọc traceable() với run_type: 'llm'.
// getCurrentRunTree(true) trả undefined (thay vì throw) khi tracing đang tắt
// hoặc không có run nào đang chạy — no-op an toàn, không cần try/catch ở từng call site.
//
// PHẢI dùng đúng key "usage_metadata" (snake_case, input_tokens/output_tokens/
// total_tokens) — đây là convention LangSmith backend thật sự đọc để tự tính
// cost + cộng dồn token lên root trace của cả turn (xem _populateUsageMetadataAndOutputs
// trong langsmith/dist/traceable.js). Field tự đặt tên khác (VD "inputTokens"
// camelCase) sẽ bị bỏ qua hoàn toàn, không hiện trong "Cost" alert/dashboard.
export function attachLlmCostMetadata(
  modelId: string,
  usage: TokenUsage,
): void {
  const runTree = getCurrentRunTree(true);
  if (!runTree) return;

  const totalCostUsd = estimateCostUsd(modelId, usage);
  runTree.metadata = {
    usage_metadata: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      total_tokens: usage.inputTokens + usage.outputTokens,
      // Tự cung cấp total_cost (thay vì để LangSmith tự tra bảng giá nội bộ
      // của họ) — model mới/ít phổ biến (VD gemini-3.5-flash) có thể chưa có
      // trong bảng giá LangSmith, số tự tính từ LLM_MODEL_REGISTRY đáng tin hơn.
      ...(totalCostUsd !== null ? { total_cost: totalCostUsd } : {}),
      ...(usage.cachedTokens !== undefined
        ? { cached_tokens: usage.cachedTokens }
        : {}),
    },
  };
}
