export class JoinHuddleRequestDto {
  workspaceId: string;
  channelId: string;
  userId: string;
  identity: string;
  name: string;
}

export class LeaveHuddleRequestDto {
  huddleId: string;
  userId: string;
}

export class LiveKitWebhookRoom {
  sid: string;
  name: string;
  emptyTimeout?: number;
  maxParticipants?: number;
  creationTime?: number;
}

export class LiveKitWebhookParticipant {
  sid: string;
  identity: string;
  state?: string;
  joinedAt?: number;
}

export class LiveKitWebhookPayload {
  event: string;
  room?: LiveKitWebhookRoom;
  participant?: LiveKitWebhookParticipant;
}

export class HandleWebhookRequestDto {
  authHeader: string;
  body: LiveKitWebhookPayload;
}
