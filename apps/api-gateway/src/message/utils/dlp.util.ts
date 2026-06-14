const DLP_RULES: Record<string, RegExp> = {
  CREDIT_CARD: /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|6(?:011|5[0-9][0-9])[0-9]{12}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|(?:2131|1800|35\d{3})\d{11})\b/g,
  AWS_API_KEY: /\b(AKIA|ASCA|AOAG|ACCA)[A-Z0-9]{16}\b/g,
  SLACK_TOKEN: /\bxox[baprt]-[a-zA-Z0-9-]{10,}\b/g,
  GOOGLE_API_KEY: /\bAIza[yY][a-zA-Z0-9-_]{35}\b/g,
  GITHUB_TOKEN: /\b(ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,255}\b/g,
  PRIVATE_KEY: /-----BEGIN [A-Z\s]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z\s]+ PRIVATE KEY-----/g,
};

/**
 * Scan and redact sensitive information from a plain text string.
 */
export function redactText(text: string): string {
  if (!text) return text;
  let temp = text;
  for (const [ruleName, regex] of Object.entries(DLP_RULES)) {
    // Reset regex index for safety
    regex.lastIndex = 0;
    temp = temp.replace(regex, `[REDACTED_${ruleName}]`);
  }
  return temp;
}

/**
 * Recursively scans and redacts string properties inside any payload (handles string, array, or objects).
 */
export function redactContent<T>(content: T): T {
  if (content === null || content === undefined) {
    return content;
  }

  if (typeof content === 'string') {
    return redactText(content) as unknown as T;
  }

  if (Array.isArray(content)) {
    return content.map((item) => redactContent(item)) as unknown as T;
  }

  if (typeof content === 'object') {
    // Chỉ đệ quy nếu là plain object (đối tượng thuần túy)
    if (Object.prototype.toString.call(content) === '[object Object]') {
      const newObj: Record<string, any> = {};
      for (const [key, value] of Object.entries(content)) {
        newObj[key] = redactContent(value);
      }
      return newObj as T;
    }
    return content;
  }

  return content;
}
