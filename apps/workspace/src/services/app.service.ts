import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { AppEntity } from '../entity/app.entity';
import { AppStatus } from '../types/app.enum';
import { AppEventSubscriptionEntity } from '../entity/app-event-subscription.entity';
import { WorkspaceEntity } from '../entity/workspace.entity';
import { WorkspaceCommonService } from './workspace-common.service';
import { CACHE, CachedService } from '@slack/cached';
import {
  CreateAppRequestDto,
  UpdateAppRequestDto,
  DeleteAppRequestDto,
  GetAppsRequestDto,
  InvokeCommandRequestDto,
} from '../dto/app-request.dto';
import { AppResponseDto, mapAppToDto } from '../dto/app-response.dto';
import { RpcException } from '@nestjs/microservices';
import * as crypto from 'crypto';
import { WorkspaceRoleEnum } from '../types/workspace.enum';
import { APP_ERROR } from '@slack/constants';
import axios from 'axios';
import { EQueueName, EJobName, QueueService } from '@slack/queue';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(
    @InjectRepository(AppEntity)
    private readonly appRepository: Repository<AppEntity>,
    @InjectRepository(AppEventSubscriptionEntity)
    private readonly appSubscriptionRepository: Repository<AppEventSubscriptionEntity>,
    private readonly workspaceCommonService: WorkspaceCommonService,
    private readonly dataSource: DataSource,
    private readonly cachedService: CachedService,
    private readonly queueService: QueueService,
  ) {}

  private generateSigningSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  private generateBotToken(): string {
    return `xoxb-${crypto.randomBytes(4).toString('hex')}-${crypto.randomBytes(12).toString('hex')}`;
  }

  private async verifyRequestUrl(requestUrl: string): Promise<void> {
    if (!requestUrl) return;

    const challenge = crypto.randomBytes(16).toString('hex');
    try {
      const response = await axios.post(
        requestUrl,
        {
          type: 'url_verification',
          challenge: challenge,
        },
        {
          timeout: 3000,
        },
      );

      const isValid =
        response.status === 200 &&
        (response.data === challenge || response.data?.challenge === challenge);

      if (!isValid) {
        throw new RpcException(APP_ERROR.URL_VERIFICATION_FAILED);
      }
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error(`URL Verification failed for ${requestUrl}: ${error.message}`);
      throw new RpcException(APP_ERROR.URL_VERIFICATION_FAILED);
    }
  }

  async createApp(dto: CreateAppRequestDto) {
    await this.workspaceCommonService.checkPermission(
      dto.workspaceId,
      dto.userId,
      [WorkspaceRoleEnum.OWNER, WorkspaceRoleEnum.ADMIN],
    );

    if (dto.requestUrl) {
      await this.verifyRequestUrl(dto.requestUrl);
    }

    try {
      return await this.dataSource.transaction(async (manager) => {
        // Lock workspace to prevent concurrent bypass of the 5 apps limit
        await manager.findOne(WorkspaceEntity, {
          where: { id: dto.workspaceId },
          lock: { mode: 'pessimistic_write' },
        });

        const appCount = await manager.count(AppEntity, {
          where: { workspaceId: dto.workspaceId },
        });

        if (appCount >= 5) {
          throw new RpcException(APP_ERROR.APP_LIMIT_EXCEEDED);
        }

        const app = new AppEntity();
        app.workspaceId = dto.workspaceId;
        app.name = dto.name;
        app.description = dto.description || '';
        app.avatarUrl = dto.avatarUrl || '';
        app.requestUrl = dto.requestUrl || '';
        app.slashCommands = dto.slashCommands || [];
        app.signingSecret = this.generateSigningSecret();
        app.botToken = this.generateBotToken();
        app.status = AppStatus.ACTIVE;

        const savedApp = await manager.save(app);

        if (dto.eventTypes && dto.eventTypes.length > 0) {
          const subscriptions = dto.eventTypes.map((eventType) => {
            const sub = new AppEventSubscriptionEntity();
            sub.appId = savedApp.id;
            sub.workspaceId = dto.workspaceId;
            sub.eventType = eventType;
            
            // Invalidate cache
            this.cachedService.del(CACHE.APP.KEYS.EVENT_SUBSCRIPTIONS(dto.workspaceId, eventType));
            
            return sub;
          });
          await manager.save(subscriptions);
        }

        return mapAppToDto(savedApp);
      });
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error(`Error creating app: ${error.message}`);
      throw new RpcException(APP_ERROR.FAILED_TO_CREATE_APP);
    }
  }

  async getApps(dto: GetAppsRequestDto) {
    await this.workspaceCommonService.checkPermission(
      dto.workspaceId,
      dto.userId,
      [WorkspaceRoleEnum.OWNER, WorkspaceRoleEnum.ADMIN, WorkspaceRoleEnum.MEMBER],
    );

    const apps = await this.appRepository.find({
      where: { workspaceId: dto.workspaceId },
      order: { createdAt: 'DESC' },
    });

    return apps.map(mapAppToDto);
  }

  async getAppCommands(dto: GetAppsRequestDto) {
    await this.workspaceCommonService.checkPermission(
      dto.workspaceId,
      dto.userId,
      [WorkspaceRoleEnum.OWNER, WorkspaceRoleEnum.ADMIN, WorkspaceRoleEnum.MEMBER],
    );

    const apps = await this.appRepository.find({
      where: { workspaceId: dto.workspaceId, status: AppStatus.ACTIVE },
    });

    const commands: Array<{ appId: string; appName: string; appAvatar: string; command: string; description: string; }> = [];
    for (const app of apps) {
      if (app.slashCommands && app.slashCommands.length > 0) {
        for (const cmd of app.slashCommands) {
          commands.push({
            appId: app.id,
            appName: app.name,
            appAvatar: app.avatarUrl,
            command: cmd.command,
            description: cmd.description,
          });
        }
      }
    }
    return commands;
  }

  async updateApp(dto: UpdateAppRequestDto) {
    await this.workspaceCommonService.checkPermission(
      dto.workspaceId,
      dto.userId,
      [WorkspaceRoleEnum.OWNER, WorkspaceRoleEnum.ADMIN],
    );

    if (dto.requestUrl) {
      await this.verifyRequestUrl(dto.requestUrl);
    }

    try {
      await this.dataSource.transaction(async (manager) => {
        const updateData: Partial<AppEntity> = {};
        if (dto.name) updateData.name = dto.name;
        if (dto.description !== undefined) updateData.description = dto.description || '';
        if (dto.avatarUrl !== undefined) updateData.avatarUrl = dto.avatarUrl || '';
        if (dto.requestUrl !== undefined) updateData.requestUrl = dto.requestUrl || '';
        if (dto.slashCommands !== undefined) updateData.slashCommands = dto.slashCommands;
        if (dto.status) updateData.status = dto.status as AppStatus;

        // Invalidate cache for existing subscriptions if anything changes
        const existingSubscriptions = await manager.find(AppEventSubscriptionEntity, {
          where: { appId: dto.appId }
        });
        existingSubscriptions.forEach(sub => {
          this.cachedService.del(CACHE.APP.KEYS.EVENT_SUBSCRIPTIONS(dto.workspaceId, sub.eventType));
        });

        if (Object.keys(updateData).length > 0) {
          const updateResult = await manager.update(
            AppEntity,
            { id: dto.appId, workspaceId: dto.workspaceId },
            updateData,
          );

          if (updateResult.affected === 0) {
            throw new RpcException(APP_ERROR.APP_NOT_FOUND);
          }
        } else if (dto.eventTypes) {
          const exists = await manager.exists(AppEntity, {
            where: { id: dto.appId, workspaceId: dto.workspaceId },
          });
          if (!exists) {
            throw new RpcException(APP_ERROR.APP_NOT_FOUND);
          }
        }

        if (dto.eventTypes) {
          await manager.delete(AppEventSubscriptionEntity, {
            appId: dto.appId,
          });

          if (dto.eventTypes.length > 0) {
            const subscriptions = dto.eventTypes.map((eventType) => {
              const sub = new AppEventSubscriptionEntity();
              sub.appId = dto.appId;
              sub.workspaceId = dto.workspaceId;
              sub.eventType = eventType;
              
              // Invalidate cache for new events
              this.cachedService.del(CACHE.APP.KEYS.EVENT_SUBSCRIPTIONS(dto.workspaceId, eventType));
              
              return sub;
            });
            await manager.save(subscriptions);
          }
        }
      });

      const updatedApp = await this.appRepository.findOne({
        where: { id: dto.appId, workspaceId: dto.workspaceId },
      });

      if (!updatedApp) {
        throw new RpcException(APP_ERROR.APP_NOT_FOUND);
      }

      return mapAppToDto(updatedApp);
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error(`Error updating app: ${error.message}`);
      throw new RpcException(APP_ERROR.FAILED_TO_UPDATE_APP);
    }
  }

  async deleteApp(dto: DeleteAppRequestDto) {
    await this.workspaceCommonService.checkPermission(
      dto.workspaceId,
      dto.userId,
      [WorkspaceRoleEnum.OWNER, WorkspaceRoleEnum.ADMIN],
    );

    try {
      await this.dataSource.transaction(async (manager) => {
        // Get old subscriptions to invalidate their cache
        const oldSubscriptions = await manager.find(AppEventSubscriptionEntity, {
          where: { appId: dto.appId }
        });
        oldSubscriptions.forEach(sub => {
          this.cachedService.del(CACHE.APP.KEYS.EVENT_SUBSCRIPTIONS(dto.workspaceId, sub.eventType));
        });

        await manager.delete(AppEventSubscriptionEntity, {
          appId: dto.appId,
        });
        
        const deleteResult = await manager.delete(AppEntity, { 
          id: dto.appId, 
          workspaceId: dto.workspaceId 
        });

        if (deleteResult.affected === 0) {
          throw new RpcException(APP_ERROR.APP_NOT_FOUND);
        }
      });

      return 'success';
    } catch (error) {
      if (error instanceof RpcException) throw error;
      this.logger.error(`Error deleting app: ${error.message}`);
      throw new RpcException(APP_ERROR.FAILED_TO_DELETE_APP);
    }
  }

  async invokeCommand(dto: InvokeCommandRequestDto) {
    await this.workspaceCommonService.checkPermission(
      dto.workspaceId,
      dto.userId,
      [WorkspaceRoleEnum.OWNER, WorkspaceRoleEnum.ADMIN, WorkspaceRoleEnum.MEMBER],
    );

    const app = await this.appRepository.findOne({
      where: { id: dto.appId, workspaceId: dto.workspaceId, status: AppStatus.ACTIVE },
    });

    if (!app || !app.requestUrl) {
      throw new RpcException(APP_ERROR.APP_NOT_FOUND);
    }

    const { v4: uuidv4 } = require('uuid');
    const responseToken = uuidv4();
    const CACHE_KEY = CACHE.APP.KEYS.COMMAND_RESPONSE(responseToken);
    
    await this.cachedService.set(CACHE_KEY, {
      appId: app.id,
      workspaceId: dto.workspaceId,
      channelId: dto.channelId,
      appName: app.name,
      appAvatarUrl: app.avatarUrl
    }, 30 * 60); // 30 minutes TTL

    const apiUrl = process.env.API_GATEWAY_URL || 'http://localhost:3000';
    const responseUrl = `${apiUrl}/services/commands/response/${responseToken}`;

    await this.queueService.addJob(
      EQueueName.OUTBOUND_WEBHOOK_QUEUE,
      EJobName.DISPATCH_OUTBOUND_WEBHOOK,
      {
        appId: dto.appId,
        eventType: 'slash_commands',
        workspaceId: dto.workspaceId,
        payload: {
          command: dto.command,
          text: dto.text || '',
          channelId: dto.channelId,
          userId: dto.userId,
          response_url: responseUrl,
        },
      },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
      }
    );

    return { success: true };
  }

  async verifyCommandResponse(token: string) {
    const CACHE_KEY = CACHE.APP.KEYS.COMMAND_RESPONSE(token);
    const data = await this.cachedService.get(CACHE_KEY);
    if (!data) {
      return null;
    }
    return data;
  }
}
