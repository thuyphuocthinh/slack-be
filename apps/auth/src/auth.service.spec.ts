jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthEntity } from './entity/auth.entity';
import { SessionEntity } from './entity/session.entity';
import { VerificationEntity } from './entity/verification.entity';
import { JwtService } from '@nestjs/jwt';
import { AuthCacheService } from '@slack/cached';
import { RpcException } from '@nestjs/microservices';
import {
  NAME_SERVICE_TCP,
  USER_MESSAGE_PATTERNS,
  NOTIFICATION_MESSAGE_PATTERNS,
} from '@slack/constants';
import { Repository } from 'typeorm';
import { of, throwError } from 'rxjs';
import * as bcrypt from 'bcrypt';
import { v7 } from 'uuid';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let authRepository: Repository<AuthEntity>;
  let sessionRepository: Repository<SessionEntity>;
  let verificationRepository: Repository<VerificationEntity>;
  let userClient: any;
  let notificationClient: any;
  let jwtService: JwtService;
  let authCacheService: AuthCacheService;

  const mockRepository = () => ({
    findOneBy: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  });

  const mockClientProxy = () => ({
    send: jest.fn(),
    emit: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: getRepositoryToken(AuthEntity),
          useFactory: mockRepository,
        },
        {
          provide: getRepositoryToken(SessionEntity),
          useFactory: mockRepository,
        },
        {
          provide: getRepositoryToken(VerificationEntity),
          useFactory: mockRepository,
        },
        {
          provide: NAME_SERVICE_TCP.USER_SERVICE,
          useFactory: mockClientProxy,
        },
        {
          provide: NAME_SERVICE_TCP.NOTIFICATION_SERVICE,
          useFactory: mockClientProxy,
        },
        {
          provide: JwtService,
          useValue: {
            signAsync: jest.fn(),
            verifyAsync: jest.fn(),
            decode: jest.fn(),
          },
        },
        {
          provide: AuthCacheService,
          useValue: {
            getUserTokenVersion: jest.fn(),
            blacklistToken: jest.fn(),
            bumpUserTokenVersion: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    authRepository = module.get(getRepositoryToken(AuthEntity));
    sessionRepository = module.get(getRepositoryToken(SessionEntity));
    verificationRepository = module.get(getRepositoryToken(VerificationEntity));
    userClient = module.get(NAME_SERVICE_TCP.USER_SERVICE);
    notificationClient = module.get(NAME_SERVICE_TCP.NOTIFICATION_SERVICE);
    jwtService = module.get(JwtService);
    authCacheService = module.get(AuthCacheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const registerDto = { email: 'test@example.com', password: 'password123' };

    it('should register successfully', async () => {
      (authRepository.findOneBy as jest.Mock).mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      userClient.send.mockReturnValue(of({ id: 'user-id' }));
      (authRepository.create as jest.Mock).mockReturnValue({});
      (verificationRepository.create as jest.Mock).mockReturnValue({
        code: 'code',
        userId: 'user-id',
      });
      (v7 as jest.Mock).mockReturnValue('uuid-v7');

      const result = await service.register(registerDto);

      expect(result).toBe(
        'We have sent you a verification email. Please check your inbox to verify your account.',
      );
      expect(authRepository.save).toHaveBeenCalled();
      expect(verificationRepository.save).toHaveBeenCalled();
      expect(notificationClient.emit).toHaveBeenCalledWith(
        NOTIFICATION_MESSAGE_PATTERNS.SEND_VERIFICATION_EMAIL,
        expect.any(Object),
      );
    });

    it('should throw RpcException if account already exists', async () => {
      (authRepository.findOneBy as jest.Mock).mockResolvedValue({
        id: 'existing',
      });

      await expect(service.register(registerDto)).rejects.toThrow(RpcException);
    });

    it('should throw error if user creation fails', async () => {
      (authRepository.findOneBy as jest.Mock).mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword');
      userClient.send.mockReturnValue(
        throwError(() => new Error('Creation failed')),
      );

      await expect(service.register(registerDto)).rejects.toThrow(
        'Creation failed',
      );
    });
  });

  describe('verifyEmail', () => {
    const verifyDto = { code: 'valid-code' };

    it('should verify email successfully', async () => {
      const verification = {
        userId: 'user-id',
        expiresAt: new Date(Date.now() + 10000),
        isUsed: false,
      };
      (verificationRepository.findOne as jest.Mock).mockResolvedValue(
        verification,
      );
      (authRepository.findOne as jest.Mock).mockResolvedValue({
        userId: 'user-id',
      });

      const result = await service.verifyEmail(verifyDto);

      expect(result).toBe('Email successfully verified.');
      expect(verification.isUsed).toBe(true);
      expect(verificationRepository.save).toHaveBeenCalledWith(verification);
      expect(userClient.emit).toHaveBeenCalledWith(
        USER_MESSAGE_PATTERNS.CHANGE_USER_STATUS,
        {
          id: 'user-id',
          status: 'active',
        },
      );
    });

    it('should throw error if verification code not found', async () => {
      (verificationRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.verifyEmail(verifyDto)).rejects.toThrow(
        RpcException,
      );
    });

    it('should throw error if verification code expired', async () => {
      const verification = { expiresAt: new Date(Date.now() - 10000) };
      (verificationRepository.findOne as jest.Mock).mockResolvedValue(
        verification,
      );

      await expect(service.verifyEmail(verifyDto)).rejects.toThrow(
        RpcException,
      );
    });
  });

  describe('login', () => {
    const loginDto = { email: 'test@example.com', password: 'password123' };
    const auth = { userId: 'user-id', password: 'hashedPassword' };

    it('should login successfully', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue(auth);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      userClient.send.mockReturnValue(of({ status: 'active' }));
      (authCacheService.getUserTokenVersion as jest.Mock).mockResolvedValue(1);
      (jwtService.signAsync as jest.Mock).mockResolvedValue('token');
      (sessionRepository.create as jest.Mock).mockReturnValue({});

      const result = await service.login(loginDto);

      expect(result).toEqual({
        accessToken: 'token',
        refreshToken: 'token',
        type: 'Bearer',
      });
    });

    it('should throw error if auth not found', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(RpcException);
    });

    it('should throw error if password invalid', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue(auth);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(RpcException);
    });
  });

  describe('refresh', () => {
    const refreshDto = { refreshToken: 'valid-refresh-token' };
    const session = {
      userId: 'user-id',
      expiresAt: new Date(Date.now() + 10000),
      isRevoked: false,
    };

    it('should refresh tokens successfully', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({});
      (sessionRepository.findOne as jest.Mock).mockResolvedValue(session);
      (jwtService.decode as jest.Mock).mockReturnValue({
        email: 'test@example.com',
      });
      (authCacheService.getUserTokenVersion as jest.Mock).mockResolvedValue(1);
      (jwtService.signAsync as jest.Mock).mockResolvedValue('new-token');
      (sessionRepository.create as jest.Mock).mockReturnValue({});

      const result = await service.refresh(refreshDto);

      expect(result).toEqual({
        accessToken: 'new-token',
        refreshToken: 'new-token',
        type: 'Bearer',
      });
      expect(session.isRevoked).toBe(true);
      expect(sessionRepository.save).toHaveBeenCalled();
    });

    it('should throw error if token verification fails', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error());

      await expect(service.refresh(refreshDto)).rejects.toThrow(RpcException);
    });

    it('should throw error if session is revoked or expired', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({});
      (sessionRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.refresh(refreshDto)).rejects.toThrow(RpcException);
    });
  });

  describe('loginGoogle', () => {
    const googleDto = { email: 'google@example.com' };

    it('should login with google for new user', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue(null);
      userClient.send.mockReturnValue(of({ id: 'new-google-user-id' }));
      (authRepository.create as jest.Mock).mockReturnValue({
        userId: 'new-google-user-id',
      });
      (authRepository.save as jest.Mock).mockResolvedValue({
        userId: 'new-google-user-id',
      });
      (authCacheService.getUserTokenVersion as jest.Mock).mockResolvedValue(1);
      (jwtService.signAsync as jest.Mock).mockResolvedValue('google-token');

      const result = await service.loginGoogle(googleDto);

      expect(result.accessToken).toBe('google-token');
      expect(authRepository.create).toHaveBeenCalled();
    });

    it('should login with google for existing user', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue({
        userId: 'existing-google-user-id',
      });
      (authCacheService.getUserTokenVersion as jest.Mock).mockResolvedValue(1);
      (jwtService.signAsync as jest.Mock).mockResolvedValue('google-token');

      const result = await service.loginGoogle(googleDto);

      expect(result.accessToken).toBe('google-token');
      expect(authRepository.create).not.toHaveBeenCalled();
    });

    it('should throw error if user creation fails in loginGoogle', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue(null);
      userClient.send.mockReturnValue(
        throwError(() => new Error('Creation failed')),
      );

      await expect(service.loginGoogle(googleDto)).rejects.toThrow(
        'Creation failed',
      );
    });
  });

  describe('logout', () => {
    const logoutDto = { accessToken: 'at', refreshToken: 'rt' };
    const session = {
      isRevoked: false,
      expiresAt: new Date(Date.now() + 10000),
    };

    it('should logout successfully', async () => {
      (sessionRepository.findOne as jest.Mock).mockResolvedValue(session);

      const result = await service.logout(logoutDto);

      expect(result).toBe('Logout successfully.');
      expect(session.isRevoked).toBe(true);
      expect(authCacheService.blacklistToken).toHaveBeenCalled();
    });

    it('should throw error if session not found during logout', async () => {
      (sessionRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.logout(logoutDto)).rejects.toThrow(RpcException);
    });

    it('should blacklist token during logout', async () => {
      (sessionRepository.findOne as jest.Mock).mockResolvedValue(session);

      await service.logout(logoutDto);

      expect(authCacheService.blacklistToken).toHaveBeenCalledWith(
        'at',
        expect.any(Number),
      );
    });
  });

  describe('logoutAll', () => {
    const userId = 'user-id';

    it('should logout all sessions successfully', async () => {
      const sessions = [{ isRevoked: false }, { isRevoked: false }];
      (sessionRepository.find as jest.Mock).mockResolvedValue(sessions);

      const result = await service.logoutAll({ userId });

      expect(result).toBe('Logout all successfully.');
      expect(sessions.every((s) => s.isRevoked)).toBe(true);
      expect(authCacheService.bumpUserTokenVersion).toHaveBeenCalledWith(
        userId,
      );
    });

    it('should throw error if no sessions found', async () => {
      (sessionRepository.find as jest.Mock).mockResolvedValue(null);

      await expect(service.logoutAll({ userId })).rejects.toThrow(RpcException);
    });

    it('should bump token version in cache during logoutAll', async () => {
      (sessionRepository.find as jest.Mock).mockResolvedValue([]);

      const result = await service.logoutAll({ userId });
      expect(result).toBe('Logout all successfully.');
      expect(authCacheService.bumpUserTokenVersion).toHaveBeenCalledWith(
        userId,
      );
    });
  });

  describe('forgotPassword', () => {
    const email = 'test@example.com';

    it('should create verification and emit event successfully', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue({
        userId: 'user-id',
      });
      (verificationRepository.create as jest.Mock).mockReturnValue({
        code: 'code',
      });

      const result = await service.forgotPassword({ email });

      expect(result).toBe('Check your email to verify your email.');
      expect(verificationRepository.save).toHaveBeenCalled();
      expect(notificationClient.emit).toHaveBeenCalledWith(
        NOTIFICATION_MESSAGE_PATTERNS.SEND_RESET_PASSWORD_EMAIL,
        expect.any(Object),
      );
    });

    it('should throw error if account not found', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.forgotPassword({ email })).rejects.toThrow(
        RpcException,
      );
    });

    it('should throw error if email emission fails', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue({
        userId: 'user-id',
      });
      (verificationRepository.create as jest.Mock).mockReturnValue({
        code: 'code',
      });
      notificationClient.emit.mockImplementation(() => {
        throw new Error('Emit failed');
      });

      await expect(service.forgotPassword({ email })).rejects.toThrow(
        'Emit failed',
      );
    });
  });

  describe('verifyResetPassword', () => {
    const code = 'valid-code';

    it('should verify reset password successfully', async () => {
      const verification = { userId: 'user-id', isUsed: false };
      (verificationRepository.findOne as jest.Mock).mockResolvedValue(
        verification,
      );
      userClient.send.mockReturnValue(of({ id: 'user-id' }));

      const result = await service.verifyResetPassword({ code });

      expect(result).toBe('Verify reset password successfully.');
      expect(verification.isUsed).toBe(true);
      expect(verificationRepository.save).toHaveBeenCalled();
    });

    it('should throw error if verification code invalid or expired', async () => {
      (verificationRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.verifyResetPassword({ code })).rejects.toThrow(
        RpcException,
      );
    });

    it('should throw error if user not found during verification', async () => {
      (verificationRepository.findOne as jest.Mock).mockResolvedValue({
        userId: 'user-id',
      });
      userClient.send.mockReturnValue(of(null));

      await expect(service.verifyResetPassword({ code })).rejects.toThrow(
        RpcException,
      );
    });
  });

  describe('resetPassword', () => {
    const resetDto = {
      email: 'test@example.com',
      code: 'code',
      password: 'new-password',
    };

    it('should reset password successfully', async () => {
      const auth = { password: 'old' };
      const verification = { isUsed: false };
      (authRepository.findOne as jest.Mock).mockResolvedValue(auth);
      (verificationRepository.findOne as jest.Mock).mockResolvedValue(
        verification,
      );
      (bcrypt.hash as jest.Mock).mockResolvedValue('new-hashed-password');

      const result = await service.resetPassword(resetDto);

      expect(result).toBe('Reset password successfully.');
      expect(auth.password).toBe('new-hashed-password');
      expect(verification.isUsed).toBe(true);
      expect(authRepository.save).toHaveBeenCalled();
      expect(verificationRepository.save).toHaveBeenCalled();
    });

    it('should throw error if account not found during reset', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.resetPassword(resetDto)).rejects.toThrow(
        RpcException,
      );
    });

    it('should throw error if code is invalid/expired during reset', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue({
        userId: 'user-id',
      });
      (verificationRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.resetPassword(resetDto)).rejects.toThrow(
        RpcException,
      );
    });
  });
});
