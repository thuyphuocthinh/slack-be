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

