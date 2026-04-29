import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ChannelMessagePattern, NAME_SERVICE_TCP } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import {
  AddBatchMembersRequestDto,
  ChannelMemberRequestDto,
  CreateChannelRequestDto,
  GetChannelsRequestDto,
  RemoveMemberRequestDto,
  ToggleStarRequestDto,
  UpdateChannelRequestDto,
} from './dto/channel-request.dto';

@Injectable()
export class ChannelService {
  private readonly logger = new Logger(ChannelService.name);
  private membersCache = new Map<string, { data: any, expiry: number }>();

  constructor(
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
  ) { }

  async createChannel(dto: CreateChannelRequestDto) {
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.CREATE_CHANNEL, dto),
    );
  }

  async updateChannel(dto: UpdateChannelRequestDto) {
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.UPDATE_CHANNEL, dto),
    );
  }

  async deleteChannel(channelId: string, memberId: string) {
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.DELETE_CHANNEL, {
        channelId,
        memberId,
      }),
    );
  }

  async getChannels(dto: GetChannelsRequestDto) {
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.GET_CHANNELS, dto),
    );
  }

  async getChannel(channelId: string, memberId: string) {
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.GET_CHANNEL, {
        channelId,
        memberId,
      }),
    );
  }

  async toggleStar(dto: ToggleStarRequestDto) {
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.TOGGLE_STAR, dto),
    );
  }

  async addMember(dto: ChannelMemberRequestDto) {
    this.membersCache.delete(dto.channelId);
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.ADD_MEMBER, dto),
    );
  }

  async addBatchMembers(dto: AddBatchMembersRequestDto) {
    this.membersCache.delete(dto.channelId);
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.ADD_BATCH_MEMBERS, dto),
    );
  }

  async removeMember(dto: RemoveMemberRequestDto) {
    this.membersCache.delete(dto.channelId);
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.REMOVE_MEMBER, dto),
    );
  }

  async getMembers(channelId: string) {
    const cached = this.membersCache.get(channelId);
    const now = Date.now();

    if (cached && cached.expiry > now) {
      return cached.data;
    }

    const data = await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.GET_MEMBERS, { channelId }),
    );

    // Cache for 2 seconds
    this.membersCache.set(channelId, {
      data,
      expiry: now + 2000
    });

    return data;
  }

  async leaveChannel(channelId: string, memberId: string) {
    this.membersCache.delete(channelId);
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.LEAVE_CHANNEL, {
        channelId,
        memberId,
      }),
    );
  }
}

