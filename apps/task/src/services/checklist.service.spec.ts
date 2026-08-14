import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChecklistService } from './checklist.service';
import { ChecklistEntity } from '../entity/checklist.entity';
import { ChecklistItemEntity } from '../entity/checklist_item.entity';
import { TaskEntity } from '../entity/task.entity';
import { TaskCommonService } from './task-common.service';
import { DataSource, Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { CachedService } from '@slack/cached';
import { TASK_ERROR } from '@slack/constants';

describe('ChecklistService', () => {
  let service: ChecklistService;
  let taskRepo: Repository<TaskEntity>;
  let checklistRepo: Repository<ChecklistEntity>;
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

  const mockCachedService = {
    exists: jest.fn(),
    ping: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    getVersion: jest.fn(),
    bumpVersion: jest.fn(),
    getOrSetDetail: jest.fn((_key, _ttl, fetcher) => fetcher()),
    invalidateDetail: jest.fn(),
    getOrSetList: jest.fn((opts) => opts.fetcher()),
    invalidateList: jest.fn(),
    invalidateListBulk: jest.fn(),
    setSet: jest.fn(),
    getSet: jest.fn(),
    removeFromSet: jest.fn(),
    isMemberOfSet: jest.fn(),
    writeThrough: jest.fn((_key, _ttl, fetcher) => fetcher()),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChecklistService,
        {
          provide: getRepositoryToken(ChecklistEntity),
          useValue: {
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(ChecklistItemEntity),
          useValue: {},
        },
        {
          provide: getRepositoryToken(TaskEntity),
          useValue: {
            findOne: jest.fn(),
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
        {
          provide: CachedService,
          useValue: mockCachedService,
        },
      ],
    }).compile();

    service = module.get<ChecklistService>(ChecklistService);
    taskRepo = module.get<Repository<TaskEntity>>(
      getRepositoryToken(TaskEntity),
    );
    checklistRepo = module.get<Repository<ChecklistEntity>>(
      getRepositoryToken(ChecklistEntity),
    );
    commonService = module.get<TaskCommonService>(TaskCommonService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createChecklist', () => {
    it('should create checklist successfully', async () => {
      const dto = { taskId: 'task-1', name: 'Checklist 1' };
      const task = { id: 'task-1', group: { boardId: 'board-1' } };
      mockManager.findOne.mockResolvedValue(task);
      mockManager.create.mockReturnValue({ ...dto, id: 'cl-1' });
      mockManager.save.mockResolvedValue({ ...dto, id: 'cl-1' });

      const result = await service.createChecklist(dto as any, 'user-1');

      expect(mockManager.findOne).toHaveBeenCalled();
      expect(commonService.checkBoardMembership).toHaveBeenCalled();
      expect(result.id).toBe('cl-1');
    });

    it('should throw if task not found', async () => {
      mockManager.findOne.mockResolvedValue(null);
      await expect(
        service.createChecklist({ taskId: '1' } as any, 'u1'),
      ).rejects.toThrow(new RpcException(TASK_ERROR.TASK_NOT_FOUND));
    });
  });

  describe('getChecklistsInTask', () => {
    it('should return checklists', async () => {
      const task = { id: 't1', group: { boardId: 'b1' } };
      (taskRepo.findOne as jest.Mock).mockResolvedValue(task);
      (checklistRepo.find as jest.Mock).mockResolvedValue([
        { id: 'cl1', items: [] },
      ]);

      const result = await service.getChecklistsInTask('t1', 'u1');
      expect(result).toHaveLength(1);
    });
  });

  describe('addChecklistItem', () => {
    it('should add item successfully', async () => {
      const checklist = { id: 'cl1', task: { group: { boardId: 'b1' } } };
      mockManager.findOne.mockResolvedValue(checklist);
      mockManager.create.mockReturnValue({ id: 'item1', content: 'test' });
      mockManager.save.mockResolvedValue({ id: 'item1', content: 'test' });

      const result = await service.addChecklistItem(
        { checklistId: 'cl1', content: 'test' } as any,
        'u1',
      );
      expect(result.id).toBe('item1');
    });
  });

  describe('toggleChecklistItem', () => {
    it('should toggle isCompleted', async () => {
      const item = {
        id: 'i1',
        isCompleted: false,
        checklist: { task: { group: { boardId: 'b1' } } },
      };
      mockManager.findOne.mockResolvedValue(item);
      mockManager.save.mockImplementation((i) => Promise.resolve(i));

      const result = await service.toggleChecklistItem('i1', 'u1');
      expect(result.isCompleted).toBe(true);
    });
  });
});
