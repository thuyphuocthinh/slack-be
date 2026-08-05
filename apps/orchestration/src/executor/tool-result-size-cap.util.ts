import {
  ContextCapper,
  PayloadMinifier,
  MarkupCleaner,
  PayloadCompressor,
  JsonValue,
} from 'agentic-io-parser';
import { LLM_MODEL_REGISTRY } from '@slack/constants';
import { isLikelyReadOnlyRound } from './read-only-round-heuristic.util';

// Chặn cuối cùng trước khi 1 kết quả tool (MCP tĩnh HOẶC dynamic provider) được
// nhồi vào prompt/rounds gửi lại cho LLM. Đặt cap TỔNG dung lượng ở đây
// để chặn dứt điểm, không phân biệt nguồn tool.
const MAX_TOOL_RESULT_CHARS = 6000;

// ContextCapper tự chèn thêm marker "...[truncated N chars]..." vào chuỗi nó cắt,
// nên head+tail phải nhường ra một khoảng cho marker đó — nếu không, chuỗi đã bị
// capper.cap() cắt vẫn có thể dài hơn maxChars, khiến safety net bên dưới phải
// cắt đè lần 2 lên chính chuỗi vừa cắt (double truncation).
const TRUNCATION_MARKER_OVERHEAD_RESERVE = 40;

const minifier = new PayloadMinifier({
  removeNulls: true,
  removeEmptyArrays: true,
  removeEmptyObjects: true,
});
const cleaner = new MarkupCleaner({ stripHtml: true });
const compressor = new PayloadCompressor();

// accuracy_problem.md — maxChars giờ nhận tham số (mặc định MAX_TOOL_RESULT_CHARS,
// hành vi CŨ không đổi ở mọi nơi gọi khác) — cần budget NHỎ HƠN, RIÊNG cho từng
// round khi cap NHIỀU round cùng lúc (xem synthesize() ở supervisor.service.ts):
// nối hết rồi mới cap 1 lần duy nhất (hành vi cũ) có thể XOÁ SỔ HOÀN TOÀN 1
// round Ở GIỮA (không chỉ cắt bớt dữ liệu của nó) — vì head/tail chỉ giữ đúng
// 2 đầu của TOÀN BỘ chuỗi đã nối, không biết gì về ranh giới giữa các round.
export function capToolResultSize(
  text: string,
  maxChars: number = MAX_TOOL_RESULT_CHARS,
): string {
  // maxChars quá nhỏ (VD chia đều ngân sách cho quá nhiều round) — không đủ
  // chỗ cho cả head/tail LẪN marker "...[truncated N chars]...". ContextCapper
  // tự nó cũng vỡ theo cách tương tự ở ngưỡng này (trả marker rỗng ruột) nên
  // phải chặn TRƯỚC KHI vào pipeline minify/compress/capper, cắt phẳng luôn.
  if (maxChars <= TRUNCATION_MARKER_OVERHEAD_RESERVE) {
    return text.length > maxChars ? text.slice(0, Math.max(0, maxChars)) : text;
  }

  let input: unknown = text;

  // Cố gắng parse JSON để có thể minify cấu trúc Array/Object bên trong
  try {
    input = JSON.parse(text);
  } catch {
    // Không phải JSON, giữ nguyên raw string
  }

  const effectiveMaxChars = maxChars - TRUNCATION_MARKER_OVERHEAD_RESERVE;
  const headLength = Math.floor(effectiveMaxChars * 0.6);
  const tailLength = Math.floor(effectiveMaxChars * 0.4);
  const capper = new ContextCapper({
    maxLength: maxChars,
    headLength,
    tailLength,
  });

  // Chạy tuần tự các module của agentic-io-parser
  let payload = input as JsonValue;
  payload = minifier.minify(payload);
  payload = cleaner.clean(payload);

  let dictionaryStr = '';
  // Nén Key Alias chỉ đáng làm khi payload đã minify/clean xong mà vẫn vượt cap —
  // nén 1 object nhỏ chỉ tổ bắt LLM phải tra ngược dictionary vô ích.
  if (
    typeof payload === 'object' &&
    payload !== null &&
    JSON.stringify(payload).length > maxChars
  ) {
    const { compressed, dictionary } = compressor.compress(payload);
    payload = compressed;
    if (Object.keys(dictionary).length > 0) {
      dictionaryStr = `\n[MAPPING_KEYS: ${JSON.stringify(dictionary)}]`;
    }
  }

  payload = capper.cap(payload);

  let resultStr =
    typeof payload === 'string' ? payload : JSON.stringify(payload);
  resultStr += dictionaryStr;

  // Safety net cuối cùng: Nếu file JSON (dù đã nén) vẫn là mảng quá khổng lồ,
  // Capper có thể bỏ sót vì nó chỉ cắt string node bên trong.
  // Ta phải đảm bảo tổng độ dài cuối cùng không bao giờ vượt ngưỡng maxChars.
  if (resultStr.length > maxChars) {
    const head = resultStr.substring(0, headLength);
    const tail = resultStr.substring(resultStr.length - tailLength);
    return `${head}\n...[truncated ${resultStr.length - maxChars} chars]...\n${tail}`;
  }

  return resultStr;
}

