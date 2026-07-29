// ver3.md mục 1 (dài hạn) — KHÔNG có classifier "create" nào có sẵn trong hệ
// thống (chỉ có destructiveHint/readOnlyHint từ MCP spec, phân biệt "có ghi
// hay không" chứ không phân biệt create/update/delete). Đây là heuristic
// TÊN/regex, tunable, chấp nhận false positive/negative — đúng khung "gợi ý,
// không phải cam kết tuyệt đối" của channel_memory: bỏ sót 1 lượt ghi nhớ chỉ
// mất tiện lợi, không sai dữ liệu; nhận nhầm 1 tool không phải create cũng chỉ
// thêm 1 dòng gợi ý vô hại.
const CREATE_TOOL_NAME_PATTERN = /\b(create|insert|append|add)/i;
const SQL_INSERT_PATTERN = /^\s*insert\s+into\b/i;

export function isLikelyCreateToolCall(toolCall: {
  tool: string;
  argsPreview?: string;
}): boolean {
  if (CREATE_TOOL_NAME_PATTERN.test(toolCall.tool)) return true;
  return (
    !!toolCall.argsPreview && SQL_INSERT_PATTERN.test(toolCall.argsPreview)
  );
}
