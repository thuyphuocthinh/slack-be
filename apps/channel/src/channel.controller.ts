import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ChannelService } from './channel.service';
import { ChannelMessagePattern } from '@slack/constants';
import { CreateChannelDto } from './dto/create-channel.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { ToggleStarDto } from './dto/toggle-star.dto';
import { ChannelMemberDto } from './dto/channel-member.dto';
import { GetChannelsDto } from './dto/get-channels.dto';

import { AddBatchMembersDto } from './dto/add-batch-members.dto';

@Controller()
export class ChannelController {
  constructor(private readonly channelService: ChannelService) { }

  @MessagePattern(ChannelMessagePattern.CREATE_CHANNEL)
  async createChannel(@Payload() dto: CreateChannelDto) {
    return await this.channelService.createChannel(dto);
  }

  @MessagePattern(ChannelMessagePattern.UPDATE_CHANNEL)
  async updateChannel(@Payload() dto: UpdateChannelDto) {
    return await this.channelService.updateChannel(dto);
  }

  @MessagePattern(ChannelMessagePattern.DELETE_CHANNEL)
  async deleteChannel(@Payload() payload: { channelId: string; memberId: string }) {
    return await this.channelService.deleteChannel(payload.channelId, payload.memberId);
  }

  @MessagePattern(ChannelMessagePattern.GET_CHANNELS)
  async getChannels(@Payload() dto: GetChannelsDto) {
    return await this.channelService.getChannels(dto);
  }

  @MessagePattern(ChannelMessagePattern.GET_CHANNEL)
  async getChannel(@Payload() payload: { channelId: string; memberId: string }) {
    return await this.channelService.getChannel(payload.channelId, payload.memberId);
  }

  @MessagePattern(ChannelMessagePattern.TOGGLE_STAR)
  async toggleStar(@Payload() dto: ToggleStarDto) {
    return await this.channelService.toggleStar(dto);
  }

  @MessagePattern(ChannelMessagePattern.ADD_MEMBER)
  async addMember(@Payload() dto: ChannelMemberDto) {
    return await this.channelService.addMember(dto);
  }

  @MessagePattern(ChannelMessagePattern.ADD_BATCH_MEMBERS)
  async addBatchMembers(@Payload() dto: AddBatchMembersDto) {
    return await this.channelService.addBatchMembers(dto);
  }

  @MessagePattern(ChannelMessagePattern.REMOVE_MEMBER)
  async removeMember(@Payload() dto: ChannelMemberDto) {
    return await this.channelService.removeMember(dto);
  }

  @MessagePattern(ChannelMessagePattern.GET_MEMBERS)
  async getMembers(@Payload() payload: { channelId: string }) {
    return await this.channelService.getMembers(payload.channelId);
  }

  @MessagePattern(ChannelMessagePattern.LEAVE_CHANNEL)
  async leaveChannel(@Payload() payload: { channelId: string; memberId: string }) {
    return await this.channelService.leaveChannel(payload.channelId, payload.memberId);
  }
}
