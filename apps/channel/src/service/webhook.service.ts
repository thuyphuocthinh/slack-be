import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IncomingWebhookEntity } from '../entity/incoming-webhook.entity';
import { ChannelEntity } from '../entity/channel.entity';
import { DataSource, Repository } from 'typeorm';
import { RpcException } from '@nestjs/microservices';
import { WEBHOOK_ERROR } from '@slack/constants';
import { ChannelMemberService } from './channel-member.service';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  GetWebhooksDto,
  DeleteWebhookDto,
  WebhookResponseDto,
} from '../dto/webhook.dto';
import { randomBytes } from 'crypto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    @InjectRepository(IncomingWebhookEntity)
    private readonly webhookRepo: Repository<IncomingWebhookEntity>,
    private readonly channelMemberService: ChannelMemberService,
    private readonly dataSource: DataSource,
  ) {}

  private mapToResponseDto(entity: IncomingWebhookEntity): WebhookResponseDto {
    return {
      id: entity.id,
      channelId: entity.channelId,
      workspaceId: entity.workspaceId,
      createdBy: entity.createdBy,
      name: entity.name,
      description: entity.description,
      avatarUrl: entity.avatarUrl,
      token: entity.token,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  async createWebhook(dto: CreateWebhookDto): Promise<WebhookResponseDto> {
    const isMember = await this.channelMemberService.checkMemberInChannel(
      dto.channelId,
      dto.userId,
    );
    if (!isMember) {
      throw new RpcException(WEBHOOK_ERROR.NOT_A_MEMBER);
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      // Lock the channel to prevent race conditions when checking limit
      const channel = await manager.findOne(ChannelEntity, {
        where: { id: dto.channelId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!channel) {
        throw new RpcException(WEBHOOK_ERROR.WEBHOOK_NOT_FOUND); // Using this as fallback
      }

      const currentCount = await manager.count(IncomingWebhookEntity, {
        where: { channelId: dto.channelId },
      });

      if (currentCount >= 5) {
        throw new RpcException(WEBHOOK_ERROR.WEBHOOK_LIMIT_REACHED);
      }

      const token = randomBytes(32).toString('hex');

      const webhook = manager.create(IncomingWebhookEntity, {
        channelId: dto.channelId,
        workspaceId: dto.workspaceId,
        createdBy: dto.userId,
        name: dto.name || 'Incoming Webhook',
        description: dto.description,
        avatarUrl: dto.avatarUrl,
        token,
      });

      return await manager.save(webhook);
    });

    return this.mapToResponseDto(saved);
  }

  async getWebhooks(dto: GetWebhooksDto): Promise<WebhookResponseDto[]> {
    const isMember = await this.channelMemberService.checkMemberInChannel(
      dto.channelId,
      dto.userId,
    );
    if (!isMember) {
      throw new RpcException(WEBHOOK_ERROR.NOT_A_MEMBER);
    }

    const webhooks = await this.webhookRepo.find({
      where: { channelId: dto.channelId },
      order: { createdAt: 'DESC' },
    });

    return webhooks.map((w) => this.mapToResponseDto(w));
  }

  async updateWebhook(dto: UpdateWebhookDto): Promise<WebhookResponseDto> {
    const isMember = await this.channelMemberService.checkMemberInChannel(
      dto.channelId,
      dto.userId,
    );
    if (!isMember) {
      throw new RpcException(WEBHOOK_ERROR.NOT_A_MEMBER);
    }

    const webhook = await this.webhookRepo.findOne({
      where: { id: dto.webhookId, channelId: dto.channelId },
    });

    if (!webhook) {
      throw new RpcException(WEBHOOK_ERROR.WEBHOOK_NOT_FOUND);
    }

    if (dto.name !== undefined) webhook.name = dto.name;
    if (dto.description !== undefined) webhook.description = dto.description;
    if (dto.avatarUrl !== undefined) webhook.avatarUrl = dto.avatarUrl;

    const saved = await this.webhookRepo.save(webhook);
    return this.mapToResponseDto(saved);
  }

  async deleteWebhook(dto: DeleteWebhookDto): Promise<boolean> {
    const isMember = await this.channelMemberService.checkMemberInChannel(
      dto.channelId,
      dto.userId,
    );
    if (!isMember) {
      throw new RpcException(WEBHOOK_ERROR.NOT_A_MEMBER);
    }

    const webhook = await this.webhookRepo.findOne({
      where: { id: dto.webhookId, channelId: dto.channelId },
    });

    if (!webhook) {
      throw new RpcException(WEBHOOK_ERROR.WEBHOOK_NOT_FOUND);
    }

    await this.webhookRepo.remove(webhook);
    return true;
  }
}
