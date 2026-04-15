import { mapKeys, mapValues, isObject } from 'lodash';

export function toSnakeCase(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(toSnakeCase);
  }

  if (obj !== null && typeof obj === 'object') {
    return mapKeys(
      mapValues(obj, (value) => toSnakeCase(value)),
      (_, key) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
    );
  }

  return obj;
}
