import { Test, TestingModule } from '@nestjs/testing';
import { OrchestrationController } from './orchestration.controller';
import { McpAuthClientService } from './mcp-auth/mcp-auth-client.service';
import { McpClientService } from './mcp/mcp-client.service';
import { AiOrchestrationProcessor } from './processor/ai-orchestration.processor';
import { DynamicProviderDbService } from './registry/dynamic-provider-db.service';
import { ProviderSummaryService } from './registry/provider-summary.service';
import { EDynamicProviderAuthType } from './entity/dynamic-provider.entity';

describe('OrchestrationController', () => {
  let controller: OrchestrationController;
  let dynamicProviderDb: jest.Mocked<
    Pick<DynamicProviderDbService, 'registerProvider' | 'updateProvider'>
  >;
  let providerSummary: jest.Mocked<
    Pick<ProviderSummaryService, 'getProviders'>
  >;

  beforeEach(async () => {
    dynamicProviderDb = {
      registerProvider: jest.fn().mockResolvedValue({ id: 'dynamic_abc123' }),
      updateProvider: jest.fn().mockResolvedValue({ id: 'dynamic_abc123' }),
    };
    providerSummary = {
      getProviders: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrchestrationController],
      providers: [
        { provide: McpAuthClientService, useValue: {} },
        { provide: McpClientService, useValue: {} },
        { provide: AiOrchestrationProcessor, useValue: {} },
        { provide: DynamicProviderDbService, useValue: dynamicProviderDb },
        { provide: ProviderSummaryService, useValue: providerSummary },
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
});
