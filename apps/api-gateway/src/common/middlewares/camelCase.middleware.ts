import { Injectable, NestMiddleware } from '@nestjs/common';
import camelcaseKeys from 'camelcase-keys';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class CamelCaseMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    if (req.body) {
      req.body = camelcaseKeys(req.body, { deep: true });
    }
    next();
  }
}
