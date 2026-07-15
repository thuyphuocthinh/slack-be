import { Test, TestingModule } from '@nestjs/testing';
import { of } from 'rxjs';
import { AiProvidersService } from './ai-providers.service';
import {
  NAME_SERVICE_TCP,
  ORCHESTRATION_MESSAGE_PATTERNS,
} from '@slack/constants';
import { RegisterDynamicProviderDto } from './dto/register-dynamic-provider.dto';

describe('AiProvidersService', () => {
  let service: AiProvidersService;
  const mockClientProxy = { send: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiProvidersService,
        {
          provide: NAME_SERVICE_TCP.ORCHESTRATION_SERVICE,
          useValue: mockClientProxy,
        },
      ],
    }).compile();

    service = module.get<AiProvidersService>(AiProvidersService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('registerDynamicProvider', () => {
    it('forwards every OAuth2 field (refreshToken/tokenUrl/clientId/clientSecret/refreshRequestFormat/response*Path/defaultExpiresInSecs) to the orchestration microservice — regression test for the bug where only 5 legacy fields ever made it through', async () => {
      mockClientProxy.send.mockReturnValue(
        of({ id: 'dynamic_abc', success: true }),
      );

      const dto: RegisterDynamicProviderDto = {
        name: 'Jira',
        specUrl: 'https://your-domain.atlassian.net/openapi.json',
        description: 'Internal ticketing',
        accessToken: 'stale-token',
        authType: 'OAUTH2',
        refreshToken: 'initial-refresh-token',
        tokenUrl: 'https://auth.atlassian.com/oauth/token',
        clientId: 'cid',
        clientSecret: 'csecret',
        refreshRequestFormat: 'json',
        responseAccessTokenPath: 'payload.token.at',
        responseRefreshTokenPath: 'payload.token.rt',
        responseExpiresInPath: 'payload.token.ttl',
        defaultExpiresInSecs: 900,
      };

      const result = await service.registerDynamicProvider('user-1', dto);

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        ORCHESTRATION_MESSAGE_PATTERNS.REGISTER_DYNAMIC_PROVIDER,
        { userId: 'user-1', ...dto },
      );
      expect(result).toEqual({ id: 'dynamic_abc', success: true });
    });
  });

  describe('updateDynamicProvider', () => {
    it('forwards userId, providerId, and every field from the dto (reconnect fields included) to the orchestration microservice', async () => {
      mockClientProxy.send.mockReturnValue(
        of({ id: 'dynamic_abc', success: true }),
      );

      const dto = {
        refreshToken: 'new-refresh-token',
        clientSecret: 'new-csecret',
      };

      const result = await service.updateDynamicProvider(
        'user-1',
        'dynamic_abc',
        dto,
      );

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        ORCHESTRATION_MESSAGE_PATTERNS.UPDATE_DYNAMIC_PROVIDER,
        { userId: 'user-1', providerId: 'dynamic_abc', ...dto },
      );
      expect(result).toEqual({ id: 'dynamic_abc', success: true });
    });
  });

  describe('deleteDynamicProvider', () => {
    it('forwards userId and providerId to the orchestration microservice', async () => {
      mockClientProxy.send.mockReturnValue(of({ success: true }));

      await service.deleteDynamicProvider('user-1', 'dynamic_abc');

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        ORCHESTRATION_MESSAGE_PATTERNS.DELETE_DYNAMIC_PROVIDER,
        { userId: 'user-1', providerId: 'dynamic_abc' },
      );
    });
  });

  describe('getHealth (Backpressure/Admission control, mục 2)', () => {
    it('calls HEALTH_CHECK with no payload and returns the raw result', async () => {
      const health = {
        status: 'ok',
        redis: true,
        database: true,
        circuitBreakers: {},
        queueDepth: { waiting: 0, active: 0 },
      };
      mockClientProxy.send.mockReturnValue(of(health));

      const result = await service.getHealth();

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        ORCHESTRATION_MESSAGE_PATTERNS.HEALTH_CHECK,
        {},
      );
      expect(result).toEqual(health);
    });
  });

  describe('getMetricsText (mục 3)', () => {
    it('calls GET_METRICS and unwraps { metricsText } into a plain string', async () => {
      mockClientProxy.send.mockReturnValue(of({ metricsText: '# HELP ...' }));

      const result = await service.getMetricsText();

      expect(mockClientProxy.send).toHaveBeenCalledWith(
        ORCHESTRATION_MESSAGE_PATTERNS.GET_METRICS,
        {},
      );
      expect(result).toBe('# HELP ...');
    });
  });
});
