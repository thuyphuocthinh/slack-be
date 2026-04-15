import { Injectable } from '@nestjs/common';

@Injectable()
export class ApiGatewayService {
  getHello(): { fullName: string } {
    return { fullName: 'Hello World' };
  }
}
