import { Controller, Get, Header, Logger } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiGatewayService } from './api-gateway.service';
import { Public } from '@slack/common';
import { collectDefaultMetrics, register } from 'prom-client';
import { AiProvidersService } from './ai-providers/ai-providers.service';

collectDefaultMetrics();

@ApiTags('API Gateway')
@Controller()
export class ApiGatewayController {
  private readonly logger = new Logger(ApiGatewayController.name);

  constructor(
    private readonly apiGatewayService: ApiGatewayService,
    private readonly aiProvidersService: AiProvidersService,
  ) {}

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
    const ownMetrics = await register.metrics();

    // Backpressure/Admission control, mục 3/4 — orchestration là process TCP
    // riêng, giữ registry Prometheus RIÊNG (không chia sẻ global `register`
    // với api-gateway) — ghép text vào đây để dùng CHUNG 1 scrape target đã
    // có sẵn (`prometheus.yml` job "api-gateway"), không cần thêm job mới.
    // Lỗi ở đây (orchestration down) KHÔNG được làm mất luôn metrics của
    // chính api-gateway — chỉ bỏ qua phần orchestration, log lại để biết.
    try {
      const orchestrationMetrics = await this.aiProvidersService.getMetricsText();
      return `${ownMetrics}\n${orchestrationMetrics}`;
    } catch (error) {
      this.logger.warn(
        `getMetrics() không lấy được metrics của orchestration: ${(error as Error).message}`,
      );
      return ownMetrics;
    }
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