// accuracy_problem.md — ngưỡng MAX_TOOL_RESULT_CHARS (6000) sinh ra từ 1 sự cố
// timeout cũ (accuracy.md mục B), KHÔNG liên quan gì tới context window THẬT
// của model đang xử lý nó — gpt-4o-mini đã có 128K token (~500.000 ký tự)
// nhưng vẫn bị cắt xuống 6000, dù model dư sức chứa nhiều hơn hẳn (VD 500
// dòng SQL ~40.000-50.000 ký tự, thừa sức nằm gọn trong 128K token thật).
//
// resolveDataCharBudget() tính ngân sách THEO ĐÚNG model đang dùng: 1 phần
// (CHARS_PER_TOKEN_ESTIMATE × DATA_BUDGET_FRACTION) của context window thật,
// chừa lại phần còn lại cho system prompt/instruction/lịch sử/completion —
// KHÔNG dồn hết context cho dữ liệu dù model có context window rất lớn (VD
// Gemini 1M token), vì prompt quá to vẫn tốn tiền/độ trễ thật dù "vừa" về
// mặt kỹ thuật — nên vẫn có MAX_DATA_CHARS_CEILING chặn trần tuyệt đối.
// Export để tái dùng ước lượng token chỗ khác (VD chi phí embedding) — cùng
// 1 con số ước lượng cho toàn app, không lặp lại magic number.
export const CHARS_PER_TOKEN_ESTIMATE = 4; // ước lượng thô (tiếng Việt/Anh trộn lẫn), KHÔNG chính xác tuyệt đối theo tokenizer thật của từng provider.
const DATA_BUDGET_FRACTION = 0.3;
const MAX_DATA_CHARS_CEILING = 200_000;

export function resolveDataCharBudget(modelId: string): number {
  const entry = LLM_MODEL_REGISTRY[modelId];
  // Model chưa đăng ký contextWindowTokens (hoặc modelId lạ) → rơi về đúng
  // hành vi CŨ (6000), an toàn, không đoán mù.
  if (!entry?.contextWindowTokens) return MAX_TOOL_RESULT_CHARS;

  const scaled = Math.floor(
    entry.contextWindowTokens * CHARS_PER_TOKEN_ESTIMATE * DATA_BUDGET_FRACTION,
  );
  return Math.min(scaled, MAX_DATA_CHARS_CEILING);
}

// channel_memory trước đây dùng hằng số cố định, không biết model đang xử lý
// có context window lớn hay nhỏ. Cộng thêm 1 lát budget riêng (KHÔNG trừ vào
// tool result — 2 khoản độc lập, hành vi/test tool result giữ nguyên).
const MEMORY_BUDGET_FRACTION = 0.1;

export function resolveMemoryCharBudget(modelId: string): number {
  return Math.floor(resolveDataCharBudget(modelId) * MEMORY_BUDGET_FRACTION);
}

// Lịch sử hội thoại vẫn tự quản lý theo turn-count (redact/recap/tóm tắt,
// xem getRecentHistory()) — số này chỉ dùng làm LƯỚI AN TOÀN cuối cùng, cùng
// công thức resolveDataCharBudget(), độc lập với tool result/memory.
const HISTORY_BUDGET_FRACTION = 0.5;

export function resolveHistoryCharBudget(modelId: string): number {
  return Math.floor(resolveDataCharBudget(modelId) * HISTORY_BUDGET_FRACTION);
}

// accuracy_problem.md — cap TỪNG round.result riêng theo ngân sách CHIA ĐỀU,
// KHÔNG nối hết rồi cap 1 lần (sai lầm cũ ở synthesize()/buildPrompt()/
// delegateRound() — join() trước rồi capToolResultSize() sau CÓ THỂ XOÁ SỔ
// HOÀN TOÀN 1 round Ở GIỮA khi tổng dữ liệu vượt cap, vì head/tail chỉ giữ
// đúng 2 đầu của TOÀN BỘ chuỗi đã nối, không biết gì về ranh giới giữa các
// round — xác nhận bằng test thật, không phải suy đoán). Chỉ cap field
// `result` — agent/task luôn ngắn, giữ nguyên để LLM luôn biết ĐỦ các bước
// đã chạy, kể cả khi dữ liệu của 1 vài bước bị rút gọn.
//
// `totalBudget` mặc định MAX_TOOL_RESULT_CHARS (hành vi CŨ) — caller nên
// truyền `resolveDataCharBudget(model)` để ngân sách khớp ĐÚNG model thật sẽ
// xử lý văn bản này (xem synthesize()/buildPrompt()/delegateRound()).
export function capRoundResults<T extends { result: string }>(
  rounds: readonly T[],
  totalBudget: number = MAX_TOOL_RESULT_CHARS,
): T[] {
  if (rounds.length === 0) return [...rounds];
  const perRoundBudget = Math.floor(totalBudget / rounds.length);
  return rounds.map((r) => ({
    ...r,
    result: capToolResultSize(r.result, perRoundBudget),
  }));
}

// Thay vì chia đều ngân sách cho mọi round như capRoundResults(), round
// reconstructible (chỉ tra cứu/đọc — xem isLikelyReadOnlyRound) nhường chỗ
// cho round irreplaceable (đã tạo/sửa/xoá), vì round reconstructible gọi lại
// được nếu cần, round kia thì không.
const IRREPLACEABLE_WEIGHT = 2;

export function capRoundResultsWeighted<
  T extends { task: string; result: string },
>(rounds: readonly T[], totalBudget: number = MAX_TOOL_RESULT_CHARS): T[] {
  if (rounds.length === 0) return [...rounds];

  const weights = rounds.map((r) =>
    isLikelyReadOnlyRound(r) ? 1 : IRREPLACEABLE_WEIGHT,
  );
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);

  return rounds.map((r, i) => ({
    ...r,
    result: capToolResultSize(
      r.result,
      Math.floor((totalBudget * weights[i]) / totalWeight),
    ),
  }));
}
