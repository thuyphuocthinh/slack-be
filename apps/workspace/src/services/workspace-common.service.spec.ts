import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceCommonService } from './workspace-common.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspaceEntity } from '../entity/workspace.entity';
import { WorkspaceMemberEntity } from '../entity/workspace_member.entity';
import { Repository } from 'typeorm';
import { CachedService } from '@slack/cached';
import { RpcException } from '@nestjs/microservices';
import { WorkspaceRoleEnum } from '../types/workspace.enum';

describe('WorkspaceCommonService', () => {
  let service: WorkspaceCommonService;
  let memberRepo: Repository<WorkspaceMemberEntity>;

  const mockMemberRepo = () => ({
    findOne: jest.fn(),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceCommonService,
        {
          provide: getRepositoryToken(WorkspaceMemberEntity),
          useFactory: mockMemberRepo,
        },
        {
          provide: getRepositoryToken(WorkspaceEntity),
          useFactory: mockWorkspaceRepo,
        },
        {
          provide: CachedService,
          useValue: mockCachedService,
        },
      ],
    }).compile();

    service = module.get<WorkspaceCommonService>(WorkspaceCommonService);
    memberRepo = module.get(getRepositoryToken(WorkspaceMemberEntity));
    workspaceRepo = module.get(getRepositoryToken(WorkspaceEntity));
    cachedService = module.get(CachedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('mapWorkspaceToDto', () => {
    it('should map workspace to dto correctly', () => {
      const workspace = {
        id: '1',
        name: 'Test',
        slug: 'test',
      } as WorkspaceEntity;
      const result = service.mapWorkspaceToDto(workspace);
      expect(result.id).toBe(workspace.id);
      expect(result.name).toBe(workspace.name);
    });
  });

  describe('checkPermission', () => {
    it('should not throw if user has permission', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue({
        role: WorkspaceRoleEnum.ADMIN,
      });
      await expect(
        service.checkPermission('ws-id', 'user-id', [WorkspaceRoleEnum.ADMIN]),
      ).resolves.not.toThrow();
    });

    it('should throw RpcException if user has no permission', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue({
        role: WorkspaceRoleEnum.MEMBER,
      });
      await expect(
        service.checkPermission('ws-id', 'user-id', [WorkspaceRoleEnum.ADMIN]),
      ).rejects.toThrow(RpcException);
    });
  });

  describe('isMemberOfWorkspace', () => {
    it('should return true if user is a member', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue({
        userId: 'user-id',
      });
      const result = await service.isMemberOfWorkspace('ws-id', 'user-id');
      expect(result).toBe(true);
    });

    it('should throw RpcException if user is not a member', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.isMemberOfWorkspace('ws-id', 'user-id'),
      ).rejects.toThrow(RpcException);
    });
  });
});
