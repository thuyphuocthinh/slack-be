import { WorkspaceRoleEnum } from '@slack/constants';

export class CreateWorkspaceRequestDto {
  name: string;
  description?: string;
  ownerUserId: string;
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
