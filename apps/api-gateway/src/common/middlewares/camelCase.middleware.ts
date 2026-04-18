import { Injectable, NestMiddleware } from '@nestjs/common';
import camelcaseKeys from 'camelcase-keys';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class CamelCaseMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    req.body = camelcaseKeys(req.body, { deep: true });
    next();
  }
}
