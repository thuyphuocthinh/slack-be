// ver3.md mục 1 (dài hạn) — KHÔNG có classifier "create" nào có sẵn trong hệ
// thống (chỉ có destructiveHint/readOnlyHint từ MCP spec, phân biệt "có ghi
// hay không" chứ không phân biệt create/update/delete). Đây là heuristic
// TÊN/regex, tunable, chấp nhận false positive/negative — đúng khung "gợi ý,
// không phải cam kết tuyệt đối" của channel_memory: bỏ sót 1 lượt ghi nhớ chỉ
// mất tiện lợi, không sai dữ liệu; nhận nhầm 1 tool không phải create cũng chỉ
// thêm 1 dòng gợi ý vô hại.
const CREATE_VERBS = new Set(['create', 'insert', 'append', 'add']);

// So khớp NGUYÊN 1 từ trong tên tool, không phải substring — "get_contact_addresses"/
// "list_additional_fields" chứa "add" nhưng không phải verb đứng riêng, không được tính.
function splitToolNameWords(name: string): string[] {
  return name
    .replace(/[._]/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function hasCreateVerb(toolName: string): boolean {
  return splitToolNameWords(toolName).some((word) => CREATE_VERBS.has(word));
}

// Không neo ^ — argsPreview có thể là JSON (formatArgsPreview() với tool 2+
// tham số), câu SQL khi đó nằm giữa chuỗi, không phải ở đầu.
const SQL_INSERT_PATTERN = /insert\s+into\b/i;

export function isLikelyCreateToolCall(toolCall: {
  tool: string;
  argsPreview?: string;
}): boolean {
  if (hasCreateVerb(toolCall.tool)) return true;
  return (
    !!toolCall.argsPreview && SQL_INSERT_PATTERN.test(toolCall.argsPreview)
  );
}
