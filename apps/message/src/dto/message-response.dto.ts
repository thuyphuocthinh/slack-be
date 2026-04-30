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

export class MessageResponseDto {
  id: string;
  channelId: string;
  sender: UserResponseDto;
  content: string | Record<string, unknown>[];
  isPinned: boolean;
  parentId: string | null;
  createdAt: Date;
  updatedAt: Date;
  reactions: ReactionResponseDto[] | [];
  mentions: MentionResponseDto[] | [];
  replyCount: number;
}

export class ThreadResponseDto {
  threads: MessageResponseDto[];
  nextCursor?: string;
}
