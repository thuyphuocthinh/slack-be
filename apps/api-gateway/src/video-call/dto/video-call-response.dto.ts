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

export class WebhookResponseDto {
  success: boolean;
  message?: string;
  error?: string;
}

export class StartRecordingResponseDto {
  egressId: string;
}

export class StopRecordingResponseDto {
  videoUrl: string;
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
