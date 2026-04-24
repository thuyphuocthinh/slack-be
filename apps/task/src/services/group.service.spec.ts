import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { GroupService } from './group.service';
import { TaskGroupEntity } from '../entity/task_group.entity';
import { TaskCommonService } from './task-common.service';
import { DataSource, Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { TASK_ERROR } from '@slack/constants';

describe('GroupService', () => {
  let service: GroupService;
  let groupRepo: Repository<TaskGroupEntity>;
  let commonService: TaskCommonService;

  const mockManager = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn().mockImplementation((cb) => cb(mockManager)),
  };

  const mockCommonService = {
    checkBoardMembership: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GroupService,
        {
          provide: getRepositoryToken(TaskGroupEntity),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: TaskCommonService,
          useValue: mockCommonService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<GroupService>(GroupService);
    groupRepo = module.get<Repository<TaskGroupEntity>>(
      getRepositoryToken(TaskGroupEntity),
    );
    commonService = module.get<TaskCommonService>(TaskCommonService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addGroupToBoard', () => {
    it('should create group successfully', async () => {
      const dto = { boardId: 'b1', name: 'G1' };
      mockManager.create.mockReturnValue({ id: 'g1', ...dto });
      mockManager.save.mockResolvedValue({ id: 'g1', ...dto });

      const result = await service.addGroupToBoard(dto as any, 'u1');

      expect(commonService.checkBoardMembership).toHaveBeenCalledWith(
        'b1',
        'u1',
        mockManager,
      );
      expect(result.id).toBe('g1');
    });
  });

  describe('updateGroupInfo', () => {
    it('should update group info', async () => {
      const group = { id: 'g1', boardId: 'b1', name: 'Old' };
      mockManager.findOne.mockResolvedValue(group);
      mockManager.save.mockResolvedValue({ ...group, name: 'New' });

      const result = await service.updateGroupInfo(
        'g1',
        { name: 'New' } as any,
        'u1',
      );

      expect(result.name).toBe('New');
    });

    it('should throw if group not found', async () => {
      mockManager.findOne.mockResolvedValue(null);
      await expect(
        service.updateGroupInfo('g1', {} as any, 'u1'),
      ).rejects.toThrow(new RpcException(TASK_ERROR.GROUP_NOT_FOUND));
    });
  });

  describe('getGroupsByBoardId', () => {
    it('should return groups', async () => {
      (groupRepo.find as jest.Mock).mockResolvedValue([{ id: 'g1' }]);
      const result = await service.getGroupsByBoardId('b1', 'u1');
      expect(result).toHaveLength(1);
    });
  });
});
