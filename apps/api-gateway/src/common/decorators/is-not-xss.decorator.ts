import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';

function isDangerous(value: any): boolean {
  if (typeof value === 'string') {
    // 1. Kiểm tra thẻ <script>
    if (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(value)) {
      return true;
    }
    // 2. Kiểm tra thuộc tính sự kiện (onerror, onload, onclick...)
    if (/\bon[a-z]+\s*=\s*/gi.test(value)) {
      return true;
    }
    // 3. Kiểm tra giao thức javascript:
    if (/href\s*=\s*(['"])javascript:/gi.test(value) || /src\s*=\s*(['"])javascript:/gi.test(value)) {
      return true;
    }
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => isDangerous(item));
  }

  if (value !== null && typeof value === 'object') {
    return Object.values(value).some((val) => isDangerous(val));
  }

  return false;
}

export function IsNotHtmlXss(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isNotHtmlXss',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, _args: ValidationArguments) {
          if (value === undefined || value === null) {
            return true;
          }
          return !isDangerous(value);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} contains dangerous HTML/XSS payloads`;
        },
      },
    });
  };
}
