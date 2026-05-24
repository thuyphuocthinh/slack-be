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
