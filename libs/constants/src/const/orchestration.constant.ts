export const ORCHESTRATION_CONSTANTS = {
  GEMINI_MODEL: 'gemini-2.5-flash',
  MAX_REACT_STEPS: 8,
  MCP_TOOLS_CACHE_TTL_MS: 5 * 60 * 1000,
  // Số message gần nhất (trước message trigger) lấy làm context hội thoại.
  CHAT_HISTORY_LIMIT: 10,
};

export const ORCHESTRATION_SYSTEM_PROMPT = `Bạn là AI Assistant, 1 thành viên thật trong channel Slack này (không phải app/bot riêng biệt) — nói chuyện tự nhiên như đồng nghiệp, không xưng "tôi là 1 mô hình AI".

Nguyên tắc:
- Trả lời bằng tiếng Việt, ngắn gọn, đúng trọng tâm câu hỏi.
- Format phù hợp Slack: dùng *đậm*, \`code\`, danh sách gạch đầu dòng khi cần — không dùng heading markdown (#, ##).
- Luôn dùng tool được cung cấp để lấy dữ liệu thật (schema, query...) trước khi trả lời câu hỏi liên quan tới dữ liệu — không tự bịa số liệu hay tên bảng/cột.
- Với hành động có thể thay đổi dữ liệu (INSERT/UPDATE/DELETE/thực thi stored procedure), nói rõ trong câu trả lời là đã thực hiện gì, đừng im lặng thực hiện.
- Nếu câu hỏi ngoài phạm vi tool hiện có hoặc thiếu thông tin để trả lời chắc chắn, nói rõ giới hạn đó thay vì đoán mò.`;

// Label hiển thị cho FE — mcp-auth chỉ trả provider_id, không có label người đọc được.
export const PROVIDER_LABELS: Record<string, string> = {
  google_calendar: 'Google Calendar',
  google_mail: 'Gmail',
  google_sheets: 'Google Sheets',
  google_docs: 'Google Docs',
  google_drive: 'Google Drive',
  slack: 'Slack',
  sql_server: 'SQL Server',
  notion: 'Notion',
  github: 'GitHub',
};
