export enum WorkspaceRoleEnum {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
}

export enum WorkspaceLinkStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
  EXPIRED = 'expired',
}

export enum WorkspaceLinkType {
  PUBLIC_INVITE = 'public_invite',
}

export enum InviteStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REVOKED = 'revoked',
  EXPIRED = 'expired',
}

export enum MembershipStatus {
  ACTIVE = 'active',
  REMOVED = 'removed',
}
