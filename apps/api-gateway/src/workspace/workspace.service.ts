import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  CHANNEL_MESSAGE_PATTERN,
  NAME_SERVICE_TCP,
  NOTIFICATION_MESSAGE_PATTERNS,
  WORKSPACE_MESSAGE_PATTERNS,
} from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
import {
  CreateWorkspaceRequestDto,
  InviteMemberRequestDto,
  AddMemberRequestDto,
  RemoveMemberRequestDto,
  JoinWorkspaceRequestDto,
  LeaveWorkspaceRequestDto,
  ChangeRoleRequestDto,
  TransferOwnershipRequestDto,
  DeleteWorkspaceRequestDto,
  ResendInviteRequestDto,
  RevokeInviteRequestDto,
  GenerateLinkRequestDto,
  JoinLinkRequestDto,
  DisableLinkRequestDto,
  DeleteLinkRequestDto,
  UpdateWorkspaceRequestDto,
  AddBatchMembersRequestDto,
  GetWorkspacesRequestDto,
  CreateAppRequestDto,
  UpdateAppRequestDto,
  DeleteAppRequestDto,
  GetAppsRequestDto,
  InvokeCommandRequestDto,
} from './dto/workspace-request.dto';

@Injectable()
export class WorkspaceService {
  constructor(
    @Inject(NAME_SERVICE_TCP.WORKSPACE_SERVICE)
    private readonly workspaceClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.NOTIFICATION_SERVICE)
    private readonly notificationClient: ClientProxy,
  ) { }

  async getSidebarSummary(workspaceId: string, userId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      async () => {
        const [channelSummary, notificationSummary] = await Promise.all([
          firstValueFrom(
            this.channelClient.send(CHANNEL_MESSAGE_PATTERN.GET_UNREAD_SUMMARY, {
              workspaceId,
              memberId: userId,
            }),
          ),
          firstValueFrom(
            this.notificationClient.send(
              NOTIFICATION_MESSAGE_PATTERNS.GET_UNREAD_SUMMARY,
              { userId, workspaceId },
            ),
          ),
        ]);

        return {
          home: {
            hasUnread: channelSummary.hasUnreadChannels,
            mentionCount: 0, // Placeholder until mention tracking is implemented
          },
          dms: {
            count: channelSummary.unreadDmCount,
          },
          activity: {
            hasUnread: notificationSummary.unreadAll > 0,
          },
          tasks: {
            hasUnread: false, // Placeholder for tasks
          },
        };
      },
      'getSidebarSummary',
      'WorkspaceService',
    );
  }

  async createWorkspace(data: CreateWorkspaceRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.CREATE_WORKSPACE,
            data,
          ),
        ),
      'createWorkspace',
      'WorkspaceService',
    );
  }

  async getWorkspaces(data: GetWorkspacesRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.GET_WORKSPACES,
            data,
          ),
        ),
      'getWorkspaces',
      'WorkspaceService',
    );
  }

  async getWorkspace(workspaceId: string, userId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_WORKSPACE, {
            workspaceId,
            userId,
          }),
        ),
      'getWorkspace',
      'WorkspaceService',
    );
  }

  async deleteWorkspace(data: DeleteWorkspaceRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.DELETE_WORKSPACE,
            data,
          ),
        ),
      'deleteWorkspace',
      'WorkspaceService',
    );
  }

  async inviteMember(data: InviteMemberRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.INVITE_MEMBER,
            data,
          ),
        ),
      'inviteMember',
      'WorkspaceService',
    );
  }

  async acceptInvite(data: JoinWorkspaceRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.ACCEPT_INVITE,
            data,
          ),
        ),
      'acceptInvite',
      'WorkspaceService',
    );
  }

  async addMemberDirect(data: AddMemberRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.ADD_MEMBER_DIRECT,
            data,
          ),
        ),
      'addMemberDirect',
      'WorkspaceService',
    );
  }

  async addBatchMembers(data: AddBatchMembersRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.ADD_BATCH_MEMBERS,
            data,
          ),
        ),
      'addBatchMembers',
      'WorkspaceService',
    );
  }

  async removeMember(data: RemoveMemberRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.REMOVE_MEMBER,
            data,
          ),
        ),
      'removeMember',
      'WorkspaceService',
    );
  }

  async leaveWorkspace(data: LeaveWorkspaceRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.LEAVE, data),
        ),
      'leaveWorkspace',
      'WorkspaceService',
    );
  }

  async changeRole(data: ChangeRoleRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.CHANGE_ROLE,
            data,
          ),
        ),
      'changeRole',
      'WorkspaceService',
    );
  }

  async transferOwnership(data: TransferOwnershipRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.TRANSFER_OWNERSHIP,
            data,
          ),
        ),
      'transferOwnership',
      'WorkspaceService',
    );
  }

  async resendInvite(data: ResendInviteRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.RESEND_INVITE,
            data,
          ),
        ),
      'resendInvite',
      'WorkspaceService',
    );
  }

  async revokeInvite(data: RevokeInviteRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.REVOKE_INVITE,
            data,
          ),
        ),
      'revokeInvite',
      'WorkspaceService',
    );
  }

  async createLink(data: GenerateLinkRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.CREATE_LINK,
            data,
          ),
        ),
      'createLink',
      'WorkspaceService',
    );
  }

  async disableLink(data: DisableLinkRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.DISABLE_LINK,
            data,
          ),
        ),
      'disableLink',
      'WorkspaceService',
    );
  }

  async getLinks(userId: string, workspaceId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_LINKS, {
            workspaceId,
            userId,
          }),
        ),
      'getLinks',
      'WorkspaceService',
    );
  }

  async joinLink(data: JoinLinkRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.JOIN_LINK,
            data,
          ),
        ),
      'joinLink',
      'WorkspaceService',
    );
  }

  async deleteLink(data: DeleteLinkRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.DELETE_LINK,
            data,
          ),
        ),
      'deleteLink',
      'WorkspaceService',
    );
  }

  async getMembers(workspaceId: string, userId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBERS, {
            workspaceId,
            userId,
          }),
        ),
      'getMembers',
      'WorkspaceService',
    );
  }

  async updateWorkspace(data: UpdateWorkspaceRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.UPDATE_WORKSPACE,
            data,
          ),
        ),
      'updateWorkspace',
      'WorkspaceService',
    );
  }

  async checkPermission(
    workspaceId: string,
    userId: string,
    allowedRoles: string[],
  ) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.CHECK_PERMISSION,
            {
              workspaceId,
              userId,
              allowedRoles,
            },
          ),
        ),
      'checkPermission',
      'WorkspaceService',
    );
  }

  async getMember(workspaceId: string, userId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER, {
            workspaceId,
            userId,
          }),
        ),
      'getMember',
      'WorkspaceService',
    );
  }

  async getMemberDetail(workspaceId: string, memberId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(
            WORKSPACE_MESSAGE_PATTERNS.GET_MEMBER_DETAIL,
            {
              workspaceId,
              userId: memberId,
            },
          ),
        ),
      'getMemberDetail',
      'WorkspaceService',
    );
  }

  async createApp(data: CreateAppRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.CREATE_APP, data),
        ),
      'createApp',
      'WorkspaceService',
    );
  }

  async updateApp(data: UpdateAppRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.UPDATE_APP, data),
        ),
      'updateApp',
      'WorkspaceService',
    );
  }

  async deleteApp(data: DeleteAppRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.DELETE_APP, data),
        ),
      'deleteApp',
      'WorkspaceService',
    );
  }

  async getApps(data: GetAppsRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.GET_APPS, data),
        ),
      'getApps',
      'WorkspaceService',
    );
  }

  async invokeAppCommand(data: InvokeCommandRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.workspaceClient.send(WORKSPACE_MESSAGE_PATTERNS.INVOKE_APP_COMMAND, data),
        ),
      'invokeAppCommand',
      'WorkspaceService',
    );
  }
}
