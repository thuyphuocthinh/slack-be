import { Test, TestingModule } from '@nestjs/testing';
import { TwoFactorService } from './services/two_fa.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TwoFactorEntity } from './entity/two_factor.entity';
import { Repository } from 'typeorm';
import * as speakeasy from 'speakeasy';
import { RpcException } from '@nestjs/microservices';
import { TWO_FACTOR_ERROR } from '@slack/constants/errors/two_factor.error';

jest.mock('speakeasy');

describe('TwoFactorService', () => {
  let service: TwoFactorService;
  let repository: Repository<TwoFactorEntity>;

  const mockTwoFactorRepository = () => ({
    findOneBy: jest.fn(),
    update: jest.fn(),
    save: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwoFactorService,
        {
          provide: getRepositoryToken(TwoFactorEntity),
          useFactory: mockTwoFactorRepository,
        },
      ],
    }).compile();

    service = module.get<TwoFactorService>(TwoFactorService);
    repository = module.get(getRepositoryToken(TwoFactorEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateSecret', () => {
    const userId = 'user-id';
    const mockSecret = {
      base32: 'ABCDEF',
      otpauth_url: 'otpauth://...',
    };

    beforeEach(() => {
      (speakeasy.generateSecret as jest.Mock).mockReturnValue(mockSecret);
    });

    it('should generate a new secret successfully if not exists', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(null);
      (repository.save as jest.Mock).mockResolvedValue({});

      const result = await service.generateSecret(userId);

      expect(result).toBe(mockSecret.otpauth_url);
      expect(repository.save).toHaveBeenCalledWith({
        userId,
        secret: mockSecret.base32,
        enabled: false,
      });
    });

    it('should update secret if exists but not enabled', async () => {
      const existing = { id: 'tf-id', userId, enabled: false };
      (repository.findOneBy as jest.Mock).mockResolvedValue(existing);

      const result = await service.generateSecret(userId);

      expect(result).toBe(mockSecret.otpauth_url);
      expect(repository.update).toHaveBeenCalledWith(existing.id, {
        secret: mockSecret.base32,
        enabled: false,
      });
    });

    it('should throw RpcException if already enabled', async () => {
      const existing = { id: 'tf-id', userId, enabled: true };
      (repository.findOneBy as jest.Mock).mockResolvedValue(existing);

      await expect(service.generateSecret(userId)).rejects.toThrow(
        new RpcException(TWO_FACTOR_ERROR.TWO_FACTOR_ALREADY_ENABLED),
      );
    });
  });

  describe('verifyOTP', () => {
    const userId = 'user-id';
    const otp = '123456';
    const twoFactor = { id: 'tf-id', userId, secret: 'SECRET' };

    it('should verify OTP and enable 2FA successfully', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(twoFactor);
      (speakeasy.totp.verify as jest.Mock).mockReturnValue(true);

      const result = await service.verifyOTP(userId, otp);

      expect(result).toBe(true);
      expect(speakeasy.totp.verify).toHaveBeenCalledWith({
        secret: twoFactor.secret,
        encoding: 'base32',
        token: otp,
      });
      expect(repository.update).toHaveBeenCalledWith(twoFactor.id, {
        enabled: true,
      });
    });

    it('should throw RpcException if record not found', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(null);

      await expect(service.verifyOTP(userId, otp)).rejects.toThrow(
        new RpcException(TWO_FACTOR_ERROR.TWO_FACTOR_NOT_FOUND),
      );
    });

    it('should throw RpcException if OTP is invalid', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(twoFactor);
      (speakeasy.totp.verify as jest.Mock).mockReturnValue(false);

      await expect(service.verifyOTP(userId, otp)).rejects.toThrow(
        new RpcException(TWO_FACTOR_ERROR.TWO_FACTOR_INVALID_OTP),
      );
    });
  });

  describe('toggleTwoFactor', () => {
    const userId = 'user-id';
    const twoFactor = { id: 'tf-id', userId, enabled: true } as TwoFactorEntity;

    it('should toggle enabled status successfully', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(twoFactor);

      await service.toggleTwoFactor(userId);

      expect(twoFactor.enabled).toBe(false);
      expect(repository.save).toHaveBeenCalledWith(twoFactor);
    });

    it('should throw RpcException if record not found', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(null);

      await expect(service.toggleTwoFactor(userId)).rejects.toThrow(
        new RpcException(TWO_FACTOR_ERROR.TWO_FACTOR_NOT_FOUND),
      );
    });
  });
});
