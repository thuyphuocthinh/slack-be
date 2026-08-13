const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) instructions?/i,
  /disregard (all |any |the )?(previous|prior|above)/i,
  /system\s*:/i,
  /\byou (must|should|are now)\b/i,
  /bỏ qua (mọi |tất cả )?(hướng dẫn|chỉ thị|lệnh)( trước| ở trên)?/i,
  /luôn luôn (phải )?(gọi|thực hiện|làm)/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}
