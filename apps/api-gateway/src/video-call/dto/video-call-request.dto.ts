import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

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

export class StartRecordingRequestDto {
  huddleId: string;
  roomName: string;
}

export class StopRecordingRequestDto {
  huddleId: string;
}

export class GetRecordingsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
