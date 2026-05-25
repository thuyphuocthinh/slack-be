import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceInviteService } from './workspace-invite.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WorkspaceInviteEntity } from '../entity/workspace_invite.entity';
import { WorkspaceMemberEntity } from '../entity/workspace_member.entity';
import { DataSource, Repository } from 'typeorm';
import { ClientProxy } from '@nestjs/microservices';
import { WorkspaceRoleEnum } from '../types/workspace.enum';
import { NAME_SERVICE_TCP } from '@slack/constants';
import { CachedService } from '@slack/cached';
import { WorkspaceCommonService } from './workspace-common.service';
import * as rxjs from 'rxjs';

describe('WorkspaceInviteService', () => {
  let service: WorkspaceInviteService;
  let inviteRepo: Repository<WorkspaceInviteEntity>;
  let notificationClient: ClientProxy;

  const mockInviteRepo = () => ({
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
  });

  const mockMemberRepo = () => ({
    findOne: jest.fn(),
  });

  const mockNotificationClient = {
    emit: jest.fn(),
  };

  const mockUserClient = {
    send: jest.fn(),
  };

  const mockDataSource = {
    transaction: jest.fn((cb) =>
      cb({
        save: jest.fn(),
        create: jest.fn(),
      }),
    ),
  };

  const mockCachedService = {
    del: jest.fn(),
  };

  const mockCommonService = {
    checkPermission: jest.fn().mockResolvedValue(true),
    findWorkspaceById: jest.fn().mockResolvedValue({ name: 'Test WS' }),
    mapInviteToDto: jest.fn((i) => i),
    mapMemberToDto: jest.fn((m) => m),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceInviteService,
        {
          provide: getRepositoryToken(WorkspaceInviteEntity),
          useFactory: mockInviteRepo,
        },
        {
          provide: getRepositoryToken(WorkspaceMemberEntity),
          useFactory: mockMemberRepo,
        },
        {
          provide: NAME_SERVICE_TCP.NOTIFICATION_SERVICE,
          useValue: mockNotificationClient,
        },
        {
          provide: NAME_SERVICE_TCP.USER_SERVICE,
          useValue: mockUserClient,
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

    service = module.get<WorkspaceInviteService>(WorkspaceInviteService);
    inviteRepo = module.get(getRepositoryToken(WorkspaceInviteEntity));
    notificationClient = module.get(NAME_SERVICE_TCP.NOTIFICATION_SERVICE);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('inviteMember', () => {
    const dto = {
      workspaceId: 'ws-id',
      email: 'test@example.com',
      role: WorkspaceRoleEnum.MEMBER,
      invitedBy: 'admin-id',
    };
    const invite = { id: 'invite-id', ...dto };

    it('should invite member successfully', async () => {
      (mockUserClient.send as jest.Mock).mockReturnValue({
        toPromise: () => Promise.resolve({ id: 'user-id' }),
      });
      // In NestJS microservices, firstValueFrom is used, so we need to mock the return value of send
      // However, here I'm using a simpler mock for demonstration
      jest.spyOn(rxjs, 'firstValueFrom').mockResolvedValue({ id: 'user-id' });

      (inviteRepo.create as jest.Mock).mockReturnValue(invite);
      (inviteRepo.save as jest.Mock).mockResolvedValue(invite);

      const result = await service.inviteMember(dto);

      expect(result).toBeDefined();
      expect(notificationClient.emit).toHaveBeenCalled();
    });
  });
});
