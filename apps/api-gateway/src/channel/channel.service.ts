import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CHANNEL_MESSAGE_PATTERN, NAME_SERVICE_TCP } from '@slack/constants';
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
import {
  CreateWebhookRequestDto,
  UpdateWebhookRequestDto,
  GetWebhooksRequestDto,
  DeleteWebhookRequestDto,
} from './dto/webhook-request.dto';

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
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.CREATE_CHANNEL, dto),
    );
  }

  async findDirectChannel(workspaceId: string, allMemberIds: string[]) {
    return await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.FIND_DIRECT_CHANNEL, {
        workspaceId,
        allMemberIds,
      }),
    );
  }

  async updateChannel(dto: UpdateChannelRequestDto) {
    return await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.UPDATE_CHANNEL, dto),
    );
  }

  async deleteChannel(channelId: string, memberId: string) {
    return await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.DELETE_CHANNEL, {
        channelId,
        memberId,
      }),
    );
  }

  async getChannels(dto: GetChannelsRequestDto) {
    return await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.GET_CHANNELS, dto),
    );
  }

  async getChannel(channelId: string, memberId: string) {
    return await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.GET_CHANNEL, {
        channelId,
        memberId,
      }),
    );
  }

  async toggleStar(dto: ToggleStarRequestDto) {
    return await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.TOGGLE_STAR, dto),
    );
  }

  async addMember(dto: ChannelMemberRequestDto) {
    this.membersCache.delete(dto.channelId);
    return await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.ADD_MEMBER, dto),
    );
  }

  async addBatchMembers(dto: AddBatchMembersRequestDto) {
    this.membersCache.delete(dto.channelId);
    return await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.ADD_BATCH_MEMBERS, dto),
    );
  }

  async removeMember(dto: RemoveMemberRequestDto) {
    this.membersCache.delete(dto.channelId);
    return await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.REMOVE_MEMBER, dto),
    );
  }

  async getMembers(channelId: string) {
    const cached = this.membersCache.get(channelId);
    const now = Date.now();

    if (cached && cached.expiry > now) {
      return cached.data;
    }

    const data = await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.GET_MEMBERS, { channelId }),
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
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.LEAVE_CHANNEL, {
        channelId,
        memberId,
      }),
    );
  }

  async createWebhook(dto: CreateWebhookRequestDto) {
    return await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.WEBHOOK_CREATE, dto),
    );
  }

  async getWebhooks(dto: GetWebhooksRequestDto) {
    return await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.WEBHOOK_LIST, dto),
    );
  }

  async updateWebhook(dto: UpdateWebhookRequestDto) {
    return await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.WEBHOOK_UPDATE, dto),
    );
  }

  async deleteWebhook(dto: DeleteWebhookRequestDto) {
    return await firstValueFrom(
      this.channelClient.send(CHANNEL_MESSAGE_PATTERN.WEBHOOK_DELETE, dto),
    );
  }
}
