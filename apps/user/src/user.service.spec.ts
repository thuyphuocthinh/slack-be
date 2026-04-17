import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './services/user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserEntity, UserStatus, SystemRole } from './entity/user.entity';
import { Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { USER_ERROR } from '@slack/constants/errors/user.error';
import { TwoFactorEntity } from './entity/two_factor.entity';
import { NAME_SERVICE_TCP } from '@slack/constants';
import { of } from 'rxjs';

describe('UserService', () => {
  let service: UserService;
  let repository: Repository<UserEntity>;
  let twoFactorRepository: Repository<TwoFactorEntity>;
  let authClient: any;

  const mockUserRepository = () => ({
    create: jest.fn(),
    save: jest.fn(),
    findOneBy: jest.fn(),
  });

  const mockTwoFactorRepository = () => ({
    findOneBy: jest.fn(),
  });

  const mockAuthClient = () => ({
    send: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(UserEntity),
          useFactory: mockUserRepository,
        },
        {
          provide: getRepositoryToken(TwoFactorEntity),
          useFactory: mockTwoFactorRepository,
        },
        {
          provide: NAME_SERVICE_TCP.AUTH_SERVICE,
          useFactory: mockAuthClient,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    repository = module.get(getRepositoryToken(UserEntity));
    twoFactorRepository = module.get(getRepositoryToken(TwoFactorEntity));
    authClient = module.get(NAME_SERVICE_TCP.AUTH_SERVICE);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createUser', () => {
    const createUserDto = { email: 'test@example.com' };
    const user = { id: 'user-id', ...createUserDto, status: UserStatus.ACTIVE };

    it('should create a user successfully', async () => {
      (repository.create as jest.Mock).mockReturnValue(user);
      (repository.save as jest.Mock).mockResolvedValue(user);

      const result = await service.createUser(createUserDto);

      expect(result).toEqual(
        expect.objectContaining({
          id: 'user-id',
          email: 'test@example.com',
        }),
      );
      expect(repository.create).toHaveBeenCalledWith(createUserDto);
      expect(repository.save).toHaveBeenCalled();
    });

    it('should throw error if repository.save fails', async () => {
      (repository.create as jest.Mock).mockReturnValue(user);
      (repository.save as jest.Mock).mockRejectedValue(
        new Error('Save failed'),
      );

      await expect(service.createUser(createUserDto)).rejects.toThrow(
        'Save failed',
      );
    });

    it('should map user entity to response correctly', async () => {
      const fullUser = {
        ...user,
        firstName: 'John',
        lastName: 'Doe',
        createdAt: new Date(),
        systemRole: SystemRole.USER,
      };
      (repository.create as jest.Mock).mockReturnValue(fullUser);
      (repository.save as jest.Mock).mockResolvedValue(fullUser);

      const result = await service.createUser(createUserDto);

      expect(result).toEqual({
        id: fullUser.id,
        firstName: fullUser.firstName,
        lastName: fullUser.lastName,
        email: fullUser.email,
        createdAt: fullUser.createdAt,
        systemRole: fullUser.systemRole,
        status: fullUser.status,
      });
    });
  });

  describe('updateStatus', () => {
    const userId = 'user-id';
    const status = UserStatus.ACTIVE;

    it('should update status successfully', async () => {
      const user = { id: userId, status: UserStatus.INACTIVE };
      (repository.findOneBy as jest.Mock).mockResolvedValue(user);

      await service.updateStatus(userId, status);

      expect(user.status).toBe(status);
      expect(repository.save).toHaveBeenCalledWith(user);
    });

    it('should throw RpcException if user not found', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(null);

      await expect(service.updateStatus(userId, status)).rejects.toThrow(
        new RpcException(USER_ERROR.USER_NOT_FOUND),
      );
    });

    it('should throw error if repository.save fails in updateStatus', async () => {
      const user = { id: userId };
      (repository.findOneBy as jest.Mock).mockResolvedValue(user);
      (repository.save as jest.Mock).mockRejectedValue(
        new Error('Save failed'),
      );

      await expect(service.updateStatus(userId, status)).rejects.toThrow(
        'Save failed',
      );
    });
  });

  describe('getUserById', () => {
    const userId = 'user-id';

    it('should return user response if found', async () => {
      const user = { id: userId, email: 'test@example.com' };
      (repository.findOneBy as jest.Mock).mockResolvedValue(user);

      const result = await service.getUserById(userId);

      expect(result.id).toBe(userId);
      expect(repository.findOneBy).toHaveBeenCalledWith({ id: userId });
    });

    it('should throw RpcException if user not found', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(null);

      await expect(service.getUserById(userId)).rejects.toThrow(
        new RpcException(USER_ERROR.USER_NOT_FOUND),
      );
    });

    it('should return mapped response (including all fields)', async () => {
      const createdAt = new Date();
      const user = {
        id: userId,
        firstName: 'John',
        lastName: 'Doe',
        email: 'test@example.com',
        avatarUrl: 'url',
        createdAt,
        systemRole: SystemRole.USER,
        status: UserStatus.ACTIVE,
      };
      (repository.findOneBy as jest.Mock).mockResolvedValue(user);

      const result = await service.getUserById(userId);

      expect(result).toEqual({
        id: userId,
        firstName: 'John',
        lastName: 'Doe',
        email: 'test@example.com',
        avatarUrl: 'url',
        createdAt,
        systemRole: SystemRole.USER,
        status: UserStatus.ACTIVE,
      });
    });
  });

  describe('getUserByEmail', () => {
    const email = 'test@example.com';

    it('should return user response if found', async () => {
      const user = { id: 'user-id', email };
      (repository.findOneBy as jest.Mock).mockResolvedValue(user);

      const result = await service.getUserByEmail(email);

      expect(result.email).toBe(email);
      expect(repository.findOneBy).toHaveBeenCalledWith({ email });
    });

    it('should throw RpcException if user not found', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(null);

      await expect(service.getUserByEmail(email)).rejects.toThrow(
        new RpcException(USER_ERROR.USER_NOT_FOUND),
      );
    });
  });

  describe('changeAvatar', () => {
    const userId = 'user-id';
    const avatarUrl = 'new-avatar-url';

    it('should change avatar successfully', async () => {
      const user = { id: userId, avatarUrl: 'old-url' };
      (repository.findOneBy as jest.Mock).mockResolvedValue(user);

      const result = await service.changeAvatar(userId, avatarUrl);

      expect(user.avatarUrl).toBe(avatarUrl);
      expect(repository.save).toHaveBeenCalledWith(user);
      expect(result.avatarUrl).toBe(avatarUrl);
    });

    it('should throw RpcException if user not found', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(null);

      await expect(service.changeAvatar(userId, avatarUrl)).rejects.toThrow(
        new RpcException(USER_ERROR.USER_NOT_FOUND),
      );
    });
  });

  describe('updateInfo', () => {
    const userId = 'user-id';
    const updateData = { userId, firstName: 'New', lastName: 'Name' };

    it('should update info successfully', async () => {
      const user = { id: userId, firstName: 'Old', lastName: 'Old' };
      (repository.findOneBy as jest.Mock).mockResolvedValue(user);

      const result = await service.updateInfo(userId, updateData);

      expect(user.firstName).toBe(updateData.firstName);
      expect(user.lastName).toBe(updateData.lastName);
      expect(repository.save).toHaveBeenCalledWith(user);
      expect(result.firstName).toBe(updateData.firstName);
    });

    it('should throw RpcException if user not found', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(null);

      await expect(service.updateInfo(userId, updateData)).rejects.toThrow(
        new RpcException(USER_ERROR.USER_NOT_FOUND),
      );
    });
  });

  describe('changePassword', () => {
    const userId = 'user-id';
    const changePasswordDto = {
      userId,
      oldPassword: 'old-password',
      newPassword: 'new-password',
    };
    const user = { id: userId, email: 'test@example.com' };

    it('should change password successfully', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(user);
      (authClient.send as jest.Mock)
        .mockReturnValueOnce(of(true)) // mock firstValueFrom for VERIFY_PASSWORD (old)
        .mockReturnValueOnce(of(false)) // mock firstValueFrom for VERIFY_PASSWORD (new)
        .mockReturnValueOnce(of(true)); // mock firstValueFrom for CHANGE_PASSWORD

      const result = await service.changePassword(userId, changePasswordDto);

      expect(result).toBe('Change password successfully');
      expect(authClient.send).toHaveBeenCalledTimes(3);
    });

    it('should throw RpcException if user not found', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(null);

      await expect(
        service.changePassword(userId, changePasswordDto),
      ).rejects.toThrow(new RpcException(USER_ERROR.USER_NOT_FOUND));
    });

    it('should throw RpcException if old password does not match', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(user);
      (authClient.send as jest.Mock).mockReturnValueOnce(of(false));

      await expect(
        service.changePassword(userId, changePasswordDto),
      ).rejects.toThrow(new RpcException(USER_ERROR.OLD_PASSWORD_NOT_MATCH));
    });

    it('should throw RpcException if new password is same as old', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(user);
      (authClient.send as jest.Mock)
        .mockReturnValueOnce(of(true))
        .mockReturnValueOnce(of(true));

      await expect(
        service.changePassword(userId, changePasswordDto),
      ).rejects.toThrow(new RpcException(USER_ERROR.INVALID_PASSWORD));
    });
  });

  describe('isEnableTwoFactor', () => {
    const userId = 'user-id';

    it('should return true if enabled', async () => {
      (twoFactorRepository.findOneBy as jest.Mock).mockResolvedValue({
        enabled: true,
      });

      const result = await service.isEnableTwoFactor(userId);

      expect(result).toBe(true);
      expect(twoFactorRepository.findOneBy).toHaveBeenCalledWith({ userId });
    });

    it('should return false if not enabled', async () => {
      (twoFactorRepository.findOneBy as jest.Mock).mockResolvedValue({
        enabled: false,
      });

      const result = await service.isEnableTwoFactor(userId);

      expect(result).toBe(false);
    });

    it('should return false if record not found', async () => {
      (twoFactorRepository.findOneBy as jest.Mock).mockResolvedValue(null);

      const result = await service.isEnableTwoFactor(userId);

      expect(result).toBe(false);
    });
  });
});
