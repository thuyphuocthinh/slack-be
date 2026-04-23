import { Injectable } from '@nestjs/common';

@Injectable()
export class ChannelService {
  getHello(): string {
    return 'Hello World!';
  }
}
