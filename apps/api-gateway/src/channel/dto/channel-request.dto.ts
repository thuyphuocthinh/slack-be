import { ChannelTypeEnum } from '@slack/constants';
import { MemberInfoDto } from './channel-api.dto';

export class CreateChannelRequestDto {
  workspaceId: string;
  title: string;
  type?: ChannelTypeEnum;
  description?: string;
  memberId: string;
}

export class UpdateChannelRequestDto {
  channelId: string;
  memberId: string;
  title?: string;
  description?: string;
}

export class GetChannelsRequestDto {
  workspaceId: string;
  memberId: string;
  type?: ChannelTypeEnum;
  page?: number;
  limit?: number;
}

export class ChannelMemberRequestDto {
  channelId: string;
  targetMember: MemberInfoDto;
  performerId: string;
}

export class RemoveMemberRequestDto {
  channelId: string;
  targetMemberId: string;
  performerId: string;
}

export class AddBatchMembersRequestDto {
  channelId: string;
  targetMembers: MemberInfoDto[];
  performerId: string;
}

export class ToggleStarRequestDto {
  channelId: string;
  memberId: string;
}
