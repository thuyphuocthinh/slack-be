const keyCache = new Map<string, string>();

function stringToSnakeCase(str: string): string {
  const cached = keyCache.get(str);
  if (cached) return cached;

  const result = str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  keyCache.set(str, result);
  return result;
}

export function toSnakeCase(obj: any): any {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    const len = obj.length;
    const result = new Array(len);
    for (let i = 0; i < len; i++) {
      result[i] = toSnakeCase(obj[i]);
    }
    return result;
  }

  const result: any = {};
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = obj[key];
    const snakeKey = stringToSnakeCase(key);

    if (value !== null && typeof value === 'object') {
      result[snakeKey] = toSnakeCase(value);
    } else {
      result[snakeKey] = value;
    }
  }

  return result;
}

