import { SetMetadata } from '@nestjs/common';

export const SYSTEM_ROLES_KEY = 'system_roles';
export const WORKSPACE_ROLES_KEY = 'workspace_roles';
export const SystemRoles = (...roles: string[]) =>
  SetMetadata(SYSTEM_ROLES_KEY, roles);
export const WorkspaceRoles = (...roles: string[]) =>
  SetMetadata(WORKSPACE_ROLES_KEY, roles);
