import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LabelService } from './label.service';
import { LabelEntity } from '../entity/label.entity';
import { TaskCommonService } from './task-common.service';
import { DataSource, Repository } from 'typeorm';
import { CachedService } from '@slack/cached';

describe('LabelService', () => {
  let service: LabelService;
  let labelRepo: Repository<LabelEntity>;
  let commonService: TaskCommonService;

  const mockManager = {
    findOne: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn().mockImplementation((cb) => cb(mockManager)),
  };

  const mockCommonService = {
    checkWorkspaceMembership: jest.fn(),
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
        LabelService,
        {
          provide: getRepositoryToken(LabelEntity),
          useValue: {
            create: jest.fn(),
            save: jest.fn(),
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

    service = module.get<LabelService>(LabelService);
    labelRepo = module.get<Repository<LabelEntity>>(
      getRepositoryToken(LabelEntity),
    );
    commonService = module.get<TaskCommonService>(TaskCommonService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createNewLabel', () => {
    it('should create label', async () => {
      const dto = { workspaceId: 'ws1', name: 'L1', color: 'red' };
      (labelRepo.create as jest.Mock).mockReturnValue(dto);
      (labelRepo.save as jest.Mock).mockResolvedValue({ id: 'l1', ...dto });

      const result = await service.createNewLabel(dto as any, 'u1');

      expect(commonService.checkWorkspaceMembership).toHaveBeenCalledWith(
        'ws1',
        'u1',
      );
      expect(result.id).toBe('l1');
    });
  });

  describe('updateLabelInfo', () => {
    it('should update label info', async () => {
      const label = { id: 'l1', workspaceId: 'ws1', name: 'Old' };
      mockManager.findOne.mockResolvedValue(label);
      mockManager.save.mockResolvedValue({ ...label, name: 'New' });

      const result = await service.updateLabelInfo(
        'l1',
        { name: 'New' } as any,
        'u1',
      );

      expect(result.name).toBe('New');
    });
  });

  describe('getLabelsInWorkspace', () => {
    it('should return labels', async () => {
      (labelRepo.find as jest.Mock).mockResolvedValue([{ id: 'l1' }]);
      const result = await service.getLabelsInWorkspace('ws1', 'u1');
      expect(result).toHaveLength(1);
    });
  });
});
