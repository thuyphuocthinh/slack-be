import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ChannelService } from './channel.service';
import { ChannelEntity } from '../entity/channel.entity';
import { ChannelMemberEntity } from '../entity/channel_member.entity';
import { RpcException } from '@nestjs/microservices';
import { CachedService } from '@slack/cached';
import {
  NAME_SERVICE_TCP,
  ChannelTypeEnum,
  WorkspaceRoleEnum,
  CHANNEL_ERROR,
  WORKSPACE_MESSAGE_PATTERNS,
} from '@slack/constants';
import { of } from 'rxjs';
import { QueueService } from '@slack/queue';
import { CreateChannelDto } from '../dto/create-channel.dto';

describe('ChannelService', () => {
  let service: ChannelService;
  let cachedService: CachedService;

  const mockChannelRepository = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockChannelMemberRepository = {
    findOne: jest.fn(),
  };

  const mockEntityManager = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn((cb) => cb(mockEntityManager)),
  };

  const mockClientProxy = {
    send: jest.fn(),
  };

  const mockCachedService = {
    invalidateList: jest.fn().mockResolvedValue(undefined),
    getOrSetList: jest.fn(),
  };

  const mockQueueService = {
    addJob: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelService,
        {
          provide: getRepositoryToken(ChannelEntity),
          useValue: mockChannelRepository,
        },
        {
          provide: getRepositoryToken(ChannelMemberEntity),
          useValue: mockChannelMemberRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: NAME_SERVICE_TCP.WORKSPACE_SERVICE,
          useValue: mockClientProxy,
        },
        {
          provide: NAME_SERVICE_TCP.USER_SERVICE,
          useValue: mockClientProxy,
        },
        {
          provide: CachedService,
          useValue: mockCachedService,
        },
        {
          provide: QueueService,
          useValue: mockQueueService,
        },
      ],
    }).compile();

    service = module.get<ChannelService>(ChannelService);
    cachedService = module.get<CachedService>(CachedService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createChannel', () => {
    const createDto: CreateChannelDto = {
      workspaceId: 'workspace-id',
      memberId: 'member-id',
      title: 'New Channel',
      type: ChannelTypeEnum.GROUP,
      description: 'Test description',
    };

    it('should create a group channel successfully', async () => {
      mockClientProxy.send.mockReturnValue(
        of({ role: WorkspaceRoleEnum.OWNER }),
      );
      mockEntityManager.findOne.mockResolvedValue(null);
      const savedChannel = { id: 'channel-id', ...createDto };
      mockEntityManager.create.mockImplementation((entity, data) => data);
      mockEntityManager.save.mockResolvedValue(savedChannel);

      const result = await service.createChannel(createDto);

      expect(result).toBeDefined();
      expect(result.id).toBe('channel-id');
      expect(mockEntityManager.save).toHaveBeenCalledTimes(2);
      expect(cachedService.invalidateList).toHaveBeenCalled();
    });

    it('should throw error if group channel already exists', async () => {
      mockClientProxy.send.mockReturnValue(
        of({ role: WorkspaceRoleEnum.OWNER }),
      );
      mockEntityManager.findOne.mockResolvedValue({ id: 'existing-id' });

      await expect(service.createChannel(createDto)).rejects.toThrow(
        RpcException,
      );
    });

    it('should create a direct channel (1-on-1) successfully', async () => {
      const directDto: CreateChannelDto = {
        ...createDto,
        type: ChannelTypeEnum.DIRECT,
        targetMemberIds: ['target-id'],
      };

      mockClientProxy.send.mockReturnValue(
        of([
          { id: 'member-id', firstName: 'Sender', lastName: 'User' },
          { id: 'target-id', firstName: 'Receiver', lastName: 'User' },
        ]),
      );
      mockEntityManager.findOne.mockResolvedValue(null);
      mockEntityManager.create.mockImplementation((entity, data) => data);
      mockEntityManager.save.mockResolvedValue({
        id: 'channel-id',
        title: 'Receiver User',
        type: ChannelTypeEnum.DIRECT,
      });

      const result = await service.createChannel(directDto);

      expect(result.name).toBe('Receiver User');
      expect(mockEntityManager.save).toHaveBeenCalled();
    });

    it('should create a self DM successfully', async () => {
      const selfDmDto: CreateChannelDto = {
        ...createDto,
        type: ChannelTypeEnum.DIRECT,
        targetMemberIds: [],
      };

      mockClientProxy.send.mockReturnValue(
        of([{ id: 'member-id', firstName: 'Me', lastName: 'Self' }]),
      );
      mockEntityManager.findOne.mockResolvedValue(null);
      mockEntityManager.create.mockImplementation((entity, data) => data);
      mockEntityManager.save.mockResolvedValue({
        id: 'channel-id',
        title: 'Me Self (you)',
        type: ChannelTypeEnum.DIRECT,
      });

      const result = await service.createChannel(selfDmDto);

      expect(result.name).toBe('Me Self (you)');
    });
  });

  describe('updateChannel', () => {
    it('should update channel successfully', async () => {
      const updateDto = {
        channelId: 'channel-id',
        memberId: 'member-id',
        title: 'Updated Title',
      };
      const channel = {
        id: 'channel-id',
        workspaceId: 'ws-id',
        title: 'Old Title',
      };

      mockEntityManager.findOne.mockResolvedValue(channel);
      mockClientProxy.send.mockReturnValue(
        of({ role: WorkspaceRoleEnum.OWNER }),
      );
      mockEntityManager.save.mockResolvedValue({
        ...channel,
        title: 'Updated Title',
      });

      const result = await service.updateChannel(updateDto);

      expect(result.name).toBe('Updated Title');
    });

    it('should throw error if channel not found', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);
      await expect(
        service.updateChannel({ channelId: 'id', memberId: 'id', title: 't' }),
      ).rejects.toThrow(RpcException);
    });
  });

  describe('deleteChannel', () => {
    it('should delete channel successfully', async () => {
      const channel = { id: 'channel-id', workspaceId: 'ws-id' };
      mockChannelRepository.findOne.mockResolvedValue(channel);
      mockClientProxy.send.mockReturnValue(
        of({ role: WorkspaceRoleEnum.OWNER }),
      );

      const result = await service.deleteChannel('channel-id', 'member-id');

      expect(result).toBe('success');
      expect(mockEntityManager.delete).toHaveBeenCalledTimes(2);
    });

    it('should throw error if not owner', async () => {
      const channel = { id: 'channel-id', workspaceId: 'ws-id' };
      mockChannelRepository.findOne.mockResolvedValue(channel);
      mockClientProxy.send.mockImplementation((pattern) => {
        if (pattern === WORKSPACE_MESSAGE_PATTERNS.CHECK_PERMISSION) {
          throw new RpcException(CHANNEL_ERROR.NOT_ALLOWED);
        }
        return of({});
      });

      await expect(
        service.deleteChannel('channel-id', 'member-id'),
      ).rejects.toThrow(RpcException);
    });
  });

  describe('getChannels', () => {
    it('should return paginated channels', async () => {
      const dto = { workspaceId: 'ws-id', memberId: 'm-id' };
      mockClientProxy.send.mockReturnValue(of({}));

      const channels = [{ id: '1', title: 'c1' }];
      mockCachedService.getOrSetList.mockImplementation(
        async ({ fetcher }) => await fetcher(),
      );

      const queryBuilder: any = {
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([channels, 1]),
      };
      mockChannelRepository.createQueryBuilder.mockReturnValue(queryBuilder);

      const result = await service.getChannels(dto);

      expect(result.data).toHaveLength(1);
      expect(result.paging.total).toBe(1);
    });
  });

  describe('getChannel', () => {
    it('should return channel details', async () => {
      mockChannelRepository.findOne.mockResolvedValue({
        id: 'c-id',
        title: 'title',
      });
      mockChannelMemberRepository.findOne.mockResolvedValue({ id: 'm-id' });

      const result = await service.getChannel('c-id', 'm-id');

      expect(result.id).toBe('c-id');
    });
  });

  describe('toggleStar', () => {
    it('should toggle star status successfully', async () => {
      const channel = { id: 'c-id', isStar: false };
      mockEntityManager.findOne.mockResolvedValue(channel);
      mockEntityManager.save.mockImplementation((data) => data);

      const result = await service.toggleStar({
        channelId: 'c-id',
        memberId: 'm-id',
      });

      expect(result.isStar).toBe(true);
    });

    it('should throw error if channel not found for toggle star', async () => {
      mockEntityManager.findOne.mockResolvedValue(null);
      await expect(
        service.toggleStar({ channelId: 'id', memberId: 'm' }),
      ).rejects.toThrow(RpcException);
    });
  });
});
