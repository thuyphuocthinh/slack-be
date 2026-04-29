import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { IBaseResponse, IOffsetResponse } from '@slack/common';
import { Request, Response } from 'express';
import { map, Observable } from 'rxjs';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  IBaseResponse<T> | IOffsetResponse<T>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<IBaseResponse<T> | IOffsetResponse<T>> {
    const ctx = context.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const statusCode = response.statusCode;

    return next.handle().pipe(
      map((data: any) => {
        const commonResponse = {
          statusCode: statusCode,
          status: 'Success' as const,
          message: 'Request Success',
          metadata: {
            timestamp: new Date().toISOString(),
            method: request.method,
            path: request.url,
          },
        };

        if (data && data.data && data.paging) {
          return {
            ...commonResponse,
            data: data.data,
            paging: data.paging,
          };
        }

        return {
          ...commonResponse,
          data: data,
        };
      }),
    );
  }
}
