import { WorkspaceRoleEnum } from '@slack/constants';

export class CreateWorkspaceRequestDto {
  name: string;
  description?: string;
  ownerUserId: string;
}

export class UpdateWorkspaceRequestDto {
  workspaceId: string;
  name?: string;
  description?: string;
  logo?: string;
  updatedBy: string;
}

export class InviteMemberRequestDto {
  workspaceId: string;
  email: string;
  role: WorkspaceRoleEnum;
  invitedBy: string;
}

export class AddMemberRequestDto {
  workspaceId: string;
  userId: string;
  role: WorkspaceRoleEnum;
  adminUserId: string;
}

export class AddBatchMembersRequestDto {
  workspaceId: string;
  userIds: string[];
  role: WorkspaceRoleEnum;
  adminUserId: string;
}

export class RemoveMemberRequestDto {
  workspaceId: string;
  targetUserId: string;
  adminUserId: string;
}

export class JoinWorkspaceRequestDto {
  token: string;
  userId: string;
}

export class LeaveWorkspaceRequestDto {
  workspaceId: string;
  userId: string;
}

export class ChangeRoleRequestDto {
  workspaceId: string;
  targetUserId: string;
  newRole: WorkspaceRoleEnum;
  adminUserId: string;
}

export class TransferOwnershipRequestDto {
  workspaceId: string;
  targetUserId: string;
  ownerUserId: string;
}

export class DeleteWorkspaceRequestDto {
  workspaceId: string;
  ownerUserId: string;
}

export class ResendInviteRequestDto {
  inviteId: string;
  adminUserId: string;
}

export class RevokeInviteRequestDto {
  inviteId: string;
  adminUserId: string;
}

export class GenerateLinkRequestDto {
  workspaceId: string;
  maxUsage?: number;
  adminUserId: string;
}

export class JoinLinkRequestDto {
  token: string;
  userId: string;
}

export class DisableLinkRequestDto {
  workspaceId: string;
  linkId: string;
  adminUserId: string;
}

export class DeleteLinkRequestDto {
  workspaceId: string;
  linkId: string;
  adminUserId: string;
}

export class GetWorkspacesRequestDto {
  userId: string;
  page?: number;
  limit?: number;
}

export class CreateAppRequestDto {
  workspaceId: string;
  name: string;
  description?: string;
  avatarUrl?: string;
  requestUrl?: string;
  eventTypes?: string[];
  userId: string;
}

export class UpdateAppRequestDto {
  workspaceId: string;
  appId: string;
  name?: string;
  description?: string;
  avatarUrl?: string;
  requestUrl?: string;
  eventTypes?: string[];
  status?: string;
  userId: string;
}

export class DeleteAppRequestDto {
  workspaceId: string;
  appId: string;
  userId: string;
}

export class GetAppsRequestDto {
  workspaceId: string;
  userId: string;
}

export class InvokeCommandRequestDto {
  appId: string;
  workspaceId: string;
  channelId: string;
  userId: string;
  command: string;
  text?: string;
}

export class SubmitViewRequestDto {
  userId: string;
  workspaceId: string;
  appId: string;
  viewId: string;
  values: Record<string, any>;
}

export class UpdateWorkspaceSsoConfigRequestDto {
  workspaceId: string;
  adminUserId: string;
  domain: string;
  providerType: 'SAML2' | 'OIDC';
  entryPoint?: string;
  idpCert?: string;
  issuer?: string;
  clientId?: string;
  clientSecret?: string;
  discoveryUrl?: string;
}

