import { Injectable } from '@nestjs/common';

@Injectable()
export class ApiGatewayService {
  checkHealth(): { message: string } {
    return { message: 'API Gateway is running' };
  }

  checkProtected(): { message: string } {
    return { message: 'API Gateway is running' };
  }
}
