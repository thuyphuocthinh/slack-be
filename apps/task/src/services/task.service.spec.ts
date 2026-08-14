import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TaskService } from './task.service';
import { TaskEntity } from '../entity/task.entity';
import { LabelEntity } from '../entity/label.entity';
import { TaskMemberEntity } from '../entity/task_member.entity';
import { BoardMemberEntity } from '../entity/board_member.entity';
import { TaskCommonService } from './task-common.service';
import { DataSource } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { TASK_ERROR, NAME_SERVICE_TCP } from '@slack/constants';
import { TaskGroupEntity } from '../entity/task_group.entity';
import { CachedService } from '@slack/cached';
import { QueueService } from '@slack/queue';

describe('TaskService', () => {
  let service: TaskService;

  const mockManager = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    findBy: jest.fn(),
    remove: jest.fn(),
    delete: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn().mockImplementation((cb) => cb(mockManager)),
    getRepository: jest.fn().mockReturnThis(),
    findOneBy: jest.fn(),
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

  const mockQueueService = {
    addJob: jest.fn().mockResolvedValue(undefined),
  };

  const mockNotificationClient = {
    emit: jest.fn(),
    send: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskService,
        {
          provide: getRepositoryToken(TaskEntity),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(LabelEntity),
          useValue: {},
        },
        {
          provide: getRepositoryToken(TaskMemberEntity),
          useValue: {},
        },
        {
          provide: getRepositoryToken(BoardMemberEntity),
          useValue: {},
        },
        {
          provide: getRepositoryToken(TaskGroupEntity),
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
        {
          provide: QueueService,
          useValue: mockQueueService,
        },
        {
          provide: NAME_SERVICE_TCP.NOTIFICATION_SERVICE,
          useValue: mockNotificationClient,
        },
      ],
    }).compile();

    service = module.get<TaskService>(TaskService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createNewTask', () => {
    it('should create task successfully', async () => {
      const dto = { groupId: 'g1', title: 'Task 1' };
      mockManager.findOne.mockResolvedValue({ id: 'g1', boardId: 'b1' });
      mockManager.create.mockReturnValue({ id: 't1', ...dto });
      mockManager.save.mockResolvedValue({ id: 't1', ...dto });

      const result = await service.createNewTask(dto as any, 'u1');

      expect(result.id).toBe('t1');
    });

    it('should throw if group not found', async () => {
      mockManager.findOne.mockResolvedValue(null);
      await expect(
        service.createNewTask({ groupId: 'g1' } as any, 'u1'),
      ).rejects.toThrow(new RpcException(TASK_ERROR.GROUP_NOT_FOUND));
    });
  });

  describe('updateTaskDetails', () => {
    it('should update task details', async () => {
      const task = { id: 't1', group: { boardId: 'b1' }, labels: [] };
      mockManager.findOne.mockResolvedValue(task);
      mockManager.save.mockImplementation((t) => Promise.resolve(t));

      const result = await service.updateTaskDetails(
        't1',
        { title: 'New' } as any,
        'u1',
      );
      expect(result.title).toBe('New');
    });

    it('should update labels if provided', async () => {
      const task = { id: 't1', group: { boardId: 'b1' }, labels: [] };
      const labels = [{ id: 'l1' }];
      mockManager.findOne.mockResolvedValue(task);
      mockManager.findBy.mockResolvedValue(labels);
      mockManager.save.mockImplementation((t) => Promise.resolve(t));

      const result = await service.updateTaskDetails(
        't1',
        { labelIds: ['l1'] } as any,
        'u1',
      );
      expect(result.labels).toHaveLength(1);
    });
  });

  describe('assignMemberToTask', () => {
    it('should assign member if in board', async () => {
      const task = { id: 't1', group: { boardId: 'b1' } };
      mockManager.findOne
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(null); // task then existing task-member
      mockManager.find.mockResolvedValue([{ memberId: 'm1' }]);
      mockManager.create.mockReturnValue({});
      mockManager.save.mockResolvedValue({});

      const result = await service.assignMemberToTask('t1', 'm1', 'u1');
      expect(result).toContain('successfully');
    });

    it('should throw if member not in board', async () => {
      const task = { id: 't1', group: { boardId: 'b1' } };
      mockManager.findOne.mockResolvedValue(task);
      mockManager.find.mockResolvedValue([]);

      await expect(
        service.assignMemberToTask('t1', 'm1', 'u1'),
      ).rejects.toThrow(new RpcException(TASK_ERROR.MEMBER_NOT_IN_BOARD));
    });
  });

  describe('toggleTaskLabel', () => {
    it('should add label if not present', async () => {
      const task = { id: 't1', labels: [], group: { boardId: 'b1' } };
      const label = { id: 'l1' };
      mockManager.findOne
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(label);
      mockManager.save.mockResolvedValue({});

      const result = await service.toggleTaskLabel('t1', 'l1', 'u1');
      expect(result).toContain('successfully');
      expect(task.labels).toHaveLength(1);
    });

    it('should remove label if present', async () => {
      const task = {
        id: 't1',
        labels: [{ id: 'l1' }],
        group: { boardId: 'b1' },
      };
      const label = { id: 'l1' };
      mockManager.findOne
        .mockResolvedValueOnce(task)
        .mockResolvedValueOnce(label);
      mockManager.save.mockResolvedValue({});

      const result = await service.toggleTaskLabel('t1', 'l1', 'u1');
      expect(result).toContain('successfully');
      expect(task.labels).toHaveLength(0);
    });
  });
});
