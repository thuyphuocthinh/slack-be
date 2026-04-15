import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { IBaseResponse, toSnakeCase } from '@slack/common';
import { Request, Response } from 'express';
import { map, Observable } from 'rxjs';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  IBaseResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<IBaseResponse<T>> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const statusCode = response.statusCode;

    return next.handle().pipe(
      map((data: T) => ({
        statusCode: statusCode,
        status: 'Success',
        message: 'Request Success',
        data: toSnakeCase(data),
        metadata: {
          timestamp: new Date().toISOString(),
          method: request.method,
          path: request.url,
        },
      })),
    );
  }
}
