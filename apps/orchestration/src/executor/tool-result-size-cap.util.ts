import { ContextCapper, PayloadMinifier, MarkupCleaner, PayloadCompressor, JsonValue } from 'agentic-io-parser';

// Chặn cuối cùng trước khi 1 kết quả tool (MCP tĩnh HOẶC dynamic provider) được
// nhồi vào prompt/rounds gửi lại cho LLM. Đặt cap TỔNG dung lượng ở đây 
// để chặn dứt điểm, không phân biệt nguồn tool.
const MAX_TOOL_RESULT_CHARS = 6000;

const capper = new ContextCapper({ maxLength: MAX_TOOL_RESULT_CHARS });
const minifier = new PayloadMinifier({ removeNulls: true, removeEmptyArrays: true, removeEmptyObjects: true });
const cleaner = new MarkupCleaner({ stripHtml: true });
const compressor = new PayloadCompressor();

export function capToolResultSize(text: string): string {
  let input: unknown = text;
  
  // Cố gắng parse JSON để có thể minify cấu trúc Array/Object bên trong
  try {
    input = JSON.parse(text);
  } catch {
    // Không phải JSON, giữ nguyên raw string
  }

  // Chạy tuần tự các module của agentic-io-parser
  let payload = input as unknown as JsonValue;
  payload = minifier.minify(payload);
  payload = cleaner.clean(payload);

  let dictionaryStr = '';
  // Nếu là Object/Array, thực hiện nén Key Alias để tiết kiệm token
  if (typeof payload === 'object' && payload !== null) {
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
    const headLength = Math.floor(MAX_TOOL_RESULT_CHARS * 0.6);
    const tailLength = Math.floor(MAX_TOOL_RESULT_CHARS * 0.4);
    const head = resultStr.substring(0, headLength);
    const tail = resultStr.substring(resultStr.length - tailLength);
    return `${head}\n...[truncated ${resultStr.length - MAX_TOOL_RESULT_CHARS} chars]...\n${tail}`;
  }

  return resultStr;
}
