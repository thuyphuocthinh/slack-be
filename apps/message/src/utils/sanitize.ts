/**
 * Bộ lọc làm sạch dữ liệu đầu vào chống tấn công XSS (Cross-Site Scripting).
 * Loại bỏ các thẻ <script>, các thuộc tính sự kiện (onerror, onload, onclick...)
 * và các giao thức javascript: trong href/src.
 */
export function sanitizeXss(value: any): any {
  if (typeof value === 'string') {
    // 1. Loại bỏ toàn bộ thẻ <script>...</script>
    let sanitized = value.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // 2. Loại bỏ các thuộc tính bắt đầu bằng "on" (ví dụ: onerror, onload, onclick)
    sanitized = sanitized.replace(/\bon[a-z]+\s*=\s*(['"])(.*?)\1/gi, '');
    sanitized = sanitized.replace(/\bon[a-z]+\s*=\s*([^\s>]+)/gi, '');

    // 3. Loại bỏ giao thức "javascript:" nguy hại trong các thẻ href hoặc src
    sanitized = sanitized.replace(/href\s*=\s*(['"])javascript:(.*?)\1/gi, 'href="#"');
    sanitized = sanitized.replace(/src\s*=\s*(['"])javascript:(.*?)\1/gi, 'src="#"');

    return sanitized;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeXss(item));
  }

  if (value !== null && typeof value === 'object') {
    const sanitizedObj: Record<string, any> = {};
    for (const key of Object.keys(value)) {
      sanitizedObj[key] = sanitizeXss(value[key]);
    }
    return sanitizedObj;
  }

  return value;
}
