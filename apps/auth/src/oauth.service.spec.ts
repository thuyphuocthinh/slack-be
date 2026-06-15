import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RpcException } from '@nestjs/microservices';
import { JwtService } from '@nestjs/jwt';
import { DataSource, Repository } from 'typeorm';
import { of, throwError } from 'rxjs';
import * as argon2 from 'argon2';

import { OAuthService } from './oauth.service';
import { OAuthClientEntity } from './entity/oauth-client.entity';
import { OAuthAuthCodeEntity } from './entity/oauth-auth-code.entity';
import { OAuthTokenEntity } from './entity/oauth-token.entity';
import { NAME_SERVICE_TCP, OAUTH_ERROR, OAuthScope, USER_MESSAGE_PATTERNS } from '@slack/constants';

jest.mock('argon2', () => ({
  hash: jest.fn().mockResolvedValue('hashed_secret'),
  verify: jest.fn().mockResolvedValue(true),
}));

describe('OAuthService', () => {
  let service: OAuthService;
  let clientRepository: Repository<OAuthClientEntity>;
  let authCodeRepository: Repository<OAuthAuthCodeEntity>;
  let tokenRepository: Repository<OAuthTokenEntity>;
  let userClient: any;
  let jwtService: JwtService;
  let dataSource: DataSource;

  const mockRepository = () => ({
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
    delete: jest.fn(),
  });

  const mockClientProxy = () => ({
    send: jest.fn(),
    emit: jest.fn(),
  });

  const mockEntityManager = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn((cb) => cb(mockEntityManager)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OAuthService,
        {
          provide: getRepositoryToken(OAuthClientEntity),
          useFactory: mockRepository,
        },
        {
          provide: getRepositoryToken(OAuthAuthCodeEntity),
          useFactory: mockRepository,
        },
        {
          provide: getRepositoryToken(OAuthTokenEntity),
          useFactory: mockRepository,
        },
        {
          provide: NAME_SERVICE_TCP.USER_SERVICE,
          useFactory: mockClientProxy,
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(),
            verifyAsync: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<OAuthService>(OAuthService);
    clientRepository = module.get(getRepositoryToken(OAuthClientEntity));
    authCodeRepository = module.get(getRepositoryToken(OAuthAuthCodeEntity));
    tokenRepository = module.get(getRepositoryToken(OAuthTokenEntity));
    userClient = module.get(NAME_SERVICE_TCP.USER_SERVICE);
    jwtService = module.get(JwtService);
    dataSource = module.get(DataSource);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ================= DEVELOPER CONSOLE =================

  describe('createClient', () => {
    const createDto = {
      name: 'Test App',
      logoUrl: 'http://example.com/logo.png',
      redirectUris: ['http://example.com/callback'],
    };

    it('should create an OAuth client successfully', async () => {
      const mockSavedClient = {
        id: 'client-id-uuid',
        ownerId: 'owner-id',
        name: 'Test App',
        logoUrl: 'http://example.com/logo.png',
        clientId: 'oauth-client-id',
        clientSecret: 'hashed_secret',
        redirectUris: ['http://example.com/callback'],
        allowedScopes: [OAuthScope.OPENID, OAuthScope.PROFILE, OAuthScope.EMAIL],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      (clientRepository.create as jest.Mock).mockReturnValue(mockSavedClient);
      (clientRepository.save as jest.Mock).mockResolvedValue(mockSavedClient);

      const result = await service.createClient('owner-id', createDto);

      expect(result).toBeDefined();
      expect(result.name).toBe('Test App');
      expect(result.clientSecret).toBeDefined(); // Plain text secret returned
      expect(clientRepository.create).toHaveBeenCalled();
      expect(clientRepository.save).toHaveBeenCalled();
    });
  });

  describe('getClients', () => {
    it('should return all clients owned by a user', async () => {
      const mockClients = [
        { id: '1', name: 'App 1', ownerId: 'owner-id', redirectUris: [], allowedScopes: [] },
        { id: '2', name: 'App 2', ownerId: 'owner-id', redirectUris: [], allowedScopes: [] },
      ];
      (clientRepository.find as jest.Mock).mockResolvedValue(mockClients);

      const result = await service.getClients('owner-id');

      expect(result.length).toBe(2);
      expect(clientRepository.find).toHaveBeenCalledWith({
        where: { ownerId: 'owner-id' },
        order: { createdAt: 'DESC' },
      });
    });
  });

  describe('getClientDetails', () => {
    it('should return client details when found', async () => {
      const mockClient = { id: '1', name: 'App 1', ownerId: 'owner-id', redirectUris: [], allowedScopes: [] };
      (clientRepository.findOne as jest.Mock).mockResolvedValue(mockClient);

      const result = await service.getClientDetails('owner-id', '1');

      expect(result.name).toBe('App 1');
    });

    it('should throw RpcException when client not found', async () => {
      (clientRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getClientDetails('owner-id', '1')).rejects.toThrow(RpcException);
    });
  });

  describe('updateClient', () => {
    it('should update and return client', async () => {
      const mockClient = { id: '1', name: 'Old App', ownerId: 'owner-id', redirectUris: [], allowedScopes: [] };
      (clientRepository.findOne as jest.Mock).mockResolvedValue(mockClient);
      (clientRepository.save as jest.Mock).mockResolvedValue({
        ...mockClient,
        name: 'New App',
      });

      const result = await service.updateClient('owner-id', '1', { name: 'New App' });

      expect(result.name).toBe('New App');
      expect(clientRepository.save).toHaveBeenCalled();
    });
  });

  describe('deleteClient', () => {
    it('should delete client successfully', async () => {
      (clientRepository.delete as jest.Mock).mockResolvedValue({ affected: 1 });

      const result = await service.deleteClient('owner-id', '1');

      expect(result).toBe(true);
      expect(clientRepository.delete).toHaveBeenCalledWith({ id: '1', ownerId: 'owner-id' });
    });

    it('should throw error when client to delete not found', async () => {
      (clientRepository.delete as jest.Mock).mockResolvedValue({ affected: 0 });

      await expect(service.deleteClient('owner-id', '1')).rejects.toThrow(RpcException);
    });
  });

  // ================= OAUTH PROVIDER FLOW =================

  describe('getAuthorizeDetails', () => {
    const data = { clientId: 'client-id', redirectUri: 'http://example.com/callback' };

    it('should return app details if request is valid', async () => {
      const mockClient = {
        name: 'Test Client',
        logoUrl: 'http://logo',
        redirectUris: ['http://example.com/callback'],
        allowedScopes: [OAuthScope.OPENID],
      };
      (clientRepository.findOne as jest.Mock).mockResolvedValue(mockClient);

      const result = await service.getAuthorizeDetails(data);

      expect(result.clientName).toBe('Test Client');
      expect(result.allowedScopes).toEqual([OAuthScope.OPENID]);
    });

    it('should throw mismatch error if redirectUri not registered', async () => {
      const mockClient = {
        name: 'Test Client',
        redirectUris: ['http://other.com'],
      };
      (clientRepository.findOne as jest.Mock).mockResolvedValue(mockClient);

      await expect(service.getAuthorizeDetails(data)).rejects.toThrow(RpcException);
    });
  });

  describe('approveConsent', () => {
    const data = {
      clientId: 'client-id',
      redirectUri: 'http://example.com/callback',
      scopes: [OAuthScope.OPENID],
    };

    it('should generate auth code and redirectUrl', async () => {
      const mockClient = {
        clientId: 'client-id',
        redirectUris: ['http://example.com/callback'],
        allowedScopes: [OAuthScope.OPENID, OAuthScope.PROFILE],
      };
      (clientRepository.findOne as jest.Mock).mockResolvedValue(mockClient);
      (authCodeRepository.create as jest.Mock).mockReturnValue({});
      (authCodeRepository.save as jest.Mock).mockResolvedValue({});

      const result = await service.approveConsent('user-id', data);

      expect(result.redirectUrl).toContain('code=');
      expect(authCodeRepository.save).toHaveBeenCalled();
    });
  });

  describe('exchangeToken', () => {
    const data = {
      clientId: 'client-id',
      clientSecret: 'secret',
      code: 'code',
      redirectUri: 'http://example.com/callback',
    };

    it('should exchange code for tokens in transaction', async () => {
      const mockClient = {
        clientId: 'client-id',
        clientSecret: 'hashed_secret',
      };
      (clientRepository.findOne as jest.Mock).mockResolvedValue(mockClient);
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const mockAuthCode = {
        code: 'code',
        clientId: 'client-id',
        userId: 'user-id',
        redirectUri: 'http://example.com/callback',
        scopes: [OAuthScope.OPENID],
        expiresAt: new Date(Date.now() + 100000),
      };

      mockEntityManager.findOne.mockResolvedValue(mockAuthCode);
      mockEntityManager.create.mockReturnValue({});
      mockEntityManager.save.mockResolvedValue({});
      (jwtService.signAsync as jest.Mock).mockResolvedValue('jwt-access-token');

      const result = await service.exchangeToken(data);

      expect(result.accessToken).toBe('jwt-access-token');
      expect(result.tokenType).toBe('Bearer');
      expect(mockEntityManager.remove).toHaveBeenCalledWith(mockAuthCode);
      expect(mockEntityManager.save).toHaveBeenCalled();
    });
  });

  describe('getUserInfo', () => {
    it('should return user info when token is valid', async () => {
      const mockToken = {
        accessToken: 'valid-token',
        userId: 'user-id',
        expiresAt: new Date(Date.now() + 100000),
      };
      (tokenRepository.findOne as jest.Mock).mockResolvedValue(mockToken);
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: 'user-id' });

      userClient.send.mockReturnValue(of({
        id: 'user-id',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        avatarUrl: 'http://avatar',
      }));

      const result = await service.getUserInfo('valid-token');

      expect(result.email).toBe('test@example.com');
      expect(result.name).toBe('John Doe');
      expect(result.picture).toBe('http://avatar');
    });

    it('should throw error when token not found in DB', async () => {
      (tokenRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getUserInfo('invalid')).rejects.toThrow(RpcException);
    });
  });
});
