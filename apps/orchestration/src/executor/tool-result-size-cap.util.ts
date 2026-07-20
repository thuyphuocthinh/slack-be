import {
  ContextCapper,
  PayloadMinifier,
  MarkupCleaner,
  PayloadCompressor,
  JsonValue,
} from 'agentic-io-parser';

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

// accuracy_problem.md — cap TỪNG round.result riêng theo ngân sách CHIA ĐỀU,
// KHÔNG nối hết rồi cap 1 lần (sai lầm cũ ở synthesize()/buildPrompt()/
// delegateRound() — join() trước rồi capToolResultSize() sau CÓ THỂ XOÁ SỔ
// HOÀN TOÀN 1 round Ở GIỮA khi tổng dữ liệu vượt cap, vì head/tail chỉ giữ
// đúng 2 đầu của TOÀN BỘ chuỗi đã nối, không biết gì về ranh giới giữa các
// round — xác nhận bằng test thật, không phải suy đoán). Chỉ cap field
// `result` — agent/task luôn ngắn, giữ nguyên để LLM luôn biết ĐỦ các bước
// đã chạy, kể cả khi dữ liệu của 1 vài bước bị rút gọn.
export function capRoundResults<T extends { result: string }>(
  rounds: readonly T[],
): T[] {
  if (rounds.length === 0) return [...rounds];
  const perRoundBudget = Math.floor(MAX_TOOL_RESULT_CHARS / rounds.length);
  return rounds.map((r) => ({
    ...r,
    result: capToolResultSize(r.result, perRoundBudget),
  }));
}
