import { Test, TestingModule } from '@nestjs/testing';
import { ApiGatewayController } from './api-gateway.controller';
import { ApiGatewayService } from './api-gateway.service';
import { AiProvidersService } from './ai-providers/ai-providers.service';

describe('ApiGatewayController.getMetrics (Backpressure/Admission control, mục 3/4)', () => {
  let controller: ApiGatewayController;
  const mockAiProvidersService = { getMetricsText: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiGatewayController],
      providers: [
        ApiGatewayService,
        { provide: AiProvidersService, useValue: mockAiProvidersService },
      ],
    }).compile();

    controller = module.get<ApiGatewayController>(ApiGatewayController);
  });

  afterEach(() => jest.clearAllMocks());

  it('appends orchestration metrics text after its own default Node metrics', async () => {
    mockAiProvidersService.getMetricsText.mockResolvedValue(
      'orchestration_circuit_breaker_state{key="mcp:sql_server"} 0',
    );

    const result = await controller.getMetrics();

    expect(result).toContain(
      'orchestration_circuit_breaker_state{key="mcp:sql_server"} 0',
    );
    // Default Node metrics (từ collectDefaultMetrics()) vẫn phải còn nguyên.
    expect(result.length).toBeGreaterThan(
      'orchestration_circuit_breaker_state{key="mcp:sql_server"} 0'.length,
    );
  });

  it('falls back to just its own metrics (does not throw) when orchestration is unreachable', async () => {
    mockAiProvidersService.getMetricsText.mockRejectedValue(
      new Error('connect ECONNREFUSED'),
    );

    await expect(controller.getMetrics()).resolves.not.toContain(
      'orchestration_',
    );
  });
});
