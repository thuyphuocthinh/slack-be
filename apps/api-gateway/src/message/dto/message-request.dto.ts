export class CreateMessageRequestDto {
  channelId: string;
  senderId: string;
  content?: string;
  parentId?: string;
  attachments?: any[];
}

export class GetMessagesRequestDto {
  channelId: string;
  userId: string;
  cursor?: string;
  limit?: number;
  parentId?: string;
}

export class SearchMessagesRequestDto {
  channelId: string;
  senderId: string;
  query: string;
  page?: number;
  limit?: number;
}

export class UpdateMessageRequestDto {
  messageId: string;
  userId: string;
  content: string;
}

export class ToggleReactionRequestDto {
  messageId: string;
  userId: string;
  emoji: string;
}

export class GetThreadRequestDto {
  userId: string;
  cursor?: string;
  limit?: number;
}
