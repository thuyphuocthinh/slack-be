export class ReactionResponseDto {
  emoji: string;
  count: number;
  userIds: string[];
}

export class MentionResponseDto {
  userId: string;
}

export class UserResponseDto {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string;
  email: string;
}

import { IMessageAttachment } from '../types/message-attachment.interface';

export class MessageResponseDto {
  id: string;
  channelId: string;
  sender: UserResponseDto;
  content: string | Record<string, unknown> | Record<string, unknown>[];
  attachments: IMessageAttachment[];
  isPinned: boolean;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  reactions: ReactionResponseDto[] | [];
  mentions: MentionResponseDto[] | [];
  replyCount: number;
}

export class ThreadResponseDto {
  messages: MessageResponseDto[];
  nextCursor?: string;
}

export class SurroundingMessageResponseDto {
  messages: MessageResponseDto[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}