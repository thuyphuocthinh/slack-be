import { ChannelTypeEnum } from '@slack/constants';

export interface ChannelResponse {
  id: string;
  name: string | null;
  description: string | null;
  type: ChannelTypeEnum;
  createdAt: Date;
  isStar: boolean;
  workspaceId: string;
  memberIds?: string[];
  unreadCount?: number;
  lastReadAt?: Date;
  lastReadMessageId?: string | null;
}

export interface ChannelMemberResponse {
  memberId: string;
}
