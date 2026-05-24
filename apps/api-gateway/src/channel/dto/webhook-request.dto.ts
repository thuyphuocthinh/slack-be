export class CreateWebhookRequestDto {
  workspaceId: string;
  channelId: string;
  userId: string;
  name?: string;
  description?: string;
  avatarUrl?: string;
}

export class UpdateWebhookRequestDto {
  workspaceId: string;
  channelId: string;
  webhookId: string;
  userId: string;
  name?: string;
  description?: string;
  avatarUrl?: string;
}

export class GetWebhooksRequestDto {
  workspaceId: string;
  channelId: string;
  userId: string;
}

export class DeleteWebhookRequestDto {
  workspaceId: string;
  channelId: string;
  webhookId: string;
  userId: string;
}
