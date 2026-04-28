import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { ChannelMemberService } from './channel-member.service';
import { ChannelMemberEntity } from '../entity/channel_member.entity';
import { ChannelEntity } from '../entity/channel.entity';
import { RpcException } from '@nestjs/microservices';
import { CachedService } from '@slack/cached';
import { NAME_SERVICE_TCP, ChannelTypeEnum, WorkspaceRoleEnum } from '@slack/constants';
import { of } from 'rxjs';

describe('ChannelMemberService', () => {
  let service: ChannelMemberService;
  let channelMemberRepository: Repository<ChannelMemberEntity>;
  let mockEntityManager: any;

  const mockChannelMemberRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  const mockChannelRepository = {
    findOne: jest.fn(),
  };

  mockEntityManager = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    remove: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn((cb) => cb(mockEntityManager)),
  };

  const mockClientProxy = {
    send: jest.fn(),
  };

  const mockCachedService = {
    invalidateList: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChannelMemberService,
        {
          provide: getRepositoryToken(ChannelMemberEntity),
          useValue: mockChannelMemberRepository,
        },
        {
          provide: getRepositoryToken(ChannelEntity),
          useValue: mockChannelRepository,
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
      ],
    }).compile();

    service = module.get<ChannelMemberService>(ChannelMemberService);
    channelMemberRepository = module.get<Repository<ChannelMemberEntity>>(getRepositoryToken(ChannelMemberEntity));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addMember', () => {
    const dto = { channelId: 'c-id', targetMemberId: 't-id', performerId: 'p-id' };

    it('should add member successfully', async () => {
      mockClientProxy.send.mockReturnValueOnce(of({ id: 't-id' }));
      mockEntityManager.findOne.mockResolvedValueOnce({ id: 'c-id', workspaceId: 'ws-id', type: ChannelTypeEnum.GROUP });
      mockClientProxy.send.mockReturnValueOnce(of({ role: WorkspaceRoleEnum.ADMIN }));
      mockEntityManager.findOne.mockResolvedValueOnce(null);
      mockEntityManager.create.mockReturnValue({ id: 'new-member' });

      const result = await service.addMember(dto);

      expect(result).toBe('success');
      expect(mockEntityManager.save).toHaveBeenCalled();
    });

    it('should throw error if channel is DIRECT', async () => {
      mockClientProxy.send.mockReturnValueOnce(of({ id: 't-id' }));
      mockEntityManager.findOne.mockResolvedValueOnce({ id: 'c-id', type: ChannelTypeEnum.DIRECT });

      await expect(service.addMember(dto)).rejects.toThrow(RpcException);
    });

    it('should throw error if user already member', async () => {
      mockClientProxy.send.mockReturnValueOnce(of({ id: 't-id' }));
      mockEntityManager.findOne.mockResolvedValueOnce({ id: 'c-id', workspaceId: 'ws-id', type: ChannelTypeEnum.GROUP });
      mockClientProxy.send.mockReturnValueOnce(of({ role: WorkspaceRoleEnum.ADMIN }));
      mockEntityManager.findOne.mockResolvedValueOnce({ id: 'existing' });

      await expect(service.addMember(dto)).rejects.toThrow(RpcException);
    });
  });

  describe('addBatchMembers', () => {
    const dto = { channelId: 'c-id', targetMemberIds: ['id1', 'id2'], performerId: 'p-id' };

    it('should add multiple members successfully', async () => {
      mockClientProxy.send.mockReturnValueOnce(of([{ id: 'id1' }, { id: 'id2' }]));
      mockEntityManager.findOne.mockResolvedValueOnce({ id: 'c-id', workspaceId: 'ws-id', type: ChannelTypeEnum.GROUP });
      mockClientProxy.send.mockReturnValueOnce(of({ role: WorkspaceRoleEnum.OWNER }));
      mockEntityManager.find.mockResolvedValueOnce([]);
      mockEntityManager.create.mockImplementation((entity, data) => data);

      const result = await service.addBatchMembers(dto);

      expect(result).toBe('success');
      expect(mockEntityManager.save).toHaveBeenCalled();
    });

    it('should return if all members already exist', async () => {
      mockClientProxy.send.mockReturnValueOnce(of([{ id: 'id1' }, { id: 'id2' }]));
      mockEntityManager.findOne.mockResolvedValueOnce({ id: 'c-id', workspaceId: 'ws-id', type: ChannelTypeEnum.GROUP });
      mockClientProxy.send.mockReturnValueOnce(of({ role: WorkspaceRoleEnum.OWNER }));
      mockEntityManager.find.mockResolvedValueOnce([{ memberId: 'id1' }, { memberId: 'id2' }]);

      await service.addBatchMembers(dto);

      expect(mockEntityManager.save).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    const dto = { channelId: 'c-id', targetMemberId: 't-id', performerId: 'p-id' };

    it('should remove member successfully', async () => {
      mockEntityManager.findOne.mockResolvedValueOnce({ id: 'c-id', workspaceId: 'ws-id', type: ChannelTypeEnum.GROUP });
      mockClientProxy.send.mockReturnValueOnce(of({ role: WorkspaceRoleEnum.OWNER }));
      mockClientProxy.send.mockReturnValueOnce(of({ role: WorkspaceRoleEnum.MEMBER }));
      mockEntityManager.findOne.mockResolvedValueOnce({ id: 'member-id' });

      const result = await service.removeMember(dto);

      expect(result).toBe('success');
      expect(mockEntityManager.remove).toHaveBeenCalled();
    });

    it('should throw error if admin tries to remove admin', async () => {
      mockEntityManager.findOne.mockResolvedValueOnce({ id: 'c-id', workspaceId: 'ws-id', type: ChannelTypeEnum.GROUP });
      mockClientProxy.send.mockReturnValueOnce(of({ role: WorkspaceRoleEnum.ADMIN }));
      mockClientProxy.send.mockReturnValueOnce(of({ role: WorkspaceRoleEnum.ADMIN }));

      await expect(service.removeMember(dto)).rejects.toThrow(RpcException);
    });
  });

  describe('getMembers', () => {
    it('should return member list with user details', async () => {
      const members = [{ memberId: 'u1' }, { memberId: 'u2' }];
      mockChannelMemberRepository.find.mockResolvedValue(members);
      mockClientProxy.send.mockReturnValue(of([
        { id: 'u1', firstName: 'U1', lastName: 'L1', email: 'e1' },
        { id: 'u2', firstName: 'U2', lastName: 'L2', email: 'e2' }
      ]));

      const result = await service.getMembers('c-id');

      expect(result).toHaveLength(2);
      expect(result[0].firstName).toBe('U1');
    });
  });

  describe('leaveChannel', () => {
    it('should leave channel successfully', async () => {
      mockEntityManager.findOne.mockResolvedValueOnce({ id: 'c-id', workspaceId: 'ws-id' });
      mockEntityManager.findOne.mockResolvedValueOnce({ id: 'm-id' });

      const result = await service.leaveChannel('c-id', 'm-id');

      expect(result).toContain('successfully');
      expect(mockEntityManager.remove).toHaveBeenCalled();
    });
  });
});
