import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceMemberService } from './workspace-member.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspaceMemberEntity } from '../entity/workspace_member.entity';
import { DataSource, Repository } from 'typeorm';
import { WorkspaceRoleEnum, MembershipStatus } from '../types/workspace.enum';
import { CachedService } from '@slack/cached';
import { WorkspaceCommonService } from './workspace-common.service';

describe('WorkspaceMemberService', () => {
  let service: WorkspaceMemberService;
  let memberRepo: Repository<WorkspaceMemberEntity>;
  let commonService: WorkspaceCommonService;

  const mockMemberRepo = () => ({
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  });

  const mockDataSource = {
    transaction: jest.fn((cb) =>
      cb({
        create: jest.fn(),
        save: jest.fn(),
      }),
    ),
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
    mapMemberToDto: jest.fn((m) => m),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceMemberService,
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

    service = module.get<WorkspaceMemberService>(WorkspaceMemberService);
    memberRepo = module.get(getRepositoryToken(WorkspaceMemberEntity));
    commonService = module.get(WorkspaceCommonService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('removeMember', () => {
    const dto = {
      workspaceId: 'ws-id',
      targetUserId: 'target-id',
      adminUserId: 'admin-id',
    };
    const targetMember = {
      userId: 'target-id',
      role: WorkspaceRoleEnum.MEMBER,
      status: MembershipStatus.ACTIVE,
    };

    it('should remove member successfully', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(targetMember);
      (memberRepo.save as jest.Mock).mockResolvedValue({
        ...targetMember,
        status: MembershipStatus.REMOVED,
      });

      const result = await service.removeMember(dto);

      expect(result).toBe('Member removed successfully');
      expect(memberRepo.save).toHaveBeenCalled();
      expect(commonService.checkPermission).toHaveBeenCalled();
    });
  });

  // More tests can be added here mirroring the original workspace.service.spec.ts logic
});
