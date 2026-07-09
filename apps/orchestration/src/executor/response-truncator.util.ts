import { StrictJsonObject, StrictJsonValue } from "@slack/common";

/**
 * Utility to safely truncate large objects, arrays, and strings
 * to prevent overflowing the LLM context window.
 */
export class ResponseTruncatorUtil {
  // Maximum length for a single string
  private static readonly MAX_STRING_LENGTH = 1000;
  // Maximum items to keep in an array
  private static readonly MAX_ARRAY_ITEMS = 50;

  /**
   * Truncates large arrays and excessively long strings within an object/array.
   * Modifies by creating a deep copy.
   * 
   * @param data The data to truncate
   * @param maxStringLength Optional override for max string length
   * @param maxArrayItems Optional override for max array items
   * @returns Truncated data
   */
  static truncate(
    data: StrictJsonValue,
    maxStringLength = this.MAX_STRING_LENGTH,
    maxArrayItems = this.MAX_ARRAY_ITEMS
  ): StrictJsonValue {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      if (data.length > maxStringLength) {
        return data.substring(0, maxStringLength) + `... [TRUNCATED_DUE_TO_SIZE: original length was ${data.length}]`;
      }
      return data;
    }

    if (Array.isArray(data)) {
      if (data.length > maxArrayItems) {
        const sliced = data.slice(0, maxArrayItems).map((item) => this.truncate(item, maxStringLength, maxArrayItems));
        sliced.push(`... [WARNING: Array truncated from ${data.length} to ${maxArrayItems} items to fit AI context window. Use limit/offset API parameters to view more.]`);
        return sliced;
      }
      return data.map((item) => this.truncate(item, maxStringLength, maxArrayItems));
    }

    if (typeof data === 'object') {
      const truncatedObj: StrictJsonObject = {};
      for (const [key, value] of Object.entries(data)) {
        truncatedObj[key] = this.truncate(value, maxStringLength, maxArrayItems);
      }
      return truncatedObj;
    }

    return data;
  }
}
