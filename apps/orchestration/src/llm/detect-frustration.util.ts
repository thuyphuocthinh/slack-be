/**
 * ver3.md mục 5 — phát hiện tín hiệu user bực bội bằng regex ($0, không LLM
 * call). Chạy trên CHÍNH tin nhắn đang được plan() xử lý (không cần lưu/hook
 * ở service khác) để lượt xử lý NGAY LÚC NÀY chú ý hơn, không phải chỉ ghi
 * log bị động.
 */
const FRUSTRATION_PATTERNS: RegExp[] = [
  /sai rồi/i,
  /vẫn (vậy|thế)( hoài| hoài luôn)?/i,
  /lỗi (nữa|tiếp|hoài)/i,
  /không đúng/i,
  /làm lại( đi)?/i,
  /sao (vẫn|lại|cứ) (sai|lỗi)/i,
];

/** Trả về pattern khớp đầu tiên (dạng string, để log/test), hoặc null nếu không khớp. */
export function detectFrustration(text: string): string | null {
  const match = FRUSTRATION_PATTERNS.find((pattern) => pattern.test(text));
  return match ? match.source : null;
}
