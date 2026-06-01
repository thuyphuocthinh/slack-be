import { Injectable } from '@nestjs/common';

@Injectable()
export class IntegrationsService {
  getHello(): string {
    return 'Hello World!';
  }
}
