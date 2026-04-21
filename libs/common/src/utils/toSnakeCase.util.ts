import { mapKeys, mapValues } from 'lodash';

export function toSnakeCase(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(toSnakeCase);
  }

  if (obj !== null && typeof obj === 'object') {
    return mapKeys(
      mapValues(obj, (value) => toSnakeCase(value)),
      (_, key) => {
        if (typeof key !== 'string') return key;
        return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
      },
    );
  }

  return obj;
}
