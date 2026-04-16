import { Test, TestingModule } from '@nestjs/testing';
import { UserService } from './user.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserEntity, UserStatus } from './entity/user.entity';
import { Repository } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { USER_ERROR } from '@slack/constants/errors/user.error';

describe('UserService', () => {
  let service: UserService;
  let repository: Repository<UserEntity>;

  const mockUserRepository = () => ({
    create: jest.fn(),
    save: jest.fn(),
    findOneBy: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(UserEntity),
          useFactory: mockUserRepository,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
    repository = module.get(getRepositoryToken(UserEntity));
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
        systemRole: 'user',
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

    it('should throw BadRequestException if user not found', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(null);

      await expect(service.updateStatus(userId, status)).rejects.toThrow(
        new BadRequestException(USER_ERROR.USER_NOT_FOUND),
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

    it('should throw BadRequestException if user not found', async () => {
      (repository.findOneBy as jest.Mock).mockResolvedValue(null);

      await expect(service.getUserById(userId)).rejects.toThrow(
        new BadRequestException(USER_ERROR.USER_NOT_FOUND),
      );
    });

    it('should return mapped response (including all fields)', async () => {
      const user = {
        id: userId,
        firstName: 'A',
        lastName: 'B',
        email: 'e',
        createdAt: new Date(),
        systemRole: 'r',
        status: 's',
      };
      (repository.findOneBy as jest.Mock).mockResolvedValue(user);

      const result = await service.getUserById(userId);

      expect(result).toEqual(user);
    });
  });
});
