import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { CHANNEL_MESSAGE_PATTERN, NAME_SERVICE_TCP } from '@slack/constants';
import { firstValueFrom } from 'rxjs';
import { MicroserviceErrorHandler } from '../common/microservice_error.handler';
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
  private membersCache = new Map<string, { data: any; expiry: number }>();

  constructor(
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
  ) {}

  async createChannel(dto: CreateChannelRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.CREATE_CHANNEL, dto),
        ),
      'createChannel',
      'ChannelService',
    );
  }

  async findDirectChannel(workspaceId: string, allMemberIds: string[]) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.FIND_DIRECT_CHANNEL, {
            workspaceId,
            allMemberIds,
          }),
        ),
      'findDirectChannel',
      'ChannelService',
    );
  }

  async updateChannel(dto: UpdateChannelRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.UPDATE_CHANNEL, dto),
        ),
      'updateChannel',
      'ChannelService',
    );
  }

  async deleteChannel(channelId: string, memberId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.DELETE_CHANNEL, {
            channelId,
            memberId,
          }),
        ),
      'deleteChannel',
      'ChannelService',
    );
  }

  async getChannels(dto: GetChannelsRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.GET_CHANNELS, dto),
        ),
      'getChannels',
      'ChannelService',
    );
  }

  async getChannel(channelId: string, memberId: string) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.GET_CHANNEL, {
            channelId,
            memberId,
          }),
        ),
      'getChannel',
      'ChannelService',
    );
  }

  async toggleStar(dto: ToggleStarRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.TOGGLE_STAR, dto),
        ),
      'toggleStar',
      'ChannelService',
    );
  }

  async addMember(dto: ChannelMemberRequestDto) {
    this.membersCache.delete(dto.channelId);
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.ADD_MEMBER, dto),
        ),
      'addMember',
      'ChannelService',
    );
  }

  async addBatchMembers(dto: AddBatchMembersRequestDto) {
    this.membersCache.delete(dto.channelId);
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(
            CHANNEL_MESSAGE_PATTERN.ADD_BATCH_MEMBERS,
            dto,
          ),
        ),
      'addBatchMembers',
      'ChannelService',
    );
  }

  async removeMember(dto: RemoveMemberRequestDto) {
    this.membersCache.delete(dto.channelId);
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.REMOVE_MEMBER, dto),
        ),
      'removeMember',
      'ChannelService',
    );
  }

  async getMembers(channelId: string) {
    const cached = this.membersCache.get(channelId);
    const now = Date.now();

    if (cached && cached.expiry > now) {
      return cached.data;
    }

    const data = MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.GET_MEMBERS, {
            channelId,
          }),
        ),
      'getMembers',
      'ChannelService',
    );

    // Cache for 2 seconds
    this.membersCache.set(channelId, {
      data,
      expiry: now + 2000,
    });

    return data;
  }

  async leaveChannel(channelId: string, memberId: string) {
    this.membersCache.delete(channelId);
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.LEAVE_CHANNEL, {
            channelId,
            memberId,
          }),
        ),
      'leaveChannel',
      'ChannelService',
    );
  }

  async createWebhook(dto: CreateWebhookRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.WEBHOOK_CREATE, dto),
        ),
      'createWebhook',
      'ChannelService',
    );
  }

  async getWebhooks(dto: GetWebhooksRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.WEBHOOK_LIST, dto),
        ),
      'getWebhooks',
      'ChannelService',
    );
  }

  async updateWebhook(dto: UpdateWebhookRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.WEBHOOK_UPDATE, dto),
        ),
      'updateWebhook',
      'ChannelService',
    );
  }

  async deleteWebhook(dto: DeleteWebhookRequestDto) {
    return MicroserviceErrorHandler.handleAsyncCall(
      () =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.WEBHOOK_DELETE, dto),
        ),
      'deleteWebhook',
      'ChannelService',
    );
  }
}
