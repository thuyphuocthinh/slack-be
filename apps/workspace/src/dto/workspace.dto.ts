import {
  WorkspaceRoleEnum,
  MembershipStatus,
  InviteStatus,
  WorkspaceLinkType,
  WorkspaceLinkStatus,
} from '../types/workspace.enum';

export class WorkspaceDto {
  id: string;
  name: string;
  slug: string;
  description?: string;
  logo?: string;
  createdAt: Date;
  updatedAt: Date;
}

export class WorkspaceMemberDto {
  workspaceId: string;
  userId: string;
  role: WorkspaceRoleEnum;
  status: MembershipStatus;
  joinedAt: Date;
  createdAt: Date;

  // User profile fields
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
  systemRole?: string | null;
}

export class WorkspaceInviteDto {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRoleEnum;
  status: InviteStatus;
  invitedBy: string;
  expiresAt: Date;
  createdAt: Date;
}

export class WorkspaceLinkDto {
  id: string;
  workspaceId: string;
  token: string;
  type: WorkspaceLinkType;
  status: WorkspaceLinkStatus;
  maxUsage?: number;
  usedCount: number;
  expiresAt?: Date;
  createdAt: Date;
}
