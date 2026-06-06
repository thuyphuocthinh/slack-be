import { Injectable } from '@nestjs/common';

@Injectable()
export class CanvasService {
  getHello(): string {
    return 'Hello World!';
  }
}
