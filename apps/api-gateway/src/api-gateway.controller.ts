import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiGatewayService } from './api-gateway.service';
import { Public } from '@slack/common';

@ApiTags('API Gateway')
@Controller()
export class ApiGatewayController {
  constructor(private readonly apiGatewayService: ApiGatewayService) {}

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Check health',
    description:
      'Returns a simple message to verify that the API Gateway is running',
  })
  @ApiResponse({
    status: 200,
    description: 'Successful response with a message',
  })
  checkHealth(): { message: string } {
    return this.apiGatewayService.checkHealth();
  }

  @Get('protected')
  @ApiOperation({
    summary: 'Check protected route',
    description:
      'Returns a simple message to verify that the API Gateway is running',
  })
  @ApiResponse({
    status: 200,
    description: 'Successful response with a message',
  })
  checkProtected(): { message: string } {
    return this.apiGatewayService.checkProtected();
  }
}
