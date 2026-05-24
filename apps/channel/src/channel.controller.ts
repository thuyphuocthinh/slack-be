import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ChannelService } from './service/channel.service';
import { CHANNEL_MESSAGE_PATTERN } from '@slack/constants';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { ToggleStarDto } from './dto/toggle-star.dto';
import { ChannelMemberDto } from './dto/channel-member.dto';
import { GetChannelsDto } from './dto/get-channels.dto';

import { AddBatchMembersDto } from './dto/add-batch-members.dto';

import { ChannelMemberService } from './service/channel-member.service';
import { RemoveMemberDto } from './dto/remove-member.dto';
import { WebhookService } from './service/webhook.service';
import { CreateWebhookDto, UpdateWebhookDto, GetWebhooksDto, DeleteWebhookDto } from './dto/webhook.dto';

@Controller()
export class ChannelController {
  constructor(
    private readonly channelService: ChannelService,
    private readonly channelMemberService: ChannelMemberService,
    private readonly webhookService: WebhookService,
  ) {}

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.CREATE_CHANNEL)
  async createChannel(@Payload() dto: CreateChannelDto) {
    return await this.channelService.createChannel(dto);
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.FIND_DIRECT_CHANNEL)
  async findDirectChannel(
    @Payload() payload: { workspaceId: string; allMemberIds: string[] },
  ) {
    return await this.channelService.findDirectChannel(
      payload.workspaceId,
      payload.allMemberIds,
    );
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.UPDATE_CHANNEL)
  async updateChannel(@Payload() dto: UpdateChannelDto) {
    return await this.channelService.updateChannel(dto);
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.DELETE_CHANNEL)
  async deleteChannel(
    @Payload() payload: { channelId: string; memberId: string },
  ) {
    return await this.channelService.deleteChannel(
      payload.channelId,
      payload.memberId,
    );
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.GET_CHANNELS)
  async getChannels(@Payload() dto: GetChannelsDto) {
    return await this.channelService.getChannels(dto);
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.GET_CHANNEL)
  async getChannel(
    @Payload() payload: { channelId: string; memberId: string },
  ) {
    return await this.channelService.getChannel(
      payload.channelId,
      payload.memberId,
    );
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.GET_CHANNEL_BASIC_INFO)
  async getChannelBasicInfo(
    @Payload() payload: { channelId: string },
  ) {
    return await this.channelService.getChannelBasicInfo(payload.channelId);
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.TOGGLE_STAR)
  async toggleStar(@Payload() dto: ToggleStarDto) {
    return await this.channelService.toggleStar(dto);
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.ADD_MEMBER)
  async addMember(@Payload() dto: ChannelMemberDto) {
    return await this.channelMemberService.addMember(dto);
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.ADD_BATCH_MEMBERS)
  async addBatchMembers(@Payload() dto: AddBatchMembersDto) {
    return await this.channelMemberService.addBatchMembers(dto);
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.REMOVE_MEMBER)
  async removeMember(@Payload() dto: RemoveMemberDto) {
    return await this.channelMemberService.removeMember(dto);
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.GET_MEMBERS)
  async getMembers(@Payload() payload: { channelId: string }) {
    return await this.channelMemberService.getMembers(payload.channelId);
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.LEAVE_CHANNEL)
  async leaveChannel(
    @Payload() payload: { channelId: string; memberId: string },
  ) {
    return await this.channelMemberService.leaveChannel(
      payload.channelId,
      payload.memberId,
    );
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.INCREMENT_UNREAD_COUNT)
  async incrementUnreadCount(
    @Payload() payload: { channelId: string; senderId: string },
  ) {
    return await this.channelMemberService.incrementUnreadCount(
      payload.channelId,
      payload.senderId,
    );
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.MARK_AS_READ)
  async markAsRead(
    @Payload()
    payload: {
      channelId: string;
      memberId: string;
      lastReadMessageId: string;
    },
  ) {
    return await this.channelMemberService.markAsRead(
      payload.channelId,
      payload.memberId,
      payload.lastReadMessageId,
    );
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.REMOVE_MEMBER_FROM_ALL_CHANNELS)
  async removeMemberFromAllChannels(
    @Payload() payload: { workspaceId: string; memberId: string },
  ) {
    return await this.channelMemberService.removeMemberFromAllChannels(
      payload.workspaceId,
      payload.memberId,
    );
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.GET_UNREAD_SUMMARY)
  async getUnreadSummary(
    @Payload() payload: { workspaceId: string; memberId: string },
  ) {
    return await this.channelMemberService.getUnreadSummary(
      payload.workspaceId,
      payload.memberId,
    );
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.WEBHOOK_CREATE)
  async createWebhook(@Payload() dto: CreateWebhookDto) {
    return await this.webhookService.createWebhook(dto);
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.WEBHOOK_LIST)
  async getWebhooks(@Payload() dto: GetWebhooksDto) {
    return await this.webhookService.getWebhooks(dto);
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.WEBHOOK_UPDATE)
  async updateWebhook(@Payload() dto: UpdateWebhookDto) {
    return await this.webhookService.updateWebhook(dto);
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.WEBHOOK_DELETE)
  async deleteWebhook(@Payload() dto: DeleteWebhookDto) {
    return await this.webhookService.deleteWebhook(dto);
  }

  @MessagePattern(CHANNEL_MESSAGE_PATTERN.WEBHOOK_VERIFY)
  async verifyWebhook(@Payload() payload: { workspaceId: string; channelId: string; token: string }) {
    return await this.webhookService.verifyWebhook(payload.workspaceId, payload.channelId, payload.token);
  }
}
