// Giai đoạn 2 (Agent OS) — "Clear": phân loại round nào reconstructible (chỉ
// tra cứu/đọc, gọi lại được, an toàn cắt trước) vs irreplaceable (đã tạo/sửa/
// xoá — kết quả không lặp lại được y hệt). Heuristic TÊN/regex trên `task`,
// cùng tinh thần isLikelyCreateToolCall() — chấp nhận false positive/negative,
// vì chỉ ảnh hưởng THỨ TỰ cắt bớt khi thiếu ngân sách, không ảnh hưởng đúng/sai
// dữ liệu.
const READ_ONLY_VERBS = new Set([
  'xem',
  'tra',
  'kiểm',
  'lấy',
  'tìm',
  'liệt',
  'kê',
  'get',
  'list',
  'show',
  'query',
  'search',
  'fetch',
  'describe',
  'select',
]);

function splitWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function isLikelyReadOnlyRound(round: { task: string }): boolean {
  return splitWords(round.task).some((word) => READ_ONLY_VERBS.has(word));
}
