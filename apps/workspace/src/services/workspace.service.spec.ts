jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mocked-uuid'),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceService } from './services/workspace.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspaceEntity } from './entity/workspace.entity';
import { WorkspaceMemberEntity } from './entity/workspace_member.entity';
import { DataSource, Repository } from 'typeorm';
import { CachedService } from '@slack/cached';
import { WorkspaceCommonService } from './services/workspace-common.service';

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let workspaceRepo: Repository<WorkspaceEntity>;
  let memberRepo: Repository<WorkspaceMemberEntity>;
  let cachedService: CachedService;
  let commonService: WorkspaceCommonService;

  const mockManager = {
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockWorkspaceRepo = () => ({
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    remove: jest.fn(),
  });

  const mockMemberRepo = () => ({
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  });

  const mockDataSource = {
    transaction: jest.fn((cb) => cb(mockManager)),
  };

  const mockCachedService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    getOrSetDetail: jest.fn((key, ttl, cb) => cb()),
  };

  const mockCommonService = {
    checkPermission: jest.fn().mockResolvedValue(true),
    isMemberOfWorkspace: jest.fn().mockResolvedValue(true),
    findWorkspaceById: jest
      .fn()
      .mockResolvedValue({ id: 'ws-id', name: 'Test' }),
    mapWorkspaceToDto: jest.fn((w) => w),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useFactory: mockWorkspaceRepo,
        },
        {
          provide: getRepositoryToken(WorkspaceMemberEntity),
          useFactory: mockMemberRepo,
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
          provide: WorkspaceCommonService,
          useValue: mockCommonService,
        },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
    workspaceRepo = module.get(getRepositoryToken(WorkspaceEntity));
    memberRepo = module.get(getRepositoryToken(WorkspaceMemberEntity));
    cachedService = module.get(CachedService);
    commonService = module.get(WorkspaceCommonService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createWorkspace', () => {
    const dto = {
      name: 'Test Workspace',
      description: 'Desc',
      ownerUserId: 'owner-id',
    };
    const workspace = { id: 'ws-id', name: dto.name, slug: 'test-workspace' };

    it('should create workspace and owner member successfully', async () => {
      mockManager.create.mockReturnValueOnce(workspace); // workspace
      mockManager.save.mockResolvedValueOnce(workspace); // workspace
      mockManager.create.mockReturnValueOnce({ id: 'member-id' }); // member
      mockManager.save.mockResolvedValueOnce({}); // member

      const result = await service.createWorkspace(dto);

      expect(result).toBeDefined();
      expect(result.id).toBe(workspace.id);
      expect(mockDataSource.transaction).toHaveBeenCalled();
      expect(cachedService.del).toHaveBeenCalled();
    });

    it('should throw error if transaction fails', async () => {
      mockDataSource.transaction.mockRejectedValueOnce(
        new Error('Transaction failed'),
      );

      await expect(service.createWorkspace(dto)).rejects.toThrow(
        'Transaction failed',
      );
    });
  });

  describe('updateWorkspace', () => {
    const dto = {
      workspaceId: 'ws-id',
      updatedBy: 'user-id',
      name: 'New Name',
    };

    it('should update workspace successfully', async () => {
      const workspace = { id: 'ws-id', name: 'Old' };
      (commonService.findWorkspaceById as jest.Mock).mockResolvedValue(
        workspace,
      );
      (workspaceRepo.save as jest.Mock).mockResolvedValue({
        ...workspace,
        name: 'New Name',
      });

      const result = await service.updateWorkspace(dto);

      expect(result.name).toBe('New Name');
      expect(workspaceRepo.save).toHaveBeenCalled();
    });
  });

  describe('getListWorkspaceOfUser', () => {
    const userId = 'user-id';
    const members = [{ workspaceId: 'ws-1' }, { workspaceId: 'ws-2' }];
    const workspaces = [
      { id: 'ws-1', name: 'WS 1' },
      { id: 'ws-2', name: 'WS 2' },
    ];

    it('should return list of workspaces', async () => {
      (memberRepo.find as jest.Mock).mockResolvedValue(members);
      (workspaceRepo.find as jest.Mock).mockResolvedValue(workspaces);

      const result = await service.getListWorkspaceOfUser(userId);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('ws-1');
      expect(cachedService.set).toHaveBeenCalled();
    });

    it('should return cached data if available', async () => {
      (cachedService.get as jest.Mock).mockResolvedValue(workspaces);

      const result = await service.getListWorkspaceOfUser(userId);

      expect(result).toEqual(workspaces);
      expect(memberRepo.find).not.toHaveBeenCalled();
    });
  });
});
