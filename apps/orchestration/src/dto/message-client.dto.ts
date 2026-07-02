export class CreateOrchestrationMessageRequestDto {
  channelId: string;
  senderId: string;
  content: string;
}

export class CreateOrchestrationMessageResponseDto {
  id: string;
}

export class UpdateOrchestrationMessageRequestDto {
  id: string;
  userId: string;
  content: string;
  toolCalls?: { tool: string; status: 'success' | 'error' }[];
}

export class GetMessageTextRequestDto {
  id: string;
  userId: string;
}

export class GetRecentHistoryRequestDto {
  channelId: string;
  userId: string;
  // Chỉ lấy message TRƯỚC message này (không tính chính nó)
  beforeMessageId: string;
  limit: number;
}

export class ChatHistoryTurnDto {
  role: 'user' | 'model';
  text: string;
}
