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

export class JoinHuddleResponseDto {
  token: string;
  huddleId: string;
  livekitUrl: string;
  roomName: string;
}

export class LeaveHuddleResponseDto {
  success: boolean;
  huddleId: string;
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

export class WebhookResponseDto {
  success: boolean;
  message?: string;
  error?: string;
}

export interface ChannelMemberInfo {
  memberId: string;
}

export class StartRecordingRequestDto {
  huddleId: string;
  roomName: string;
}

export class StartRecordingResponseDto {
  egressId: string;
}

export class StopRecordingRequestDto {
  huddleId: string;
}

export class StopRecordingResponseDto {
  videoUrl: string;
}

export class GetRecordingsQueryDto {
  page?: number;
  limit?: number;
}

export class GetRecordingsRequestDto {
  channelId: string;
  query: GetRecordingsQueryDto;
}

export class HuddleRecordingResponseDto {
  id: string;
  channelId: string;
  isActive: boolean;
  startedAt: Date;
  endedAt?: Date | null;
  isRecording: boolean;
  videoRecordUrl?: string | null;
}

export class HuddleRecordingsResponseDto {
  data: HuddleRecordingResponseDto[];
  paging: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
