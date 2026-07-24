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
  isApp?: boolean;
  isBot?: boolean;
}

import { IMessageAttachment } from '../types/message-attachment.interface';
import { ILinkPreviewMetadata } from '../types/link-preview.interface';
import { IToolCallTrace } from '../types/tool-call-trace.interface';

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
  // Trạng thái vote CỦA RIÊNG người đang xem — khác reactions (aggregate cho
  // mọi người thấy), feedback là tín hiệu riêng tư/theo viewer, chỉ tính được
  // khi caller cung cấp viewerUserId cho hydrateMessages() (hiện chỉ
  // getMessageById() làm — danh sách/tìm kiếm message không tính, để undefined).
  myFeedback?: 'like' | 'unlike' | null;
  linkPreviews?: ILinkPreviewMetadata[] | null;
  toolCalls?: IToolCallTrace[] | null;
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
