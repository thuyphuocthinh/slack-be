import {
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { BaseRpcExceptionFilter, RpcException } from '@nestjs/microservices';
import {
  getExceptionName,
  getExceptionMessage,
  isObject,
  getErrorName,
  isDatabaseError,
  handleDatabaseError,
  isValidationError,
  handleValidationError,
} from '../utils/rpc-exception.util';

/**
 * Global RPC Exception Filter for All Microservices
 * Converts HttpException, Database exceptions, and Validation exceptions
 * to RpcException for proper microservice communication.
 */
@Catch()
export class AllRpcExceptionFilter extends BaseRpcExceptionFilter {
  private readonly logger = new Logger(AllRpcExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const exceptionName = getExceptionName(exception);
    const exceptionMessage = getExceptionMessage(exception);

    this.logger.debug(`Handling exception: ${exceptionName}`, exceptionMessage);

    // If it's already an RpcException, pass it through
    if (exception instanceof RpcException) {
      this.logger.debug('Already RpcException, passing through');
      return super.catch(exception, host);
    }

    // Convert HttpException to RpcException
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      let message = exception.message;
      if (typeof response === 'string') {
        message = response;
      } else if (isObject(response)) {
        if (Array.isArray(response.message)) {
          message = response.message.join(', ');
        } else if (typeof response.message === 'string') {
          message = response.message;
        }
      }

      const rpcException = new RpcException({
        statusCode: status,
        message: message,
        error: getErrorName(status),
        timestamp: new Date().toISOString(),
      });

      this.logger.debug(
        `Converted HttpException to RpcException: ${status} - ${exception.message}`,
      );
      return super.catch(rpcException, host);
    }

    // Handle TypeORM/Database errors
    if (isDatabaseError(exception)) {
      const rpcException = handleDatabaseError(exception);
      this.logger.debug(
        `Converted Database error to RpcException: ${JSON.stringify(rpcException.getError())}`,
      );
      return super.catch(rpcException, host);
    }

    // Handle validation errors
    if (isValidationError(exception)) {
      const rpcException = handleValidationError(exception);
      this.logger.debug(
        `Converted Validation error to RpcException: ${JSON.stringify(rpcException.getError())}`,
      );
      return super.catch(rpcException, host);
    }

    // Default: convert to RpcException with 500 status
    const rpcException = new RpcException({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: exceptionMessage || 'Internal server error',
      error: 'Internal Server Error',
      timestamp: new Date().toISOString(),
    });

    this.logger.error(
      `Unhandled exception converted to RpcException:`,
      exception,
    );
    return super.catch(rpcException, host);
  }
}
