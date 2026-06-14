import { IsOptional, IsUUID, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { WorkspaceRoleEnum } from '../types/workspace.enum';

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
  @IsUUID()
  userId: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 20;
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

