jest.mock('uuid', () => ({
  v7: jest.fn(() => 'mocked-uuid'),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceService } from './workspace.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspaceEntity } from './entity/workspace.entity';
import { WorkspaceMemberEntity } from './entity/workspace_member.entity';
import { WorkspaceInviteEntity } from './entity/workspace_invite.entity';
import { WorkspaceLinkEntity } from './entity/workspace_link.entity';
import { DataSource, Repository } from 'typeorm';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  WorkspaceRoleEnum,
  MembershipStatus,
  InviteStatus,
  WorkspaceLinkStatus,
} from './types/workspace.enum';
import {
  NAME_SERVICE_TCP,
  NOTIFICATION_MESSAGE_PATTERNS,
} from '@slack/constants';

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let workspaceRepo: Repository<WorkspaceEntity>;
  let memberRepo: Repository<WorkspaceMemberEntity>;
  let inviteRepo: Repository<WorkspaceInviteEntity>;
  let linkRepo: Repository<WorkspaceLinkEntity>;
  let notificationClient: ClientProxy;

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

  const mockInviteRepo = () => ({
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  });

  const mockLinkRepo = () => ({
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
  });

  const mockNotificationClient = {
    emit: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn((cb) => cb(mockManager)),
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
          provide: getRepositoryToken(WorkspaceInviteEntity),
          useFactory: mockInviteRepo,
        },
        {
          provide: getRepositoryToken(WorkspaceLinkEntity),
          useFactory: mockLinkRepo,
        },
        {
          provide: NAME_SERVICE_TCP.NOTIFICATION_SERVICE,
          useValue: mockNotificationClient,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
    workspaceRepo = module.get(getRepositoryToken(WorkspaceEntity));
    memberRepo = module.get(getRepositoryToken(WorkspaceMemberEntity));
    inviteRepo = module.get(getRepositoryToken(WorkspaceInviteEntity));
    linkRepo = module.get(getRepositoryToken(WorkspaceLinkEntity));
    notificationClient = module.get(NAME_SERVICE_TCP.NOTIFICATION_SERVICE);
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
      (workspaceRepo.findOne as jest.Mock).mockResolvedValue(null); // slug check

      const result = await service.createWorkspace(dto);

      expect(result).toBeDefined();
      expect(result.id).toBe(workspace.id);
      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it('should handle duplicate slugs by appending a counter', async () => {
      mockManager.create.mockReturnValueOnce(workspace);
      mockManager.save.mockResolvedValueOnce(workspace);
      mockManager.create.mockReturnValueOnce({});
      mockManager.save.mockResolvedValueOnce({});

      // First call to findOne returns something, second returns null
      (workspaceRepo.findOne as jest.Mock)
        .mockResolvedValueOnce({ id: 'existing' })
        .mockResolvedValueOnce(null);

      const result = await service.createWorkspace(dto);

      expect(result.slug).toBeDefined();
      expect(workspaceRepo.findOne).toHaveBeenCalledTimes(2);
    });

    it('should throw error if transaction fails', async () => {
      mockDataSource.transaction.mockRejectedValueOnce(
        new Error('Transaction failed'),
      );
      (workspaceRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.createWorkspace(dto)).rejects.toThrow(
        'Transaction failed',
      );
    });
  });

  describe('inviteMember', () => {
    const dto = {
      workspaceId: 'ws-id',
      email: 'test@example.com',
      role: WorkspaceRoleEnum.MEMBER,
      invitedBy: 'admin-id',
    };
    const adminMember = { userId: 'admin-id', role: WorkspaceRoleEnum.ADMIN };
    const invite = { id: 'invite-id', workspaceId: 'ws-id', email: dto.email };

    it('should invite member successfully', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(adminMember); // permission check
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(null); // existing member check
      (inviteRepo.create as jest.Mock).mockReturnValue(invite);
      (inviteRepo.save as jest.Mock).mockResolvedValue(invite);

      const result = await service.inviteMember(dto);

      expect(result).toBeDefined();
      expect(notificationClient.emit).toHaveBeenCalledWith(
        NOTIFICATION_MESSAGE_PATTERNS.SEND_MAIL,
        expect.any(Object),
      );
    });

    it('should throw FORBIDDEN if user has no permission', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce({
        userId: 'admin-id',
        role: WorkspaceRoleEnum.MEMBER,
      });

      await expect(service.inviteMember(dto)).rejects.toThrow(RpcException);
    });

    it('should throw CONFLICT if user is already a member', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(adminMember);
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce({
        userId: dto.email,
      });

      await expect(service.inviteMember(dto)).rejects.toThrow(RpcException);
    });
  });

  describe('addMember', () => {
    const dto = {
      workspaceId: 'ws-id',
      userId: 'user-id',
      role: WorkspaceRoleEnum.MEMBER,
      adminUserId: 'admin-id',
    };
    const adminMember = { userId: 'admin-id', role: WorkspaceRoleEnum.ADMIN };

    it('should add new member successfully', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(adminMember); // permission
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(null); // existing check
      (memberRepo.create as jest.Mock).mockReturnValue({
        ...dto,
        status: MembershipStatus.ACTIVE,
      });
      (memberRepo.save as jest.Mock).mockResolvedValue({
        ...dto,
        status: MembershipStatus.ACTIVE,
      });

      const result = await service.addMember(dto);

      expect(result.status).toBe(MembershipStatus.ACTIVE);
    });

    it('should reactivate existing removed member', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(adminMember);
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce({
        userId: 'user-id',
        status: MembershipStatus.REMOVED,
      });
      (memberRepo.save as jest.Mock).mockResolvedValue({
        userId: 'user-id',
        status: MembershipStatus.ACTIVE,
      });

      const result = await service.addMember(dto);

      expect(result.status).toBe(MembershipStatus.ACTIVE);
      expect(memberRepo.save).toHaveBeenCalled();
    });

    it('should throw CONFLICT if member is already active', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(adminMember);
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce({
        userId: 'user-id',
        status: MembershipStatus.ACTIVE,
      });

      await expect(service.addMember(dto)).rejects.toThrow(RpcException);
    });
  });

  describe('removeMember', () => {
    const dto = {
      workspaceId: 'ws-id',
      targetUserId: 'target-id',
      adminUserId: 'admin-id',
    };
    const adminMember = { userId: 'admin-id', role: WorkspaceRoleEnum.ADMIN };
    const targetMember = {
      userId: 'target-id',
      role: WorkspaceRoleEnum.MEMBER,
      status: MembershipStatus.ACTIVE,
    };

    it('should remove member successfully', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(adminMember);
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(targetMember);
      (memberRepo.save as jest.Mock).mockResolvedValue({
        ...targetMember,
        status: MembershipStatus.REMOVED,
      });

      const result = await service.removeMember(dto);

      expect(result).toBe('Member removed successfully');
      expect(memberRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: MembershipStatus.REMOVED }),
      );
    });

    it('should throw NOT_FOUND if target member not found', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(adminMember);
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.removeMember(dto)).rejects.toThrow(RpcException);
    });

    it('should throw FORBIDDEN if target is owner', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(adminMember);
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce({
        ...targetMember,
        role: WorkspaceRoleEnum.OWNER,
      });

      await expect(service.removeMember(dto)).rejects.toThrow(RpcException);
    });
  });

  describe('joinWorkspace', () => {
    const dto = { token: 'token', userId: 'user-id' };
    const invite = {
      tokenHash: 'token',
      status: InviteStatus.PENDING,
      expiresAt: new Date(Date.now() + 10000),
      workspaceId: 'ws-id',
      role: WorkspaceRoleEnum.MEMBER,
    };

    it('should join workspace successfully', async () => {
      (inviteRepo.findOne as jest.Mock).mockResolvedValue(invite);
      mockManager.save.mockResolvedValue(invite);
      mockManager.create.mockReturnValue({ userId: 'user-id' });
      mockManager.save.mockResolvedValue({ userId: 'user-id' });

      const result = await service.joinWorkspace(dto);

      expect(result).toBeDefined();
      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it('should throw BAD_REQUEST if invite is expired', async () => {
      (inviteRepo.findOne as jest.Mock).mockResolvedValue({
        ...invite,
        expiresAt: new Date(Date.now() - 10000),
      });

      await expect(service.joinWorkspace(dto)).rejects.toThrow(RpcException);
    });

    it('should throw BAD_REQUEST if invite not found', async () => {
      (inviteRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.joinWorkspace(dto)).rejects.toThrow(RpcException);
    });
  });

  describe('leaveWorkspace', () => {
    const dto = { workspaceId: 'ws-id', userId: 'user-id' };
    const member = {
      userId: 'user-id',
      role: WorkspaceRoleEnum.MEMBER,
      status: MembershipStatus.ACTIVE,
    };

    it('should leave workspace successfully', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue(member);
      (memberRepo.save as jest.Mock).mockResolvedValue({
        ...member,
        status: MembershipStatus.REMOVED,
      });

      const result = await service.leaveWorkspace(dto);

      expect(result).toBe('Left workspace successfully');
    });

    it('should throw FORBIDDEN if owner tries to leave', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue({
        ...member,
        role: WorkspaceRoleEnum.OWNER,
      });

      await expect(service.leaveWorkspace(dto)).rejects.toThrow(RpcException);
    });

    it('should throw NOT_FOUND if member not found', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.leaveWorkspace(dto)).rejects.toThrow(RpcException);
    });
  });

  describe('changeRole', () => {
    const dto = {
      workspaceId: 'ws-id',
      adminUserId: 'admin-id',
      targetUserId: 'target-id',
      newRole: WorkspaceRoleEnum.ADMIN,
    };
    const adminMember = {
      userId: 'admin-id',
      role: WorkspaceRoleEnum.OWNER,
      status: MembershipStatus.ACTIVE,
    };
    const targetMember = {
      userId: 'target-id',
      role: WorkspaceRoleEnum.MEMBER,
      status: MembershipStatus.ACTIVE,
    };

    it('should change role successfully', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(adminMember);
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(targetMember);
      (memberRepo.save as jest.Mock).mockResolvedValue({
        ...targetMember,
        role: WorkspaceRoleEnum.ADMIN,
      });

      const result = await service.changeRole(dto);

      expect(result.role).toBe(WorkspaceRoleEnum.ADMIN);
    });

    it('should throw FORBIDDEN if admin has no permission', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce({
        ...adminMember,
        role: WorkspaceRoleEnum.MEMBER,
      });

      await expect(service.changeRole(dto)).rejects.toThrow(RpcException);
    });

    it('should throw FORBIDDEN if target is owner', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(adminMember);
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce({
        ...targetMember,
        role: WorkspaceRoleEnum.OWNER,
      });

      await expect(service.changeRole(dto)).rejects.toThrow(RpcException);
    });
  });

  describe('transferOwnership', () => {
    const dto = {
      workspaceId: 'ws-id',
      ownerUserId: 'owner-id',
      targetUserId: 'target-id',
    };
    const ownerMember = {
      userId: 'owner-id',
      role: WorkspaceRoleEnum.OWNER,
      status: MembershipStatus.ACTIVE,
    };
    const targetMember = {
      userId: 'target-id',
      role: WorkspaceRoleEnum.MEMBER,
      status: MembershipStatus.ACTIVE,
    };

    it('should transfer ownership successfully', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(ownerMember);
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(targetMember);

      const result = await service.transferOwnership(dto);

      expect(result).toBe('Ownership transferred successfully');
      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it('should throw FORBIDDEN if not the current owner', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.transferOwnership(dto)).rejects.toThrow(
        RpcException,
      );
    });

    it('should throw NOT_FOUND if target member not found', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(ownerMember);
      (memberRepo.findOne as jest.Mock).mockResolvedValueOnce(null);

      await expect(service.transferOwnership(dto)).rejects.toThrow(
        RpcException,
      );
    });
  });

  describe('deleteWorkspace', () => {
    const dto = { workspaceId: 'ws-id', ownerUserId: 'owner-id' };
    const ownerMember = {
      userId: 'owner-id',
      role: WorkspaceRoleEnum.OWNER,
      status: MembershipStatus.ACTIVE,
    };
    const workspace = { id: 'ws-id', name: 'Test' };

    it('should delete workspace successfully', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue(ownerMember);
      (workspaceRepo.findOne as jest.Mock).mockResolvedValue(workspace);
      (workspaceRepo.save as jest.Mock).mockResolvedValue({
        ...workspace,
        deletedAt: new Date(),
      });

      const result = await service.deleteWorkspace(dto);

      expect(result).toBe('Workspace deleted successfully');
      expect(workspaceRepo.save).toHaveBeenCalled();
    });

    it('should throw FORBIDDEN if not the owner', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue({
        ...ownerMember,
        role: WorkspaceRoleEnum.MEMBER,
      });

      await expect(service.deleteWorkspace(dto)).rejects.toThrow(RpcException);
    });

    it('should throw NOT_FOUND if workspace already deleted or not found', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue(ownerMember);
      (workspaceRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteWorkspace(dto)).rejects.toThrow(RpcException);
    });
  });

  describe('resendInvite', () => {
    const dto = { inviteId: 'invite-id', adminUserId: 'admin-id' };
    const invite = {
      id: 'invite-id',
      workspaceId: 'ws-id',
      email: 'test@example.com',
    };
    const adminMember = {
      userId: 'admin-id',
      role: WorkspaceRoleEnum.ADMIN,
      status: MembershipStatus.ACTIVE,
    };

    it('should resend invite successfully', async () => {
      (inviteRepo.findOne as jest.Mock).mockResolvedValue(invite);
      (memberRepo.findOne as jest.Mock).mockResolvedValue(adminMember);
      (inviteRepo.save as jest.Mock).mockResolvedValue({
        ...invite,
        tokenHash: 'new-token',
      });

      const result = await service.resendInvite(dto);

      expect(result).toBeDefined();
      expect(notificationClient.emit).toHaveBeenCalled();
    });

    it('should throw NOT_FOUND if invite not found', async () => {
      (inviteRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.resendInvite(dto)).rejects.toThrow(RpcException);
    });

    it('should throw FORBIDDEN if no permission', async () => {
      (inviteRepo.findOne as jest.Mock).mockResolvedValue(invite);
      (memberRepo.findOne as jest.Mock).mockResolvedValue({
        ...adminMember,
        role: WorkspaceRoleEnum.MEMBER,
      });

      await expect(service.resendInvite(dto)).rejects.toThrow(RpcException);
    });
  });

  describe('revokeInvite', () => {
    const dto = { inviteId: 'invite-id', adminUserId: 'admin-id' };
    const invite = { id: 'invite-id', workspaceId: 'ws-id' };
    const adminMember = {
      userId: 'admin-id',
      role: WorkspaceRoleEnum.ADMIN,
      status: MembershipStatus.ACTIVE,
    };

    it('should revoke invite successfully', async () => {
      (inviteRepo.findOne as jest.Mock).mockResolvedValue(invite);
      (memberRepo.findOne as jest.Mock).mockResolvedValue(adminMember);
      (inviteRepo.save as jest.Mock).mockResolvedValue({
        ...invite,
        status: InviteStatus.REVOKED,
      });

      const result = await service.revokeInvite(dto);

      expect(result).toBe('Invitation revoked successfully');
    });

    it('should throw NOT_FOUND if invite not found', async () => {
      (inviteRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.revokeInvite(dto)).rejects.toThrow(RpcException);
    });

    it('should throw FORBIDDEN if no permission', async () => {
      (inviteRepo.findOne as jest.Mock).mockResolvedValue(invite);
      (memberRepo.findOne as jest.Mock).mockResolvedValue({
        ...adminMember,
        role: WorkspaceRoleEnum.MEMBER,
      });

      await expect(service.revokeInvite(dto)).rejects.toThrow(RpcException);
    });
  });

  describe('generateLink', () => {
    const dto = { workspaceId: 'ws-id', adminUserId: 'admin-id' };
    const adminMember = {
      userId: 'admin-id',
      role: WorkspaceRoleEnum.ADMIN,
      status: MembershipStatus.ACTIVE,
    };
    const link = { id: 'link-id', workspaceId: 'ws-id', tokenHash: 'token' };

    it('should generate link successfully', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue(adminMember);
      (linkRepo.save as jest.Mock).mockResolvedValue(link);

      const result = await service.generateLink(dto);

      expect(result).toBeDefined();
      expect(linkRepo.save).toHaveBeenCalled();
    });

    it('should throw FORBIDDEN if no permission', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue({
        ...adminMember,
        role: WorkspaceRoleEnum.MEMBER,
      });

      await expect(service.generateLink(dto)).rejects.toThrow(RpcException);
    });

    it('should propagate repository errors', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue(adminMember);
      (linkRepo.save as jest.Mock).mockRejectedValue(new Error('DB Error'));

      await expect(service.generateLink(dto)).rejects.toThrow('DB Error');
    });
  });

  describe('joinLink', () => {
    const dto = { token: 'token', userId: 'user-id' };
    const link = {
      workspaceId: 'ws-id',
      tokenHash: 'token',
      status: WorkspaceLinkStatus.ACTIVE,
      expiresAt: new Date(Date.now() + 10000),
      usedCount: 0,
      maxUsage: 10,
    };

    it('should join link successfully', async () => {
      (linkRepo.findOne as jest.Mock).mockResolvedValue(link);
      (memberRepo.findOne as jest.Mock).mockResolvedValue(null);
      (memberRepo.create as jest.Mock).mockReturnValue({ userId: 'user-id' });

      const result = await service.joinLink(dto);

      expect(result).toBeDefined();
      expect(mockDataSource.transaction).toHaveBeenCalled();
    });

    it('should throw BAD_REQUEST if link expired', async () => {
      (linkRepo.findOne as jest.Mock).mockResolvedValue({
        ...link,
        status: WorkspaceLinkStatus.EXPIRED,
      });

      await expect(service.joinLink(dto)).rejects.toThrow(RpcException);
    });

    it('should throw CONFLICT if already a member', async () => {
      (linkRepo.findOne as jest.Mock).mockResolvedValue(link);
      (memberRepo.findOne as jest.Mock).mockResolvedValue({
        userId: 'user-id',
      });

      await expect(service.joinLink(dto)).rejects.toThrow(RpcException);
    });
  });

  describe('disableLink', () => {
    const dto = {
      workspaceId: 'ws-id',
      adminUserId: 'admin-id',
      linkId: 'link-id',
    };
    const adminMember = {
      userId: 'admin-id',
      role: WorkspaceRoleEnum.ADMIN,
      status: MembershipStatus.ACTIVE,
    };
    const link = { id: 'link-id', workspaceId: 'ws-id' };

    it('should disable link successfully', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue(adminMember);
      (linkRepo.findOne as jest.Mock).mockResolvedValue(link);

      const result = await service.disableLink(dto);

      expect(result).toBe('Link disabled successfully');
      expect(linkRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: WorkspaceLinkStatus.EXPIRED }),
      );
    });

    it('should throw NOT_FOUND if link not found', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue(adminMember);
      (linkRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.disableLink(dto)).rejects.toThrow(RpcException);
    });

    it('should throw FORBIDDEN if no permission', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue({
        ...adminMember,
        role: WorkspaceRoleEnum.MEMBER,
      });

      await expect(service.disableLink(dto)).rejects.toThrow(RpcException);
    });
  });

  describe('deleteLink', () => {
    const dto = {
      workspaceId: 'ws-id',
      adminUserId: 'admin-id',
      linkId: 'link-id',
    };
    const adminMember = {
      userId: 'admin-id',
      role: WorkspaceRoleEnum.ADMIN,
      status: MembershipStatus.ACTIVE,
    };
    const link = { id: 'link-id', workspaceId: 'ws-id' };

    it('should delete link successfully', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue(adminMember);
      (linkRepo.findOne as jest.Mock).mockResolvedValue(link);

      const result = await service.deleteLink(dto);

      expect(result).toBe('Link deleted successfully');
      expect(linkRepo.remove).toHaveBeenCalled();
    });

    it('should throw NOT_FOUND if link not found', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue(adminMember);
      (linkRepo.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteLink(dto)).rejects.toThrow(RpcException);
    });

    it('should throw FORBIDDEN if no permission', async () => {
      (memberRepo.findOne as jest.Mock).mockResolvedValue({
        ...adminMember,
        role: WorkspaceRoleEnum.MEMBER,
      });

      await expect(service.deleteLink(dto)).rejects.toThrow(RpcException);
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
    });

    it('should return empty list if user has no memberships', async () => {
      (memberRepo.find as jest.Mock).mockResolvedValue([]);
      (workspaceRepo.find as jest.Mock).mockResolvedValue([]);

      const result = await service.getListWorkspaceOfUser(userId);

      expect(result).toHaveLength(0);
    });

    it('should filter out deleted workspaces (already handled by query)', async () => {
      (memberRepo.find as jest.Mock).mockResolvedValue(members);
      (workspaceRepo.find as jest.Mock).mockResolvedValue([workspaces[0]]);

      const result = await service.getListWorkspaceOfUser(userId);

      expect(result).toHaveLength(1);
    });
  });
});
