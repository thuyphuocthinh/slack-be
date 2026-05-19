import { Injectable } from '@nestjs/common';

@Injectable()
export class VideoCallService {
  getHello(): string {
    return 'Hello World!';
  }
}
