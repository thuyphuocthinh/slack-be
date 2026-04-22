import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceLinkService } from './workspace-link.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspaceLinkEntity } from '../entity/workspace_link.entity';
import { WorkspaceMemberEntity } from '../entity/workspace_member.entity';
import { DataSource, Repository } from 'typeorm';
import { CachedService } from '@slack/cached';
import { WorkspaceCommonService } from './workspace-common.service';

describe('WorkspaceLinkService', () => {
  let service: WorkspaceLinkService;
  let linkRepo: Repository<WorkspaceLinkEntity>;
  let commonService: WorkspaceCommonService;

  const mockLinkRepo = () => ({
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  });

  const mockMemberRepo = () => ({
    findOne: jest.fn(),
  });

  const mockDataSource = {
    transaction: jest.fn((cb) =>
      cb({
        save: jest.fn(),
      }),
    ),
  };

  const mockCachedService = {
    del: jest.fn(),
  };

  const mockCommonService = {
    checkPermission: jest.fn().mockResolvedValue(true),
    mapLinkToDto: jest.fn((l) => l),
    mapMemberToDto: jest.fn((m) => m),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceLinkService,
        {
          provide: getRepositoryToken(WorkspaceLinkEntity),
          useFactory: mockLinkRepo,
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

    service = module.get<WorkspaceLinkService>(WorkspaceLinkService);
    linkRepo = module.get(getRepositoryToken(WorkspaceLinkEntity));
    commonService = module.get(WorkspaceCommonService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateLink', () => {
    const dto = { workspaceId: 'ws-id', adminUserId: 'admin-id' };
    const link = { id: 'link-id', ...dto };

    it('should generate link successfully', async () => {
      (linkRepo.save as jest.Mock).mockResolvedValue(link);

      const result = await service.generateLink(dto);

      expect(result).toBeDefined();
      expect(linkRepo.save).toHaveBeenCalled();
      expect(commonService.checkPermission).toHaveBeenCalled();
    });
  });
});
