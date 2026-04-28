import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { ChannelMessagePattern, NAME_SERVICE_TCP } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import {
  AddBatchMembersRequestDto,
  ChannelMemberRequestDto,
  CreateChannelRequestDto,
  GetChannelsRequestDto,
  ToggleStarRequestDto,
  UpdateChannelRequestDto,
} from './dto/channel-request.dto';

@Injectable()
export class ChannelService {
  private readonly logger = new Logger(ChannelService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
  ) {}

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
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.ADD_MEMBER, dto),
    );
  }

  async addBatchMembers(dto: AddBatchMembersRequestDto) {
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.ADD_BATCH_MEMBERS, dto),
    );
  }

  async removeMember(dto: ChannelMemberRequestDto) {
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.REMOVE_MEMBER, dto),
    );
  }

  async getMembers(channelId: string) {
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.GET_MEMBERS, { channelId }),
    );
  }

  async leaveChannel(channelId: string, memberId: string) {
    return await firstValueFrom(
      this.channelClient.send(ChannelMessagePattern.LEAVE_CHANNEL, {
        channelId,
        memberId,
      }),
    );
  }
}
