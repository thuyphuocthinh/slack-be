import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';

describe('UserController', () => {
  let controller: UserController;
  let userService: UserService;

  const mockUserService = {
    getBatchUserByIds: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        {
          provide: UserService,
          useValue: mockUserService,
        },
      ],
    }).compile();

    controller = module.get<UserController>(UserController);
    userService = module.get<UserService>(UserService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getProfiles', () => {
    it('should return empty array if no userIds provided', async () => {
      const result = await controller.getProfiles('');
      expect(result).toEqual([]);
      expect(userService.getBatchUserByIds).not.toHaveBeenCalled();
    });

    it('should call getBatchUserByIds and return data', async () => {
      const mockUsers = [
        { id: '1', email: 'test1@example.com' },
        { id: '2', email: 'test2@example.com' },
      ];
      mockUserService.getBatchUserByIds.mockResolvedValueOnce(mockUsers);

      const result = await controller.getProfiles('1,2');
      
      expect(userService.getBatchUserByIds).toHaveBeenCalledWith(['1', '2']);
      expect(result).toEqual(mockUsers);
    });

    it('should ignore empty ids', async () => {
      const mockUsers = [{ id: '1', email: 'test1@example.com' }];
      mockUserService.getBatchUserByIds.mockResolvedValueOnce(mockUsers);

      const result = await controller.getProfiles('1,, ');
      
      expect(userService.getBatchUserByIds).toHaveBeenCalledWith(['1']);
      expect(result).toEqual(mockUsers);
    });
  });
});
