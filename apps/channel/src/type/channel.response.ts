import { ChannelTypeEnum } from "@slack/constants";

export interface ChannelResponse {
    id: string;
    name: string;
    description: string | null;
    type: ChannelTypeEnum;
    createdAt: Date;
    isStar: boolean;
    workspaceId: string;
    unreadCount?: number;
    lastReadAt?: Date;
}

export interface ChannelMemberResponse {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
}

