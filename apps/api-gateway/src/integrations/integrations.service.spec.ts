import { Test, TestingModule } from '@nestjs/testing';
import { ClientProxy } from '@nestjs/microservices';
import { IntegrationsService } from './integrations.service';
import { NAME_SERVICE_TCP, INTEGRATIONS_MESSAGE_PATTERNS } from '@slack/constants';
import { of } from 'rxjs';

describe('IntegrationsService', () => {
  let service: IntegrationsService;
  let clientProxy: ClientProxy;

  const mockClientProxy = {
    send: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IntegrationsService,
        {
          provide: NAME_SERVICE_TCP.INTEGRATIONS_SERVICE,
          useValue: mockClientProxy,
        },
      ],
    }).compile();

    service = module.get<IntegrationsService>(IntegrationsService);
    clientProxy = module.get<ClientProxy>(NAME_SERVICE_TCP.INTEGRATIONS_SERVICE);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateAuthUrl', () => {
    it('should forward request to microservice and return authUrl if present', async () => {
      mockClientProxy.send.mockReturnValue(of({ authUrl: 'https://test-auth-url' }));

      const result = await service.generateAuthUrl(
        'user-1',
        'workspace-1',
        'google',
        ['scope-1'],
        'workspace',
        'http://return.url'
      );

      expect(mockClientProxy.send).toHaveBeenCalledWith(INTEGRATIONS_MESSAGE_PATTERNS.AUTH_GENERATE_URL, {
        userId: 'user-1',
        workspaceId: 'workspace-1',
        provider: 'google',
        scopes: ['scope-1'],
        targetType: 'workspace',
        returnUrl: 'http://return.url',
      });
      expect(result).toBe('https://test-auth-url');
    });
  });

  describe('handleCallback', () => {
    it('should forward request to microservice', async () => {
      mockClientProxy.send.mockReturnValue(of({ success: true, returnUrl: 'http://test.com' }));

      const result = await service.handleCallback('google', 'code-123', 'state-id');

      expect(mockClientProxy.send).toHaveBeenCalledWith(INTEGRATIONS_MESSAGE_PATTERNS.AUTH_HANDLE_CALLBACK, {
        provider: 'google',
        code: 'code-123',
        state: 'state-id',
      });
      expect(result).toEqual({ success: true, returnUrl: 'http://test.com' });
    });
  });
});
