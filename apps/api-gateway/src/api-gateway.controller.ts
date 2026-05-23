import { Controller, Get, Header } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiGatewayService } from './api-gateway.service';
import { Public } from '@slack/common';
import { collectDefaultMetrics, register } from 'prom-client';

collectDefaultMetrics();

@ApiTags('API Gateway')
@Controller()
export class ApiGatewayController {
  constructor(private readonly apiGatewayService: ApiGatewayService) {}

  @Public()
  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({
    summary: 'Get Prometheus metrics',
    description: 'Returns metrics in Prometheus format',
  })
  @ApiResponse({
    status: 200,
    description: 'Successful response with metrics data',
  })
  async getMetrics(): Promise<string> {
    return register.metrics();
  }

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
  @ApiBearerAuth()
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
