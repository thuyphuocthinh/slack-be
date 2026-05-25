import { HttpStatus } from '@nestjs/common';
import { RpcException } from '@nestjs/microservices';

export const isObject = (val: unknown): val is Record<string, unknown> => {
  return val !== null && typeof val === 'object';
};

export const getExceptionMessage = (exception: unknown): string => {
  if (exception instanceof Error) {
    return exception.message;
  }
  if (isObject(exception) && typeof exception.message === 'string') {
    return exception.message;
  }
  return String(exception);
};

export const getExceptionName = (exception: unknown): string => {
  if (isObject(exception) && typeof exception.constructor === 'function') {
    return exception.constructor.name;
  }
  return 'UnknownException';
};

export const getExceptionCode = (exception: unknown): string | undefined => {
  if (isObject(exception) && typeof exception.code === 'string') {
    return exception.code;
  }
  return undefined;
};

export const isDatabaseError = (exception: unknown): boolean => {
  const name = getExceptionName(exception);
  const code = getExceptionCode(exception);
  const message = getExceptionMessage(exception);

  return (
    name === 'QueryFailedError' ||
    code === '23505' ||
    code === '23502' ||
    code === '23503' ||
    message.includes('duplicate key value violates') ||
    message.includes('unique constraint') ||
    message.includes('foreign key constraint')
  );
};

export const isValidationError = (exception: unknown): boolean => {
  const name = getExceptionName(exception);
  const message = getExceptionMessage(exception);
  let hasArrayMessage = false;

  if (isObject(exception) && Array.isArray(exception.message)) {
    hasArrayMessage = true;
  }

  return (
    name === 'ValidationError' ||
    hasArrayMessage ||
    message.includes('should not be empty') ||
    message.includes('must be') ||
    message.includes('is not valid')
  );
};

export const handleDatabaseError = (exception: unknown): RpcException => {
  const message = getExceptionMessage(exception);
  const code = getExceptionCode(exception);

  if (message.includes('duplicate key value violates') || code === '23505') {
    let userMessage = 'Duplicate entry found';

    if (message.includes('order_number')) {
      userMessage = 'Order with this number already exists';
    } else if (message.includes('user_id')) {
      userMessage = 'Order for this user already exists';
    }

    return new RpcException({
      statusCode: HttpStatus.CONFLICT,
      message: userMessage,
      error: 'Conflict',
      timestamp: new Date().toISOString(),
    });
  }

  if (message.includes('null value in column') || code === '23502') {
    return new RpcException({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Required field is missing',
      error: 'Bad Request',
      timestamp: new Date().toISOString(),
    });
  }

  if (message.includes('foreign key constraint') || code === '23503') {
    return new RpcException({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Referenced record does not exist',
      error: 'Bad Request',
      timestamp: new Date().toISOString(),
    });
  }

  return new RpcException({
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Database operation failed',
    error: 'Internal Server Error',
    timestamp: new Date().toISOString(),
  });
};

export const handleValidationError = (exception: unknown): RpcException => {
  let message = 'Validation failed';

  if (isObject(exception)) {
    if (Array.isArray(exception.message)) {
      message = exception.message.join(', ');
    } else if (typeof exception.message === 'string') {
      message = exception.message;
    }
  }

  return new RpcException({
    statusCode: HttpStatus.BAD_REQUEST,
    message: message,
    error: 'Bad Request',
    timestamp: new Date().toISOString(),
  });
};

export const getErrorName = (status: number): string => {
  switch (status as HttpStatus) {
    case HttpStatus.BAD_REQUEST:
      return 'Bad Request';
    case HttpStatus.UNAUTHORIZED:
      return 'Unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'Forbidden';
    case HttpStatus.NOT_FOUND:
      return 'Not Found';
    case HttpStatus.CONFLICT:
      return 'Conflict';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'Unprocessable Entity';
    case HttpStatus.INTERNAL_SERVER_ERROR:
      return 'Internal Server Error';
    default:
      return 'Error';
  }
};
