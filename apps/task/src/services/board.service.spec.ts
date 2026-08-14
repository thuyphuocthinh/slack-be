import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BoardService } from './board.service';
import { TaskBoardEntity } from '../entity/task_board.entity';
import { BoardMemberEntity } from '../entity/board_member.entity';
import { TaskCommonService } from './task-common.service';
import { DataSource, Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { CachedService } from '@slack/cached';
import { TASK_ERROR } from '@slack/constants';

describe('BoardService', () => {
  let service: BoardService;
  let boardRepo: Repository<TaskBoardEntity>;
  let commonService: TaskCommonService;

  const mockManager = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    delete: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn().mockImplementation((cb) => cb(mockManager)),
  };

  const mockCommonService = {
    checkWorkspaceMembership: jest.fn(),
    checkBoardMembership: jest.fn(),
    getMemberId: jest.fn(),
    getMemberRole: jest.fn(),
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
        BoardService,
        {
          provide: getRepositoryToken(TaskBoardEntity),
          useValue: {
            createQueryBuilder: jest.fn(),
            findOneBy: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(BoardMemberEntity),
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
        {
          provide: CachedService,
          useValue: mockCachedService,
        },
      ],
    }).compile();

    service = module.get<BoardService>(BoardService);
    boardRepo = module.get<Repository<TaskBoardEntity>>(
      getRepositoryToken(TaskBoardEntity),
    );
    commonService = module.get<TaskCommonService>(TaskCommonService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createNewBoard', () => {
    it('should create a new board successfully', async () => {
      const dto = { workspaceId: 'ws-1', name: 'Board 1' };
      const requesterId = 'user-1';
      const mockSavedBoard = { id: 'board-1', ...dto };

      mockCommonService.checkWorkspaceMembership.mockResolvedValue('member-1');
      mockManager.create.mockReturnValue(mockSavedBoard);
      mockManager.save.mockResolvedValue(mockSavedBoard);

      const result = await service.createNewBoard(dto as any, requesterId);

      expect(commonService.checkWorkspaceMembership).toHaveBeenCalledWith(
        dto.workspaceId,
        requesterId,
        mockManager,
      );
      expect(mockManager.create).toHaveBeenCalledWith(TaskBoardEntity, dto);
      expect(mockManager.save).toHaveBeenCalledWith(mockSavedBoard);
      expect(result.id).toBe('board-1');
    });
  });

  describe('updateBoardInfo', () => {
    it('should update board info successfully', async () => {
      const id = 'board-1';
      const dto = { name: 'Updated Name' };
      const requesterId = 'user-1';
      const existingBoard = { id, name: 'Old Name' };
      const updatedBoard = { ...existingBoard, ...dto };

      mockCommonService.checkBoardMembership.mockResolvedValue(undefined);
      mockManager.findOne.mockResolvedValue(existingBoard);
      mockManager.save.mockResolvedValue(updatedBoard);

      const result = await service.updateBoardInfo(id, dto as any, requesterId);

      expect(commonService.checkBoardMembership).toHaveBeenCalledWith(
        id,
        requesterId,
        mockManager,
      );
      expect(mockManager.findOne).toHaveBeenCalled();
      expect(mockManager.save).toHaveBeenCalled();
      expect(result.name).toBe('Updated Name');
    });

    it('should throw error if board not found', async () => {
      mockManager.findOne.mockResolvedValue(null);
      await expect(
        service.updateBoardInfo('id', {} as any, 'reqId'),
      ).rejects.toThrow(new RpcException(TASK_ERROR.BOARD_NOT_FOUND));
    });
  });

  describe('deleteBoard', () => {
    it('should delete board successfully', async () => {
      mockCommonService.checkBoardMembership.mockResolvedValue(undefined);
      mockManager.delete.mockResolvedValue({ affected: 1 });

      const result = await service.deleteBoard('board-1', 'user-1');

      expect(result).toContain('deleted');
    });

    it('should throw error if board to delete not found', async () => {
      mockManager.delete.mockResolvedValue({ affected: 0 });
      await expect(service.deleteBoard('id', 'reqId')).rejects.toThrow(
        new RpcException(TASK_ERROR.BOARD_NOT_FOUND),
      );
    });
  });

  describe('getBoardsInWorkspace', () => {
    it('should return boards in workspace', async () => {
      const workspaceId = 'ws-1';
      const requesterId = 'user-1';
      const mockBoards = [{ id: 'b1' }, { id: 'b2' }];

      mockCommonService.getMemberId.mockResolvedValue('member-1');
      const mockQueryBuilder: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockBoards),
      };
      (boardRepo.createQueryBuilder as jest.Mock).mockReturnValue(
        mockQueryBuilder,
      );

      const result = await service.getBoardsInWorkspace(
        workspaceId,
        requesterId,
      );

      expect(result).toHaveLength(2);
      expect(mockQueryBuilder.getMany).toHaveBeenCalled();
    });
  });

  describe('getBoardDetails', () => {
    it('should return board details', async () => {
      const board = { id: 'b1' };
      mockCommonService.checkBoardMembership.mockResolvedValue(undefined);
      (boardRepo.findOneBy as jest.Mock).mockResolvedValue(board);

      const result = await service.getBoardDetails('b1', 'u1');
      expect(result.id).toBe('b1');
    });

    it('should throw if board details not found', async () => {
      (boardRepo.findOneBy as jest.Mock).mockResolvedValue(null);
      await expect(service.getBoardDetails('b1', 'u1')).rejects.toThrow(
        new RpcException(TASK_ERROR.BOARD_NOT_FOUND),
      );
    });
  });

  describe('addMemberToBoard', () => {
    it('should add member successfully', async () => {
      mockCommonService.checkBoardMembership.mockResolvedValue(undefined);
      mockManager.findOne.mockResolvedValue(null);
      mockManager.create.mockReturnValue({});
      mockManager.save.mockResolvedValue({});

      const result = await service.addMemberToBoard('b1', 'm1', 'u1');
      expect(result).toContain('successfully');
    });

    it('should throw if member already in board', async () => {
      mockManager.findOne.mockResolvedValue({});
      await expect(service.addMemberToBoard('b1', 'm1', 'u1')).rejects.toThrow(
        new RpcException(TASK_ERROR.MEMBER_ALREADY_IN_BOARD),
      );
    });
  });

  describe('removeMemberFromBoard', () => {
    it('should remove member successfully (self)', async () => {
      mockManager.findOne.mockResolvedValue({ workspaceId: 'ws1' });
      mockCommonService.getMemberId.mockResolvedValue('m1');
      mockManager.delete.mockResolvedValue({ affected: 1 });

      const result = await service.removeMemberFromBoard('b1', 'm1', 'u1');
      expect(result).toContain('successfully');
    });

    it('should remove member successfully (by admin)', async () => {
      mockManager.findOne.mockResolvedValue({ workspaceId: 'ws1' });
      mockCommonService.getMemberId.mockResolvedValue('m1'); // requester
      mockCommonService.getMemberRole.mockResolvedValue('ADMIN');
      mockManager.delete.mockResolvedValue({ affected: 1 });

      const result = await service.removeMemberFromBoard('b1', 'm2', 'u1');
      expect(result).toContain('successfully');
    });

    it('should throw if not admin/owner removing others', async () => {
      mockManager.findOne.mockResolvedValue({ workspaceId: 'ws1' });
      mockCommonService.getMemberId.mockResolvedValue('m1');
      mockCommonService.getMemberRole.mockResolvedValue('MEMBER');

      await expect(
        service.removeMemberFromBoard('b1', 'm2', 'u1'),
      ).rejects.toThrow(new RpcException(TASK_ERROR.NOT_ENOUGH_PERMISSION));
    });
  });
});
