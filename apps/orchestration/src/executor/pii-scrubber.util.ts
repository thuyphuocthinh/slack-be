import { regex } from "@slack/constants";
import { StrictJsonObject, StrictJsonValue } from "@slack/common";

/**
 * Utility class to scrub Personally Identifiable Information (PII) and sensitive data
 * from objects and strings before they are sent to external LLMs.
 */
export class PiiScrubberUtil {

  // Key names that likely contain sensitive data
  private static readonly SENSITIVE_KEYS = new Set([
    'password',
    'secret',
    'token',
    'apikey',
    'api_key',
    'access_token',
    'refresh_token',
    'cvv',
    'credit_card',
    'ssn',
    'authorization',
    'auth',
    'cookie',
    'session',
    'private_key',
  ]);

  /**
   * Deeply scrubs an object or string for PII and sensitive keys.
   * @param data The data to scrub (can be object, array, string, number, etc.)
   * @returns A sanitized deep copy of the data
   */
  static scrub(data: StrictJsonValue): StrictJsonValue {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      return this.scrubString(data);
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.scrub(item));
    }

    if (typeof data === 'object') {
      const scrubbedObj: StrictJsonObject = {};
      for (const [key, value] of Object.entries(data)) {
        if (this.isSensitiveKey(key)) {
          scrubbedObj[key] = '[REDACTED_BY_SECURITY_GATE]';
        } else {
          scrubbedObj[key] = this.scrub(value);
        }
      }
      return scrubbedObj;
    }

    // Numbers, booleans, etc.
    return data;
  }

  private static isSensitiveKey(key: string): boolean {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const sensitiveKey of this.SENSITIVE_KEYS) {
      if (normalizedKey.includes(sensitiveKey.replace(/[^a-z0-9]/g, ''))) {
        return true;
      }
    }
    return false;
  }

  private static scrubString(text: string): string {
    let scrubbed = text;

    // Mask Credit Cards
    scrubbed = scrubbed.replace(regex.PII_CREDIT_CARD, (match) => {
      return '****-****-****-' + match.replace(/[^0-9]/g, '').slice(-4);
    });

    // Mask Emails (e.g. john.doe@example.com -> j***e@example.com)
    scrubbed = scrubbed.replace(regex.PII_EMAIL, (match) => {
      const [local, domain] = match.split('@');
      if (local.length > 2) {
        return `${local[0]}***${local[local.length - 1]}@${domain}`;
      }
      return `***@${domain}`;
    });

    // Mask SSNs
    scrubbed = scrubbed.replace(regex.PII_SSN, '***-**-****');

    // Mask Phone Numbers (basic format)
    scrubbed = scrubbed.replace(regex.PII_PHONE, '[PHONE_REDACTED]');

    // Mask JWT Tokens
    scrubbed = scrubbed.replace(regex.PII_JWT, '[JWT_TOKEN_REDACTED]');

    // Mask Private Keys
    scrubbed = scrubbed.replace(regex.PII_PRIVATE_KEY, '[PRIVATE_KEY_REDACTED]');

    return scrubbed;
  }
}
