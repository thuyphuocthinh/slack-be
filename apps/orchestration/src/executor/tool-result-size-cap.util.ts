import { ContextCapper, PayloadMinifier, MarkupCleaner, PayloadCompressor, PiiScrubber, JsonValue } from 'agentic-io-parser';

// Chặn cuối cùng trước khi 1 kết quả tool (MCP tĩnh HOẶC dynamic provider) được
// nhồi vào prompt/rounds gửi lại cho LLM. Đặt cap TỔNG dung lượng ở đây
// để chặn dứt điểm, không phân biệt nguồn tool.
const MAX_TOOL_RESULT_CHARS = 6000;

// ContextCapper tự chèn thêm marker "...[truncated N chars]..." vào chuỗi nó cắt,
// nên head+tail phải nhường ra một khoảng cho marker đó — nếu không, chuỗi đã bị
// capper.cap() cắt vẫn có thể dài hơn MAX_TOOL_RESULT_CHARS, khiến safety net bên
// dưới phải cắt đè lần 2 lên chính chuỗi vừa cắt (double truncation).
const TRUNCATION_MARKER_OVERHEAD_RESERVE = 40;
const EFFECTIVE_MAX_CHARS = MAX_TOOL_RESULT_CHARS - TRUNCATION_MARKER_OVERHEAD_RESERVE;
const HEAD_LENGTH = Math.floor(EFFECTIVE_MAX_CHARS * 0.6);
const TAIL_LENGTH = Math.floor(EFFECTIVE_MAX_CHARS * 0.4);

const capper = new ContextCapper({ maxLength: MAX_TOOL_RESULT_CHARS, headLength: HEAD_LENGTH, tailLength: TAIL_LENGTH });
const minifier = new PayloadMinifier({ removeNulls: true, removeEmptyArrays: true, removeEmptyObjects: true });
const cleaner = new MarkupCleaner({ stripHtml: true });
const compressor = new PayloadCompressor();
// Tool result có thể chứa dữ liệu thật (email, SĐT, JWT...) lấy từ CRM/DB qua dynamic
// provider — phải scrub trước khi nó rời khỏi hệ thống để đi vào prompt gửi cho
// OpenAI/Gemini (bên thứ 3).
const piiScrubber = new PiiScrubber();

export function capToolResultSize(text: string): string {
  let input: unknown = text;

  // Cố gắng parse JSON để có thể minify cấu trúc Array/Object bên trong
  try {
    input = JSON.parse(text);
  } catch {
    // Không phải JSON, giữ nguyên raw string
  }

  // Chạy tuần tự các module của agentic-io-parser
  let payload = input as JsonValue;
  payload = minifier.minify(payload);
  payload = cleaner.clean(payload);
  payload = piiScrubber.scrub(payload);

  let dictionaryStr = '';
  // Nén Key Alias chỉ đáng làm khi payload đã minify/clean xong mà vẫn vượt cap —
  // nén 1 object nhỏ chỉ tổ bắt LLM phải tra ngược dictionary vô ích.
  if (typeof payload === 'object' && payload !== null && JSON.stringify(payload).length > MAX_TOOL_RESULT_CHARS) {
    const { compressed, dictionary } = compressor.compress(payload);
    payload = compressed;
    if (Object.keys(dictionary).length > 0) {
      dictionaryStr = `\n[MAPPING_KEYS: ${JSON.stringify(dictionary)}]`;
    }
  }

  payload = capper.cap(payload);

  let resultStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  resultStr += dictionaryStr;

  // Safety net cuối cùng: Nếu file JSON (dù đã nén) vẫn là mảng quá khổng lồ,
  // Capper có thể bỏ sót vì nó chỉ cắt string node bên trong.
  // Ta phải đảm bảo tổng độ dài cuối cùng không bao giờ vượt ngưỡng MAX.
  if (resultStr.length > MAX_TOOL_RESULT_CHARS) {
    const head = resultStr.substring(0, HEAD_LENGTH);
    const tail = resultStr.substring(resultStr.length - TAIL_LENGTH);
    return `${head}\n...[truncated ${resultStr.length - MAX_TOOL_RESULT_CHARS} chars]...\n${tail}`;
  }

  return resultStr;
}
