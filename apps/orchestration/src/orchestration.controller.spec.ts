import { Test, TestingModule } from '@nestjs/testing';
import { OrchestrationController } from './orchestration.controller';
import { McpAuthClientService } from './mcp-auth/mcp-auth-client.service';
import { McpClientService } from './mcp/mcp-client.service';
import { AiOrchestrationProcessor } from './processor/ai-orchestration.processor';
import { ApprovalRequestService } from './processor/approval-request.service';
import { DynamicProviderDbService } from './registry/dynamic-provider-db.service';
import { ProviderSummaryService } from './registry/provider-summary.service';
import { HealthCheckService } from './common/health-check.service';
import { EDynamicProviderAuthType } from './entity/dynamic-provider.entity';

describe('OrchestrationController', () => {
  let controller: OrchestrationController;
  let dynamicProviderDb: jest.Mocked<
    Pick<DynamicProviderDbService, 'registerProvider' | 'updateProvider'>
  >;
  let providerSummary: jest.Mocked<
    Pick<ProviderSummaryService, 'getProviders'>
  >;
  let healthCheckService: jest.Mocked<
    Pick<HealthCheckService, 'check' | 'getMetricsText'>
  >;

  beforeEach(async () => {
    dynamicProviderDb = {
      registerProvider: jest.fn().mockResolvedValue({ id: 'dynamic_abc123' }),
      updateProvider: jest.fn().mockResolvedValue({ id: 'dynamic_abc123' }),
    };
    providerSummary = {
      getProviders: jest.fn().mockResolvedValue([]),
    };
    healthCheckService = {
      check: jest.fn(),
      getMetricsText: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrchestrationController],
      providers: [
        { provide: McpAuthClientService, useValue: {} },
        { provide: McpClientService, useValue: {} },
        { provide: AiOrchestrationProcessor, useValue: {} },
        { provide: ApprovalRequestService, useValue: {} },
        { provide: DynamicProviderDbService, useValue: dynamicProviderDb },
        { provide: ProviderSummaryService, useValue: providerSummary },
        { provide: HealthCheckService, useValue: healthCheckService },
      ],
    }).compile();

    controller = module.get<OrchestrationController>(OrchestrationController);
  });

  describe('getProviders', () => {
    it('delegates to ProviderSummaryService.getProviders', async () => {
      const summaries = [{ provider: 'notion' }];
      providerSummary.getProviders.mockResolvedValue(summaries as any);

      const result = await controller.getProviders({ userId: 'user-1' });

      expect(providerSummary.getProviders).toHaveBeenCalledWith('user-1');
      expect(result).toBe(summaries);
    });
  });

  describe('registerDynamicProvider', () => {
    it('delegates the request as-is to DynamicProviderDbService.registerProvider and maps its result', async () => {
      const dto = {
        userId: 'user-1',
        name: 'Spotify',
        specUrl: 'https://api.spotify.com/openapi.json',
        authType: EDynamicProviderAuthType.OAUTH2,
        refreshToken: 'initial-refresh-token',
        tokenUrl: 'https://accounts.spotify.com/api/token',
        clientId: 'cid',
        clientSecret: 'csecret',
      };

      const result = await controller.registerDynamicProvider(dto);

      expect(dynamicProviderDb.registerProvider).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ id: 'dynamic_abc123', success: true });
    });
  });

  describe('updateDynamicProvider', () => {
    it('delegates the request as-is to DynamicProviderDbService.updateProvider and maps its result', async () => {
      const dto = {
        userId: 'user-1',
        providerId: 'dynamic_abc123',
        refreshToken: 'new-refresh-token',
      };

      const result = await controller.updateDynamicProvider(dto);

      expect(dynamicProviderDb.updateProvider).toHaveBeenCalledWith(dto);
      expect(result).toEqual({ id: 'dynamic_abc123', success: true });
    });
  });

  describe('healthCheck (Backpressure/Admission control, mục 2)', () => {
    it('delegates to HealthCheckService.check', async () => {
      const health = {
        status: 'ok' as const,
        redis: true,
        database: true,
        circuitBreakers: {},
        queueDepth: { waiting: 0, active: 0 },
      };
      healthCheckService.check.mockResolvedValue(health);

      const result = await controller.healthCheck();

      expect(result).toBe(health);
    });
  });

  describe('getMetrics (Backpressure/Admission control, mục 3)', () => {
    it('wraps HealthCheckService.getMetricsText into { metricsText }', async () => {
      healthCheckService.getMetricsText.mockResolvedValue('# HELP ...');

      const result = await controller.getMetrics();

      expect(result).toEqual({ metricsText: '# HELP ...' });
    });
  });
});
