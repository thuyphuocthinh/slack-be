// Chặn cuối cùng trước khi 1 kết quả tool (MCP tĩnh HOẶC dynamic provider) được
// nhồi vào prompt/rounds gửi lại cho LLM. `TruncateResponseProcessor` (dynamic
// provider, xem dynamic-tool-executor.service.ts) chỉ cắt TỪNG string/array
// riêng lẻ (1000 ký tự/50 phần tử) — 1 JSON lồng nhau nhiều field/mảng con vẫn
// có thể cộng dồn ra hàng chục KB sau khi "cắt". Tool tĩnh (sql_server,
// github...) qua mcp-client.service.ts thì KHÔNG được cắt bước nào cả. Đặt cap
// TỔNG dung lượng ở đây — đúng 2 nơi text tool result được feed ngược vào LLM
// (react-loop.service.ts::handleToolCall(), approval-flow.service.ts sau khi
// thực thi tool đã duyệt) — để chặn dứt điểm, không phân biệt nguồn tool.
const MAX_TOOL_RESULT_CHARS = 6000;

export function capToolResultSize(
  text: string,
  maxChars = MAX_TOOL_RESULT_CHARS,
): string {
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars) +
    `\n... [ĐÃ CẮT BỚT: kết quả gốc dài ${text.length} ký tự, chỉ giữ ${maxChars} ký tự đầu để tránh vượt quá giới hạn ngữ cảnh của LLM]`
  );
}
