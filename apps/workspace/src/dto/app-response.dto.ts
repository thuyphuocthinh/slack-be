import { AppEntity } from '../entity/app.entity';
import { AppStatus } from '../types/app.enum';

export class AppResponseDto {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  avatarUrl: string;
  requestUrl: string;
  status: AppStatus;
  signingSecret?: string;
  botToken?: string;
  createdAt: Date;
  updatedAt: Date;
}

export function mapAppToDto(app: AppEntity): AppResponseDto {
  return {
    id: app.id,
    workspaceId: app.workspaceId,
    name: app.name,
    description: app.description,
    avatarUrl: app.avatarUrl,
    requestUrl: app.requestUrl,
    status: app.status,
    signingSecret: app.signingSecret,
    botToken: app.botToken,
    createdAt: app.createdAt,
    updatedAt: app.updatedAt,
  };
}
