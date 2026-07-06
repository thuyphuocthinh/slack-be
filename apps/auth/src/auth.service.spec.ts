jest.mock('uuid', () => ({
  v7: jest.fn(() => 'uuid-v7'),
}));

// @slack/common barrel kéo theo "nanoid" (ESM-only) qua string.util.ts —
// jest không transform được, mock thẳng theo đúng convention đã dùng ở
// apps/calendar/src/services/attendance.service.spec.ts (và các spec khác).
jest.mock('nanoid', () => ({
  customAlphabet: jest.fn(() => jest.fn(() => 'mock-id')),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthEntity } from './entity/auth.entity';
import { SessionEntity } from './entity/session.entity';
import { VerificationEntity } from './entity/verification.entity';
import { UserDeviceEntity } from './entity/user-device.entity';
import { JwtService } from '@nestjs/jwt';
import { AuthCacheService, PresenceCacheService } from '@slack/cached';
import { RpcException } from '@nestjs/microservices';
import {
  NAME_SERVICE_TCP,
  USER_MESSAGE_PATTERNS,
  NOTIFICATION_MESSAGE_PATTERNS,
  TWO_FA_MESSAGE_PATTERNS,
} from '@slack/constants';
import { Repository } from 'typeorm';
import { of, throwError } from 'rxjs';
import * as argon2 from 'argon2';
import { v7 } from 'uuid';
import { ITokenResponse, ITwoFactorResponse } from './types/auth.response';
import { EJobName, EQueueName, QueueService } from '@slack/queue';
import { DataSource } from 'typeorm';

jest.mock('argon2');

describe('AuthService', () => {
  let service: AuthService;
  let authRepository: Repository<AuthEntity>;
  let sessionRepository: Repository<SessionEntity>;
  let verificationRepository: Repository<VerificationEntity>;
  let userDeviceRepository: Repository<UserDeviceEntity>;
  let userClient: any;
  let notificationClient: any;
  let jwtService: JwtService;
  let authCacheService: AuthCacheService;
  let presenceCacheService: PresenceCacheService;
  let dataSource: DataSource;
  let queueService: QueueService;

  const mockRepository = () => ({
    findOneBy: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  });

  const mockClientProxy = () => ({
    send: jest.fn(),
    emit: jest.fn(),
  });

  const mockEntityManager = {
    save: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    findOne: jest.fn(),
    findOneBy: jest.fn(),
    remove: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn((cb) => cb(mockEntityManager)),
  };

  const mockQueueService = {
    addJob: jest.fn().mockResolvedValue(undefined),
  };

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
          provide: getRepositoryToken(UserDeviceEntity),
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
            cacheRotationResult: jest.fn(),
            getRotationResult: jest.fn().mockResolvedValue(null),
          },
        },
        {
          provide: PresenceCacheService,
          useValue: {
            removeStatus: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: QueueService,
          useValue: mockQueueService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    dataSource = module.get(DataSource);
    queueService = module.get(QueueService);
    authRepository = module.get(getRepositoryToken(AuthEntity));
    sessionRepository = module.get(getRepositoryToken(SessionEntity));
    verificationRepository = module.get(getRepositoryToken(VerificationEntity));
    userDeviceRepository = module.get(getRepositoryToken(UserDeviceEntity));
    userClient = module.get(NAME_SERVICE_TCP.USER_SERVICE);
    notificationClient = module.get(NAME_SERVICE_TCP.NOTIFICATION_SERVICE);
    jwtService = module.get(JwtService);
    authCacheService = module.get(AuthCacheService);
    presenceCacheService = module.get(PresenceCacheService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const registerDto = { email: 'test@example.com', password: 'password123' };

    // NOTE: register() creates the AuthEntity/VerificationEntity through the
    // transactional `manager` (mockEntityManager), not the injected repos —
    // and sends the verification email via queueService.addJob (fire-and-forget),
    // not notificationClient.emit.

    it('should register successfully', async () => {
      (authRepository.findOneBy as jest.Mock).mockResolvedValue(null);
      (argon2.hash as jest.Mock).mockResolvedValue('hashedPassword');
      userClient.send.mockReturnValue(of({ id: 'user-id' }));
      (v7 as jest.Mock).mockReturnValue('verification-code');
      (mockEntityManager.create as jest.Mock).mockImplementation(
        (_entity, data) => data,
      );
      (mockEntityManager.save as jest.Mock).mockImplementation(
        async (data) => data,
      );

      const result = await service.register(registerDto);

      expect(result).toBe(
        'We have sent you a verification email. Please check your inbox to verify your account.',
      );
      expect(mockEntityManager.save).toHaveBeenCalled();
      expect(queueService.addJob).toHaveBeenCalledWith(
        EQueueName.EMAIL_QUEUE,
        EJobName.SEND_VERIFICATION_EMAIL,
        expect.objectContaining({
          email: 'test@example.com',
          code: 'verification-code',
        }),
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
      (argon2.hash as jest.Mock).mockResolvedValue('hashedPassword');
      userClient.send.mockReturnValue(
        throwError(() => new Error('Creation failed')),
      );

      // The original RPC error message is intentionally swallowed and replaced
      // with a generic one (see auth.service.ts register() catch block).
      await expect(service.register(registerDto)).rejects.toThrow(
        'Failed to create user service record',
      );
    });
  });

  describe('verifyEmail', () => {
    const verifyDto = { code: 'valid-code' };

    // NOTE: verifyEmail() looks up both entities through the transactional
    // `manager` (mockEntityManager), not verificationRepository/authRepository
    // directly, and pushes the status update via userClient.send (RPC call),
    // not .emit (fire-and-forget).

    it('should verify email successfully', async () => {
      const verification = {
        userId: 'user-id',
        expiresAt: new Date(Date.now() + 10000),
        isUsed: false,
      };
      const auth = { userId: 'user-id' };
      (mockEntityManager.findOne as jest.Mock).mockImplementation(
        (entityClass) => {
          if (entityClass === VerificationEntity)
            return Promise.resolve(verification);
          if (entityClass === AuthEntity) return Promise.resolve(auth);
          return Promise.resolve(null);
        },
      );
      userClient.send.mockReturnValue(of({}));

      const result = await service.verifyEmail(verifyDto);

      expect(result).toBe('Email successfully verified.');
      expect(verification.isUsed).toBe(true);
      expect(mockEntityManager.save).toHaveBeenCalledWith(verification);
      expect(userClient.send).toHaveBeenCalledWith(
        USER_MESSAGE_PATTERNS.CHANGE_USER_STATUS,
        {
          id: 'user-id',
          status: 'active',
        },
      );
    });

    it('should throw error if verification code not found', async () => {
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.verifyEmail(verifyDto)).rejects.toThrow(
        RpcException,
      );
    });

    it('should throw error if verification code expired', async () => {
      const verification = { expiresAt: new Date(Date.now() - 10000) };
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue(
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

    // NOTE: login() fetches the user via USER_MESSAGE_PATTERNS.GET_USER_BY_EMAIL
    // and reads `user.isTwoFactorEnabled` directly off that response — there is
    // no separate IS_USER_ENABLE_TWO_FACTOR RPC call.

    it('should login successfully', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue(auth);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      userClient.send.mockReturnValue(
        of({
          id: 'user-id',
          email: 'test@example.com',
          status: 'active',
          isTwoFactorEnabled: false,
        }),
      );

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

    it('should return tempToken when 2FA is enabled', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue(auth);
      (argon2.verify as jest.Mock).mockResolvedValue(true);
      userClient.send.mockReturnValue(
        of({
          id: 'user-id',
          email: 'test@example.com',
          status: 'active',
          isTwoFactorEnabled: true,
        }),
      );

      (jwtService.signAsync as jest.Mock).mockResolvedValue('temp-token');

      const result = await service.login(loginDto);

      expect(result).toEqual({
        isEnableTwoFactor: true,
        tempToken: 'temp-token',
      });
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ state: '2FA_OTP_IS_BEING_VERIFIED' }),
        expect.any(Object),
      );
    });

    it('should throw error if auth not found', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toThrow(RpcException);
    });

    it('should throw error if password invalid', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue(auth);
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      await expect(service.login(loginDto)).rejects.toThrow(RpcException);
    });
  });

  describe('verifyOtpFromAuthenticator', () => {
    const tempToken = 'temp-token';
    const otp = '123456';
    const userId = 'user-id';

    it('should verify OTP and return tokens successfully', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: userId,
        state: '2FA_OTP_IS_BEING_VERIFIED',
      });
      userClient.send.mockImplementation((pattern: string) => {
        if (pattern === TWO_FA_MESSAGE_PATTERNS.VERIFY_OTP) {
          return of(true);
        }
        if (pattern === USER_MESSAGE_PATTERNS.GET_USER_BY_ID) {
          return of({
            id: userId,
            email: 'test@example.com',
            status: 'active',
          });
        }
        return of(null);
      });

      (authCacheService.getUserTokenVersion as jest.Mock).mockResolvedValue(1);
      (jwtService.signAsync as jest.Mock).mockResolvedValue('new-token');
      (sessionRepository.create as jest.Mock).mockReturnValue({});

      const result = await service.verifyOtpFromAuthenticator(tempToken, otp);

      expect(result).toEqual({
        accessToken: 'new-token',
        refreshToken: 'new-token',
        type: 'Bearer',
      });
      expect(userClient.send).toHaveBeenCalledWith(
        TWO_FA_MESSAGE_PATTERNS.VERIFY_OTP,
        { userId, otp },
      );
    });

    it('should throw error if user not found after OTP verification', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: userId,
        state: '2FA_OTP_IS_BEING_VERIFIED',
      });
      userClient.send.mockImplementation((pattern: string) => {
        if (pattern === TWO_FA_MESSAGE_PATTERNS.VERIFY_OTP) {
          return of(true);
        }
        if (pattern === USER_MESSAGE_PATTERNS.GET_USER_BY_ID) {
          return of(null);
        }
        return of(null);
      });

      await expect(
        service.verifyOtpFromAuthenticator(tempToken, otp),
      ).rejects.toThrow(RpcException);
    });
  });

  describe('refresh', () => {
    const refreshDto = { refreshToken: 'valid-refresh-token' };
    const baseSession = () => ({
      userId: 'user-id',
      expiresAt: new Date(Date.now() + 10000),
      isRevoked: false,
    });

    // NOTE: refresh() reads/writes the session through the transactional
    // `manager` (mockEntityManager), not the injected `sessionRepository` —
    // only the reuse-detected branch below falls back to `sessionRepository`.

    it('should refresh tokens successfully', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({});
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue(baseSession());
      (jwtService.decode as jest.Mock).mockReturnValue({
        email: 'test@example.com',
      });
      (authCacheService.getUserTokenVersion as jest.Mock).mockResolvedValue(1);
      (jwtService.signAsync as jest.Mock).mockResolvedValue('new-token');
      (mockEntityManager.create as jest.Mock).mockReturnValue({});

      const result = await service.refresh(refreshDto);

      expect(result).toEqual({
        accessToken: 'new-token',
        refreshToken: 'new-token',
        type: 'Bearer',
      });
      expect(mockEntityManager.save).toHaveBeenCalled();
      expect(authCacheService.cacheRotationResult).toHaveBeenCalledWith(
        'valid-refresh-token',
        { accessToken: 'new-token', refreshToken: 'new-token', type: 'Bearer' },
      );
    });

    it('should throw error if token verification fails', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(new Error());

      await expect(service.refresh(refreshDto)).rejects.toThrow(RpcException);
    });

    it('should throw error if session does not exist', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({});
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.refresh(refreshDto)).rejects.toThrow(RpcException);
    });

    it('should throw error if session is expired', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({});
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue({
        ...baseSession(),
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh(refreshDto)).rejects.toThrow(RpcException);
    });

    it('returns the previously-issued tokens when a rotated-away token is reused inside the grace window', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({});
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue({
        ...baseSession(),
        isRevoked: true,
      });
      (authCacheService.getRotationResult as jest.Mock).mockResolvedValue({
        accessToken: 'already-issued-access',
        refreshToken: 'already-issued-refresh',
      });

      const result = await service.refresh(refreshDto);

      expect(result).toEqual({
        accessToken: 'already-issued-access',
        refreshToken: 'already-issued-refresh',
        type: 'Bearer',
      });
      expect(sessionRepository.update).not.toHaveBeenCalled();
      expect(authCacheService.bumpUserTokenVersion).not.toHaveBeenCalled();
    });

    it('revokes every session for the user when a rotated-away token is reused outside the grace window', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({});
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue({
        ...baseSession(),
        isRevoked: true,
      });
      (authCacheService.getRotationResult as jest.Mock).mockResolvedValue(null);

      await expect(service.refresh(refreshDto)).rejects.toThrow(RpcException);

      expect(sessionRepository.update).toHaveBeenCalledWith(
        { userId: 'user-id', isRevoked: false },
        { isRevoked: true },
      );
      expect(authCacheService.bumpUserTokenVersion).toHaveBeenCalledWith(
        'user-id',
      );
    });
  });

  describe('loginGoogle', () => {
    const googleDto = { email: 'google@example.com' };
    const metadata = { ipAddress: '127.0.0.1' };

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
      (sessionRepository.create as jest.Mock).mockReturnValue({});

      const result = await service.loginGoogle(googleDto, metadata as any);

      expect((result as ITokenResponse).accessToken).toBe('google-token');
      expect(authRepository.create).toHaveBeenCalled();
      expect(sessionRepository.save).toHaveBeenCalled();
    });

    it('should login with google for existing user', async () => {
      const auth = { userId: 'existing-google-user-id' };
      (authRepository.findOne as jest.Mock).mockResolvedValue(auth);
      userClient.send.mockReturnValue(
        of({ id: auth.userId, isTwoFactorEnabled: false }),
      );
      (authCacheService.getUserTokenVersion as jest.Mock).mockResolvedValue(1);
      (jwtService.signAsync as jest.Mock).mockResolvedValue('google-token');
      (sessionRepository.create as jest.Mock).mockReturnValue({});

      const result = await service.loginGoogle(googleDto, metadata as any);

      expect((result as ITokenResponse).accessToken).toBe('google-token');
      expect(authRepository.create).not.toHaveBeenCalled();
      expect(sessionRepository.save).toHaveBeenCalled();
    });

    it('should return tempToken if 2FA is enabled', async () => {
      const auth = { userId: '2fa-user-id' };
      (authRepository.findOne as jest.Mock).mockResolvedValue(auth);
      userClient.send.mockReturnValue(
        of({ id: auth.userId, isTwoFactorEnabled: true }),
      );
      (jwtService.signAsync as jest.Mock).mockResolvedValue('temp-token');

      const result = (await service.loginGoogle(
        googleDto,
      )) as ITwoFactorResponse;

      expect(result.isEnableTwoFactor).toBe(true);
      expect(result.tempToken).toBe('temp-token');
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

    // NOTE: logout() revokes the session via a single sessionRepository.update()
    // call (no findOne) and checks `result.affected` to decide success.

    it('should logout successfully', async () => {
      (sessionRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({
        sub: 'user-id',
      });

      const result = await service.logout(logoutDto);

      expect(result).toBe('Logout successfully.');
      expect(sessionRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({ isRevoked: false }),
        { isRevoked: true },
      );
      expect(authCacheService.blacklistToken).toHaveBeenCalled();
    });

    it('should throw error if session not found during logout', async () => {
      (sessionRepository.update as jest.Mock).mockResolvedValue({
        affected: 0,
      });

      await expect(service.logout(logoutDto)).rejects.toThrow(RpcException);
    });

    it('should blacklist token during logout', async () => {
      (sessionRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.logout(logoutDto);

      expect(authCacheService.blacklistToken).toHaveBeenCalledWith(
        'at',
        expect.any(Number),
      );
    });
  });

  describe('logoutAll', () => {
    const accessToken = 'valid-at';
    const userId = 'user-id';

    it('should logout all sessions successfully', async () => {
      (jwtService.verifyAsync as jest.Mock).mockResolvedValue({ sub: userId });
      (sessionRepository.update as jest.Mock).mockResolvedValue({ affected: 1 });

      const result = await service.logoutAll({ accessToken });

      expect(result).toBe('Logout all successfully.');
      expect(sessionRepository.update).toHaveBeenCalledWith(
        { userId, isRevoked: false },
        { isRevoked: true },
      );
      expect(authCacheService.bumpUserTokenVersion).toHaveBeenCalledWith(
        userId,
      );
    });

    it('should throw error if accessToken is missing', async () => {
      await expect(service.logoutAll({ accessToken: '' })).rejects.toThrow(
        RpcException,
      );
    });

    it('should throw error if token verification fails', async () => {
      (jwtService.verifyAsync as jest.Mock).mockRejectedValue(
        new Error('Invalid token'),
      );

      await expect(service.logoutAll({ accessToken })).rejects.toThrow(
        RpcException,
      );
    });
  });

  describe('forgotPassword', () => {
    const email = 'test@example.com';

    // NOTE: forgotPassword() queues the reset email via queueService.addJob
    // (fire-and-forget, .catch()'d internally) — not notificationClient.emit —
    // so a queue push failure can no longer make the request itself reject.

    it('should create verification and queue the reset email', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue({
        userId: 'user-id',
      });
      (verificationRepository.create as jest.Mock).mockReturnValue({
        code: 'code',
      });

      const result = await service.forgotPassword({ email });

      expect(result).toBe('Check your email to verify your email.');
      expect(verificationRepository.save).toHaveBeenCalled();
      expect(queueService.addJob).toHaveBeenCalledWith(
        EQueueName.EMAIL_QUEUE,
        EJobName.SEND_PASSWORD_RESET_EMAIL,
        expect.objectContaining({ email, code: 'code' }),
      );
    });

    it('should throw error if account not found', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.forgotPassword({ email })).rejects.toThrow(
        RpcException,
      );
    });

    it('should still succeed even if pushing the reset email job fails (fire-and-forget)', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue({
        userId: 'user-id',
      });
      (verificationRepository.create as jest.Mock).mockReturnValue({
        code: 'code',
      });
      (queueService.addJob as jest.Mock).mockRejectedValueOnce(
        new Error('Queue push failed'),
      );

      await expect(service.forgotPassword({ email })).resolves.toBe(
        'Check your email to verify your email.',
      );
    });
  });

  describe('verifyResetPassword', () => {
    const code = 'valid-code';

    // NOTE: verifyResetPassword() only validates the code + looks up the user —
    // it does NOT mark the verification as used or persist anything; that
    // happens later, inside resetPassword()'s own transaction.

    it('should verify reset password successfully', async () => {
      const verification = { userId: 'user-id', isUsed: false };
      (verificationRepository.findOne as jest.Mock).mockResolvedValue(
        verification,
      );
      userClient.send.mockReturnValue(of({ id: 'user-id' }));

      const result = await service.verifyResetPassword({ code });

      expect(result).toBe('Verify reset password successfully.');
      expect(verificationRepository.save).not.toHaveBeenCalled();
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

    // NOTE: step 1 (find auth by email) still goes through authRepository
    // directly, but the verification lookup + password update + marking the
    // code used all happen through the transactional `manager`. The password
    // is written via a targeted manager.update() call — the local `auth`
    // object itself is never mutated.

    it('should reset password successfully', async () => {
      const auth = { id: 'auth-id', password: 'old' };
      const verification = { isUsed: false };
      (authRepository.findOne as jest.Mock).mockResolvedValue(auth);
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue(verification);
      (argon2.hash as jest.Mock).mockResolvedValue('new-hashed-password');

      const result = await service.resetPassword(resetDto);

      expect(result).toBe('Reset password successfully.');
      expect(verification.isUsed).toBe(true);
      expect(mockEntityManager.update).toHaveBeenCalledWith(
        AuthEntity,
        { id: 'auth-id' },
        { password: 'new-hashed-password' },
      );
      expect(mockEntityManager.save).toHaveBeenCalledWith(verification);
    });

    it('should throw error if account not found during reset', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.resetPassword(resetDto)).rejects.toThrow(
        RpcException,
      );
    });

    it('should throw error if code is invalid/expired during reset', async () => {
      (authRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'auth-id',
      });
      (mockEntityManager.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.resetPassword(resetDto)).rejects.toThrow(
        RpcException,
      );
    });
  });
});
