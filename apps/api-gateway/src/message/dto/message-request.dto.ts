interface MessageAttachment {
  id: string;
  publicId: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  type: string;
  thumbnailUrl?: string;
}

export class CreateMessageRequestDto {
  channelId: string;
  senderId: string;
  content?: string;
  mentions?: string[];
  parentId?: string;
  attachments?: MessageAttachment[];
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
  content: string | Record<string, unknown>[];
  attachments?: MessageAttachment[];
  mentions?: string[];
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

export class GetPinnedMessagesRequestDto {
  channelId: string;
  userId: string;
  cursor?: string;
  limit?: number;
}

export class GetSurroundingMessagesRequestDto {
  channelId: string;
  userId: string;
  targetMessageId: string;
  limit?: number;
}
