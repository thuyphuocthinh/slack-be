import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TaskCommonService } from './task-common.service';
import { BoardMemberEntity } from '../entity/board_member.entity';
import { TaskBoardEntity } from '../entity/task_board.entity';
import { RpcException } from '@nestjs/microservices';
import { NAME_SERVICE_TCP, TASK_ERROR } from '@slack/constants';
import { of, throwError } from 'rxjs';
import { CachedService } from '@slack/cached';
import { Repository } from 'typeorm';

describe('TaskCommonService', () => {
  let service: TaskCommonService;
  let boardRepo: Repository<TaskBoardEntity>;
  let boardMemberRepo: Repository<BoardMemberEntity>;

  const mockWorkspaceClient = {
    send: jest.fn(),
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
        TaskCommonService,
        {
          provide: getRepositoryToken(BoardMemberEntity),
          useValue: {
            findOneBy: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(TaskBoardEntity),
          useValue: {
            findOneBy: jest.fn(),
          },
        },
        {
          provide: NAME_SERVICE_TCP.WORKSPACE_SERVICE,
          useValue: mockWorkspaceClient,
        },
        {
          provide: CachedService,
          useValue: mockCachedService,
        },
      ],
    }).compile();

    service = module.get<TaskCommonService>(TaskCommonService);
    boardRepo = module.get<Repository<TaskBoardEntity>>(
      getRepositoryToken(TaskBoardEntity),
    );
    boardMemberRepo = module.get<Repository<BoardMemberEntity>>(
      getRepositoryToken(BoardMemberEntity),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getMemberId', () => {
    it('should return member id from workspace service', async () => {
      mockWorkspaceClient.send.mockReturnValue(of({ id: 'member-1' }));
      const result = await service.getMemberId('ws-1', 'user-1');
      expect(result).toBe('member-1');
    });

    it('should throw NOT_MEMBER_OF_WORKSPACE if workspace service fails', async () => {
      mockWorkspaceClient.send.mockReturnValue(throwError(() => new Error()));
      await expect(service.getMemberId('ws-1', 'user-1')).rejects.toThrow(
        new RpcException(TASK_ERROR.NOT_MEMBER_OF_WORKSPACE),
      );
    });
  });

  describe('checkBoardMembership', () => {
    it('should pass if membership exists', async () => {
      const board = { id: 'b1', workspaceId: 'ws1' };
      (boardRepo.findOneBy as jest.Mock).mockResolvedValue(board);
      mockWorkspaceClient.send.mockReturnValue(of({ id: 'm1' }));
      (boardMemberRepo.findOneBy as jest.Mock).mockResolvedValue({ id: 'bm1' });

      await expect(
        service.checkBoardMembership('b1', 'u1'),
      ).resolves.not.toThrow();
    });

    it('should throw if board not found', async () => {
      (boardRepo.findOneBy as jest.Mock).mockResolvedValue(null);
      await expect(service.checkBoardMembership('b1', 'u1')).rejects.toThrow(
        new RpcException(TASK_ERROR.BOARD_NOT_FOUND),
      );
    });

    it('should throw if membership not found', async () => {
      const board = { id: 'b1', workspaceId: 'ws1' };
      (boardRepo.findOneBy as jest.Mock).mockResolvedValue(board);
      mockWorkspaceClient.send.mockReturnValue(of({ id: 'm1' }));
      (boardMemberRepo.findOneBy as jest.Mock).mockResolvedValue(null);

      await expect(service.checkBoardMembership('b1', 'u1')).rejects.toThrow(
        new RpcException(TASK_ERROR.MEMBER_NOT_IN_BOARD),
      );
    });

    it('should use provided manager if available', async () => {
      const mockManager = {
        getRepository: jest.fn().mockReturnThis(),
        findOneBy: jest.fn(),
      } as any;

      const board = { id: 'b1', workspaceId: 'ws1' };
      mockManager.findOneBy
        .mockResolvedValueOnce(board)
        .mockResolvedValueOnce({ id: 'bm1' });
      mockWorkspaceClient.send.mockReturnValue(of({ id: 'm1' }));

      await service.checkBoardMembership('b1', 'u1', mockManager);
      expect(mockManager.getRepository).toHaveBeenCalled();
    });
  });
});
