import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { IBaseResponse, IMicroserviceError } from '@slack/common';
import { Request, Response } from 'express';

@Catch() // Catch all exceptions, not just HttpException
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error: string = 'UnknownError';
    let code: string | undefined = undefined;

    // Log the raw exception for debugging
    this.logger.error(
      `Raw exception caught: ${JSON.stringify(exception)}`,
      exception instanceof Error ? exception.stack : undefined,
      `${request.method} ${request.url}`,
    );

    if (exception instanceof HttpException) {
      // Handle NestJS HTTP exceptions
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        error = exception.constructor.name;
      } else if (
        typeof exceptionResponse === 'object' &&
        exceptionResponse !== null
      ) {
        const responseObj = exceptionResponse as IMicroserviceError;
        message = responseObj.message || exception.message;
        error = responseObj.error || exception.constructor.name;
        code = responseObj.code;
      } else {
        message = exception.message;
        error = exception.constructor.name;
      }
    } else if (exception instanceof Error) {
      // Handle generic JavaScript errors
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = exception.message || 'Internal server error';
      error = exception.constructor.name;
    } else if (typeof exception === 'object' && exception !== null) {
      // Handle microservice error objects
      const errorObj = exception as IMicroserviceError;

      // Extract status code (ensure it's a number)
      if (typeof errorObj.statusCode === 'number') {
        status = errorObj.statusCode;
      } else if (typeof errorObj.status === 'number') {
        status = errorObj.status;
      } else {
        status = HttpStatus.INTERNAL_SERVER_ERROR;
      }

      // Extract message and code
      message = errorObj.message || errorObj.error || 'Internal server error';
      error = errorObj.error || 'MicroserviceError';
      code = errorObj.code;

      // Logging will be handled by the unified logger below
    } else {
      // Handle completely unknown exceptions
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
      error = 'UnknownError';
    }

    // Ensure status is a valid HTTP status code
    if (typeof status !== 'number' || status < 100 || status > 599) {
      this.logger.error(
        `Invalid status code detected: ${status}, using 500 instead`,
      );
      status = HttpStatus.INTERNAL_SERVER_ERROR;
    }

    // Format and send the error response
    const errorResponse: IBaseResponse<null> = {
      status: 'Error',
      statusCode: status,
      ...(code && { code }),
      message: Array.isArray(message) ? message.join(', ') : message,
      data: null,
      metadata: {
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
      },
    };

    // Unified logging for all exceptions
    const displayMessage = Array.isArray(message)
      ? message.join(', ')
      : message;
    const logContent = `[${String(error)}] ${request.method} ${request.url} - Status: ${status} - Message: ${displayMessage}`;

    if (status >= 500) {
      this.logger.error(
        logContent,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(logContent);
    }

    try {
      response.status(status).json(errorResponse);
    } catch (responseError) {
      this.logger.error(
        `Failed to send error response: ${responseError}`,
        undefined,
        `${request.method} ${request.url}`,
      );
      // Fallback response
      response.status(500).json({
        statusCode: 500,
        status: 'error',
        error: 'ResponseError',
        message: 'Failed to process error response',
        data: null,
        timestamp: new Date().toISOString(),
        path: request.url,
        method: request.method,
      });
    }
  }
}
