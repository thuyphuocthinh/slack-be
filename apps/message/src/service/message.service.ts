import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CreateMessageDto,
  UpdateMessageDto,
  MessageResponseDto,
  GetMessagesQueryDto,
  ToggleReactionDto,
  ToggleFeedbackDto,
  UserResponseDto,
  ReactionResponseDto,
  GetPinnedMessagesQueryDto,
  GetSurroundingMessagesQueryDto,
  SurroundingMessageResponseDto,
  SearchMessagesQueryDto,
} from '../dto';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  CHANNEL_MESSAGE_PATTERN,
  ChannelTypeEnum,
  MESSAGE_ERROR,
  NAME_SERVICE_TCP,
  ORCHESTRATION_CONSTANTS,
  USER_MESSAGE_PATTERNS,
  ESocketEvent,
} from '@slack/constants';
import { InjectRepository } from '@nestjs/typeorm';
import { MessageEntity } from '../entity/message.entity';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { MessageMentionEntity } from '../entity/message_mention.entity';
import { MessageReactionEntity } from '../entity/message_reaction.entity';
import { MessageFeedbackEntity } from '../entity/message_feedback.entity';
import { MessageAttachmentEntity } from '../entity/message_attachment.entity';
import { firstValueFrom } from 'rxjs';
import { v7 as uuidv7 } from 'uuid';
import {
  EQueueName,
  EJobName,
  QueueService,
  IProcessWebhookMessageJobData,
} from '@slack/queue';
import { IMessageAttachment } from '../types/message-attachment.interface';
import { ITipTapNode } from '../types/tiptap-node.interface';
import { CACHE, CachedService, RateLimitService, TTL } from '@slack/cached';
import { AuditAction, AuditEntityType } from '@slack/common';

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelService: ClientProxy,
    @Inject(NAME_SERVICE_TCP.USER_SERVICE)
    private readonly userService: ClientProxy,
    @InjectRepository(MessageEntity)
    private readonly messageRepository: Repository<MessageEntity>,
    private readonly dataSource: DataSource,
    private readonly queueService: QueueService,
    private readonly cachedService: CachedService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  private async checkChannelExist(channelId: string, senderId: string) {
    try {
      // Bug bảo mật thật: controller phía channel service đọc "memberId"
      // (payload.memberId, xem channel.controller.ts::getChannel), không phải
      // "senderId" — gửi sai tên field khiến TypeORM bỏ qua điều kiện lọc
      // member trong where (field undefined), check "user có phải member
      // không" thực chất KHÔNG lọc đúng người gửi, chỉ cần đúng channelId.
      const channel = await firstValueFrom(
        this.channelService.send(CHANNEL_MESSAGE_PATTERN.GET_CHANNEL, {
          channelId,
          memberId: senderId,
        }),
      );
      if (!channel) {
        throw new RpcException(
          MESSAGE_ERROR.CHANNEL_NOT_FOUND_OR_USER_NOT_IN_CHANNEL,
        );
      }
      return channel;
    } catch (error) {
      this.logger.error(`Error checking channel: ${error.message}`);
      throw new RpcException(error.message || 'Internal server error');
    }
  }

  private async getUsersInfo(
    userIds: string[],
  ): Promise<Map<string, UserResponseDto>> {
    if (userIds.length === 0) return new Map();
    try {
      const users: UserResponseDto[] = await firstValueFrom(
        this.userService.send(USER_MESSAGE_PATTERNS.GET_BATCH_USER_BY_IDS, {
          ids: [...new Set(userIds)],
        }),
      );
      const userMap = new Map<string, UserResponseDto>();
      if (Array.isArray(users)) {
        users.forEach((u) => userMap.set(u.id, u));
      }
      return userMap;
    } catch (error) {
      this.logger.error(`Error getting users info: ${error.message}`);
      return new Map();
    }
  }

  private async handleMentionsAndAttachments(
    savedMessage: MessageEntity,
    createMessageDto: CreateMessageDto,
    manager: EntityManager,
  ) {
    // 4. Handle mentions
    if (createMessageDto.mentions && createMessageDto.mentions.length > 0) {
      const actualMentions = createMessageDto.mentions.filter(
        (id) => id !== 'all',
      );
      if (actualMentions.length > 0) {
        const mentionEntities = actualMentions.map((userId) =>
          manager.create(MessageMentionEntity, {
            messageId: savedMessage.id,
            userId,
          }),
        );
        savedMessage.mentions = await manager.save(mentionEntities);
      } else {
        savedMessage.mentions = [];
      }
    }

    // 4.5. Handle attachments
    if (
      createMessageDto.attachments &&
      createMessageDto.attachments.length > 0
    ) {
      const attachmentEntities = createMessageDto.attachments.map((a) =>
        manager.create(MessageAttachmentEntity, {
          messageId: savedMessage.id,
          resourceId: a.id,
          publicId: a.publicId,
          url: a.url,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
          type: a.type,
          thumbnailUrl: a.thumbnailUrl,
        }),
      );
      savedMessage.attachments = await manager.save(attachmentEntities);
    }
  }

  private async broadcastMessageEvents(
    response: MessageResponseDto,
    channel: { name: string; workspaceId: string },
    savedMessage: MessageEntity,
    manager: EntityManager,
  ) {
    // 6. Emit Socket Event (Background)
    if (response.parentId) {
      await this.queueService.addJob(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        {
          event: ESocketEvent.MESSAGE_RECEIVED,
          room: [`thread_${response.parentId}`, response.channelId], // Phát đồng thời tới cả 2 phòng
          data: response,
        },
      );
    } else {
      // Normal message, emit only to channel room
      await this.queueService.addJob(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        {
          event: ESocketEvent.MESSAGE_RECEIVED,
          room: response.channelId,
          data: response,
        },
      );
    }

    // 6.5. Emit Thread Event to User Private Rooms if it's a thread reply
    if (response.parentId) {
      const rawParticipants = await manager.query(
        `
        SELECT DISTINCT "userId" FROM (
          SELECT user_id AS "userId" FROM messages 
          WHERE id = $1 OR parent_id = $1

          UNION

          SELECT m.user_id AS "userId" FROM message_mentions m
          INNER JOIN messages msg ON m.message_id = msg.id
          WHERE msg.id = $1 OR msg.parent_id = $1
        ) t
        `,
        [response.parentId],
      );

      const userIds = rawParticipants
        .map((p: { userId: string }) => p.userId)
        .filter((id: string) => id !== response.sender.id);

      if (userIds.length > 0) {
        await this.queueService.addJob(
          EQueueName.SOCKET_QUEUE,
          EJobName.EMIT_TO_USERS,
          {
            event: ESocketEvent.THREAD_MESSAGE_RECEIVED,
            userIds,
            data: response as unknown as Record<string, unknown>,
          },
        );

        // 7. Push to Notification Queue (Background) - Notify only mentioned users
        const userIdsWithoutSender = userIds.filter(
          (id: string) => id !== response.sender.id,
        );
        if (userIdsWithoutSender.length > 0) {
          await this.queueService.addJob(
            EQueueName.NOTIFICATION_QUEUE,
            EJobName.CREATE_NOTIFICATION,
            {
              channelId: response.channelId,
              channelName: channel.name,
              senderId: response.sender.id,
              senderName:
                response.sender.firstName + ' ' + response.sender.lastName,
              messageId: response.id,
              mentions: response.mentions,
              parentId: response.parentId || undefined,
              workspaceId: channel.workspaceId,
              content: JSON.stringify(response.content),
            },
          );
        }
      }
    }

    // 8. Push to Channel Queue (Background) - For unread count
    if (!response.parentId) {
      await this.queueService.addJob(
        EQueueName.CHANNEL_QUEUE,
        EJobName.INCREMENT_UNREAD_COUNT,
        {
          channelId: response.channelId,
          senderId: response.sender.id,
        },
      );
    }

    // 9. Update resource metadata (Background)
    if (savedMessage.attachments && savedMessage.attachments.length > 0) {
      await this.queueService.addJob(
        EQueueName.RESOURCE_QUEUE,
        EJobName.UPDATE_RESOURCE_METADATA,
        {
          resourceIds: savedMessage.attachments.map(
            (a: IMessageAttachment) => a.id,
          ),
          refType: 'message',
          refId: savedMessage.id,
        },
      );
    }
  }

  private async dispatchWebhookEvents(
    response: MessageResponseDto,
    channel: { name: string; workspaceId: string },
  ) {
    const eventType = 'message.channels';

    const subscribedAppIds = await this.cachedService.getOrSetDetail(
      CACHE.APP.KEYS.EVENT_SUBSCRIPTIONS(channel.workspaceId, eventType),
      TTL.LONG,
      async () => {
        const rawResult = await this.dataSource.query(
          `SELECT sub.app_id as "appId" 
           FROM app_event_subscriptions sub
           INNER JOIN apps a ON a.id = sub.app_id
           WHERE sub.workspace_id = $1 
             AND sub.event_type = $2 
             AND a.status = 'ACTIVE' 
             AND a.request_url IS NOT NULL 
             AND a.request_url != ''`,
          [channel.workspaceId, eventType],
        );
        return rawResult.map((r: { appId: string }) => r.appId) as string[];
      },
    );

    if (Array.isArray(subscribedAppIds) && subscribedAppIds.length > 0) {
      for (const appId of subscribedAppIds) {
        await this.queueService.addJob(
          EQueueName.OUTBOUND_WEBHOOK_QUEUE,
          EJobName.DISPATCH_OUTBOUND_WEBHOOK,
          {
            appId,
            eventType,
            workspaceId: channel.workspaceId,
            payload: response as unknown as Record<string, unknown>,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: true,
          },
        );
      }
    }
  }

  async createMessage(
    createMessageDto: CreateMessageDto,
  ): Promise<MessageResponseDto> {
    const { channelId, senderId, content, parentId } = createMessageDto;

    // check channel exist
    const channel = await this.checkChannelExist(channelId, senderId);

    const { response, savedMessage } = await this.dataSource.transaction(
      async (manager) => {
        // 2. Validate parent if it's a reply
        if (parentId) {
          const parent = await manager.findOne(MessageEntity, {
            where: { id: parentId, channelId },
          });
          if (!parent) {
            throw new RpcException(MESSAGE_ERROR.PARENT_NOT_FOUND);
          }
        }

        // 3. Create message
        const message = manager.create(MessageEntity, {
          id: uuidv7(), // uuid v7 => time-based for sorting
          channelId,
          userId: senderId,
          content,
          parentId,
        });

        const savedMessage = await manager.save(message);

        // 4. Handle mentions and attachments
        await this.handleMentionsAndAttachments(
          savedMessage,
          createMessageDto,
          manager,
        );

        // 5. Hydrate and return
        const [response] = await this.hydrateMessages([savedMessage], manager);

        return { response, savedMessage };
      },
    );

    // Extract URLs and trigger link preview generation — enqueue chỉ là 1 lời
    // gọi Redis (BullMQ), không ảnh hưởng response trả về, đẩy ra nền như
    // webhook/AI-trigger bên dưới thay vì chặn request chờ enqueue xong.
    const foundUrls = this.extractUrlsFromContent(content);
    if (foundUrls.length > 0) {
      process.nextTick(() => {
        this.queueService
          .addJob(
            EQueueName.LINK_PREVIEW_QUEUE,
            EJobName.GENERATE_LINK_PREVIEW,
            {
              messageId: savedMessage.id,
              urls: foundUrls,
            },
          )
          .catch((err) => {
            this.logger.error(
              `Error enqueueing link preview job: ${err.message}`,
            );
          });
      });
    }

    // 6. Broadcast events and queues (background) — socket emit/tăng unread
    // count chỉ THẬT SỰ chạy ở BullMQ worker sau này, `addJob()` ở đây chỉ là
    // 1-2 lời gọi Redis để enqueue; trước đây `await` thẳng làm response phải
    // chờ thêm round-trip Redis không cần thiết, và 1 lỗi Redis tạm thời sẽ
    // khiến client thấy gửi tin nhắn THẤT BẠI dù message đã lưu DB thành công.
    process.nextTick(() => {
      this.broadcastMessageEvents(
        response,
        channel,
        savedMessage,
        this.dataSource.manager,
      ).catch((err) => {
        this.logger.error(`Error broadcasting message events: ${err.message}`);
      });
    });

    // 7. Dispatch Webhook Events to Bot Servers
    process.nextTick(() => {
      this.dispatchWebhookEvents(response, channel).catch((err) => {
        this.logger.error(`Error dispatching webhook: ${err.message}`);
      });
    });

    // 8. Trigger AI orchestration if this channel has an AI bot member
    process.nextTick(() => {
      this.maybeTriggerAiOrchestration(
        channel,
        createMessageDto,
        savedMessage,
      ).catch((err) => {
        this.logger.error(`Error triggering AI orchestration: ${err.message}`);
      });
    });

    return response;
  }

  private async maybeTriggerAiOrchestration(
    channel: {
      id: string;
      type: string;
      memberIds?: string[];
      workspaceId: string;
    },
    createMessageDto: CreateMessageDto,
    savedMessage: MessageEntity,
  ): Promise<void> {
    if (!channel.memberIds?.length) return;

    const usersMap = await this.getUsersInfo(channel.memberIds);
    const botEntry = [...usersMap.values()].find((u) => u.isBot);
    if (!botEntry) return; // channel này không có AI bot -> bỏ qua
    if (savedMessage.userId === botEntry.id) return; // message của chính bot -> không tự trigger lại

    const isDirect = channel.type === ChannelTypeEnum.DIRECT;
    const isMentioned =
      createMessageDto.mentions?.includes(botEntry.id) ?? false;
    if (!isDirect && !isMentioned) return; // GROUP mà không @mention -> bỏ qua

    const rateLimitKey = CACHE.MESSAGE.KEYS.AI_TRIGGER_RATE_LIMIT(
      savedMessage.userId,
    );
    const allowed = await this.rateLimitService.isAllowed(rateLimitKey, 5, 60);
    if (!allowed) {
      this.logger.warn(
        `maybeTriggerAiOrchestration() userId=${savedMessage.userId} bị chặn rate limit AI (>5 lượt/60s)`,
      );
      await this.createMessage({
        channelId: channel.id,
        senderId: botEntry.id,
        content: 'Bạn đang hỏi hơi nhanh, đợi 1 chút nhé.',
      });
      return;
    }

    // Backpressure/Admission control — waiting+active vượt ngưỡng thì từ chối
    // enqueue NGAY tại lúc trigger thay vì để hàng đợi phình vô hạn (worker
    // concurrency chỉ 5, quá tải là dồn ứ chứ không tự xử lý nhanh hơn).
    const overloaded = await this.queueService.isOverloaded(
      EQueueName.AI_ORCHESTRATION_QUEUE,
      ORCHESTRATION_CONSTANTS.MAX_ORCHESTRATION_QUEUE_DEPTH,
    );
    if (overloaded) {
      this.logger.warn(
        `maybeTriggerAiOrchestration() AI_ORCHESTRATION_QUEUE quá tải (> ${ORCHESTRATION_CONSTANTS.MAX_ORCHESTRATION_QUEUE_DEPTH} job waiting+active) — từ chối enqueue cho userId=${savedMessage.userId}`,
      );
      await this.createMessage({
        channelId: channel.id,
        senderId: botEntry.id,
        content: 'Hệ thống đang bận, vui lòng thử lại sau ít phút.',
      });
      return;
    }

    await this.queueService.addJob(
      EQueueName.AI_ORCHESTRATION_QUEUE,
      EJobName.PROCESS_AI_TRIGGER,
      {
        userId: savedMessage.userId,
        channelId: channel.id,
        workspaceId: channel.workspaceId,
        messageId: savedMessage.id,
        botUserId: botEntry.id,
        channelType: channel.type,
      },
      // Giai đoạn 4, Step 1 — jobId tường minh, BullMQ tự chặn enqueue trùng
      // cho CÙNG messageId (VD race ở tầng gọi tạo 2 job cho 1 message).
      {
        jobId: `ai_trigger_${savedMessage.id}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
      },
    );
  }

  private extractUrlsFromContent(
    content: string | Record<string, unknown> | Record<string, unknown>[],
  ): string[] {
    const urls: string[] = [];
    const URL_REGEX = /https?:\/\/[^\s$.?#].[^\s]*/gi;

    let parsedContent = content;
    if (
      typeof content === 'string' &&
      (content.startsWith('{') || content.startsWith('['))
    ) {
      try {
        parsedContent = JSON.parse(content);
      } catch {
        // Fallback to plain string
      }
    }

    if (typeof parsedContent === 'string') {
      const matches = parsedContent.match(URL_REGEX);
      if (matches) {
        for (let match of matches) {
          match = match.replace(/[.,"\x27[\]{}()!]+$/, '');
          urls.push(match);
        }
      }
      return urls;
    }

    const traverse = (node: ITipTapNode) => {
      if (!node) return;

      if (node.marks && Array.isArray(node.marks)) {
        for (const mark of node.marks) {
          if (mark.type === 'link' && mark.attrs?.href) {
            let href = mark.attrs.href;
            href = href.replace(/[.,"\x27[\]{}()!]+$/, '');
            urls.push(href);
          }
        }
      }

      if (node.text && typeof node.text === 'string') {
        const matches = node.text.match(URL_REGEX);
        if (matches) {
          for (let match of matches) {
            match = match.replace(/[.,"\x27[\]{}()!]+$/, '');
            urls.push(match);
          }
        }
      }

      if (node.content && Array.isArray(node.content)) {
        node.content.forEach(traverse);
      }
    };

    if (Array.isArray(parsedContent)) {
      (parsedContent as unknown as ITipTapNode[]).forEach(traverse);
    } else {
      traverse(parsedContent as unknown as ITipTapNode);
    }

    return urls;
  }

  async createWebhookMessage(
    data: IProcessWebhookMessageJobData,
  ): Promise<MessageResponseDto> {
    const {
      channelId,
      webhookId,
      customName,
      customAvatarUrl,
      content,
      attachments,
    } = data;

    // We don't check checkChannelExist because webhooks are pre-verified

    const { response, savedMessage } = await this.dataSource.transaction(
      async (manager) => {
        // Create message
        const message = manager.create(MessageEntity, {
          id: uuidv7(),
          channelId,
          userId: null as any, // nullable
          webhookId,
          customName,
          customAvatarUrl,
          content:
            attachments && attachments.length > 0
              ? { text: content, attachments }
              : content,
        });

        const savedMessage = await manager.save(message);

        // skip attachments for webhooks as they are not standard uploaded resources
        // but rather rich-text content or slack-format attachments

        const [response] = await this.hydrateMessages([savedMessage], manager);

        return { response, savedMessage };
      },
    );

    // Extract URLs and trigger link preview generation
    const foundUrls = this.extractUrlsFromContent(savedMessage.content);
    if (foundUrls.length > 0) {
      await this.queueService.addJob(
        EQueueName.LINK_PREVIEW_QUEUE,
        EJobName.GENERATE_LINK_PREVIEW,
        {
          messageId: savedMessage.id,
          urls: foundUrls,
        },
      );
    }

    // Get real channel info via TCP
    const channel = await firstValueFrom(
      this.channelService.send(CHANNEL_MESSAGE_PATTERN.GET_CHANNEL_BASIC_INFO, {
        channelId,
      }),
    );

    await this.broadcastMessageEvents(
      response,
      channel,
      savedMessage,
      this.dataSource.manager,
    );

    return response;
  }

  async getMessages(
    query: GetMessagesQueryDto,
  ): Promise<{ messages: MessageResponseDto[]; nextCursor?: string }> {
    // cursor - id of message (uuidv7 is sortable)
    // direction: 'before' (older) or 'after' (newer)
    const {
      channelId,
      userId,
      parentId,
      limit = 20,
      cursor,
      direction = 'before',
      afterDate,
    } = query;

    // Check channel exist
    if (channelId) {
      await this.checkChannelExist(channelId, userId);
    } else if (parentId) {
      const parent = await this.messageRepository.findOne({
        where: { id: parentId },
      });
      if (!parent) throw new RpcException(MESSAGE_ERROR.PARENT_NOT_FOUND);
      await this.checkChannelExist(parent.channelId, userId);
    }

    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);

      const queryBuilder = messageRepo
        .createQueryBuilder('message')
        .leftJoinAndSelect('message.reactions', 'reaction')
        .leftJoinAndSelect('message.mentions', 'mention')
        .leftJoinAndSelect('message.attachments', 'attachment')
        .where('message.channelId = :channelId', {
          channelId:
            channelId ||
            (parentId
              ? (await messageRepo.findOne({ where: { id: parentId } }))
                  ?.channelId
              : undefined),
        });

      if (parentId) {
        queryBuilder.andWhere('message.parentId = :parentId', { parentId });
      } else {
        queryBuilder.andWhere('message.parentId IS NULL');
      }

      // Free plan: restrict history to N days (afterDate injected by api-gateway)
      if (afterDate) {
        queryBuilder.andWhere('message.createdAt >= :afterDate', {
          afterDate: new Date(afterDate),
        });
      }

      if (cursor) {
        if (direction === 'after') {
          queryBuilder.andWhere('message.id > :cursor', { cursor });
          queryBuilder.orderBy('message.id', 'ASC');
        } else {
          queryBuilder.andWhere('message.id < :cursor', { cursor });
          queryBuilder.orderBy('message.id', 'DESC');
        }
      } else {
        queryBuilder.orderBy('message.id', 'DESC');
      }

      queryBuilder.take(limit + 1);

      const messages = await queryBuilder.getMany();
      const hasMore = messages.length > limit;
      const resultMessages = hasMore ? messages.slice(0, limit) : messages;

      // If we fetched 'after', the results are in ASC order.
      // We want to return them in DESC order (newest first) for UI consistency (flex-col-reverse)
      if (direction === 'after') {
        resultMessages.reverse();
      }

      const response = await this.hydrateMessages(resultMessages, manager);

      return {
        messages: response,
        nextCursor: hasMore
          ? direction === 'after'
            ? resultMessages[0].id // Newest is at index 0 after reverse
            : resultMessages[resultMessages.length - 1].id // Oldest is at end
          : undefined,
      };
    });
  }

  async getMessageById(
    id: string,
    userId: string,
  ): Promise<MessageResponseDto> {
    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);
      const message = await messageRepo.findOne({
        where: { id },
        relations: ['reactions', 'mentions', 'attachments'],
      });

      if (!message) {
        throw new RpcException(MESSAGE_ERROR.MESSAGE_NOT_FOUND);
      }

      // Check membership
      await this.checkChannelExist(message.channelId, userId);

      const [dto] = await this.hydrateMessages([message], manager, userId);
      return dto;
    });
  }

  async updateMessage(
    id: string,
    userId: string,
    updateDto: UpdateMessageDto,
  ): Promise<MessageResponseDto> {
    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);
      const message = await messageRepo.findOne({ where: { id } });

      if (!message) {
        throw new RpcException(MESSAGE_ERROR.MESSAGE_NOT_FOUND);
      }

      if (message.userId !== userId) {
        throw new RpcException(MESSAGE_ERROR.NOT_ALLOWED_EDIT);
      }

      // Check membership
      await this.checkChannelExist(message.channelId, userId);

      message.content = updateDto.content;

      if (updateDto.toolCalls !== undefined) {
        message.toolCalls = updateDto.toolCalls;
      }

      if (updateDto.attachments) {
        const attachmentRepo = manager.getRepository(MessageAttachmentEntity);
        await attachmentRepo.delete({ messageId: id });

        if (updateDto.attachments.length > 0) {
          const attachmentEntities = updateDto.attachments.map((a) =>
            attachmentRepo.create({
              messageId: id,
              resourceId: a.id,
              publicId: a.publicId,
              url: a.url,
              filename: a.filename,
              mimeType: a.mimeType,
              size: a.size,
              type: a.type,
              thumbnailUrl: a.thumbnailUrl,
            }),
          );
          await attachmentRepo.save(attachmentEntities);
        }
      }

      if (updateDto.mentions) {
        const mentionRepo = manager.getRepository(MessageMentionEntity);
        await mentionRepo.delete({ messageId: id });

        const actualMentions = updateDto.mentions.filter((id) => id !== 'all');
        if (actualMentions.length > 0) {
          const mentionEntities = actualMentions.map((mentionUserId) =>
            mentionRepo.create({
              messageId: id,
              userId: mentionUserId,
            }),
          );
          await mentionRepo.save(mentionEntities);
        }
      }
      const updatedMessage = await messageRepo.save(message);
      const freshMessage = await messageRepo.findOne({
        where: { id: updatedMessage.id },
        relations: ['reactions', 'mentions', 'attachments'],
      });
      const [response] = await this.hydrateMessages([freshMessage!], manager);
      // Emit Socket Event
      const targetRooms = [updatedMessage.channelId];
      if (updatedMessage.parentId) {
        targetRooms.push(`thread_${updatedMessage.parentId}`);
      } else {
        targetRooms.push(`thread_${updatedMessage.id}`);
      }

      await this.queueService.addJob(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        {
          event: ESocketEvent.MESSAGE_UPDATED,
          room: targetRooms,
          data: response,
        },
      );

      this.queueService.addJob(
        EQueueName.AUDIT_QUEUE,
        EJobName.SAVE_AUDIT_LOG,
        {
          action: AuditAction.MESSAGE_EDITED,
          actorId: userId,
          entityType: AuditEntityType.MESSAGE,
          entityId: updatedMessage.id,
          metadata: { channelId: updatedMessage.channelId },
        },
      );

      // Update resource metadata if attachments changed

      if (updateDto.attachments && updateDto.attachments.length > 0) {
        await this.queueService.addJob(
          EQueueName.RESOURCE_QUEUE,
          EJobName.UPDATE_RESOURCE_METADATA,
          {
            resourceIds: updateDto.attachments.map(
              (a: IMessageAttachment) => a.id,
            ),
            refType: 'message',
            refId: updatedMessage.id,
          },
        );
      }

      return response;
    });
  }

  async deleteMessage(id: string, userId: string): Promise<boolean> {
    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);
      const message = await messageRepo.findOne({ where: { id } });

      if (!message) {
        throw new RpcException(MESSAGE_ERROR.MESSAGE_NOT_FOUND);
      }

      if (message.userId !== userId) {
        throw new RpcException(MESSAGE_ERROR.NOT_ALLOWED_DELETE);
      }

      // Check membership
      await this.checkChannelExist(message.channelId, userId);

      const messageId = message.id;
      const channelId = message.channelId;
      const parentId = message.parentId;

      await messageRepo.remove(message);

      // Emit Socket Event
      if (parentId) {
        await this.queueService.addJob(
          EQueueName.SOCKET_QUEUE,
          EJobName.EMIT_EVENT,
          {
            event: ESocketEvent.MESSAGE_DELETED,
            room: [`thread_${parentId}`, channelId], // Phát đồng thời tới cả 2 phòng
            data: {
              messageId,
              userId,
              channelId,
              parentId,
            },
          },
        );
      } else {
        // Normal message deletion
        await this.queueService.addJob(
          EQueueName.SOCKET_QUEUE,
          EJobName.EMIT_EVENT,
          {
            event: ESocketEvent.MESSAGE_DELETED,
            room: [channelId, `thread_${messageId}`], // Phát đồng thời tới channel và room thread của chính nó
            data: {
              messageId,
              userId,
              channelId,
              parentId,
            },
          },
        );
      }

      this.queueService.addJob(
        EQueueName.AUDIT_QUEUE,
        EJobName.SAVE_AUDIT_LOG,
        {
          action: AuditAction.MESSAGE_DELETED,
          actorId: userId,
          entityType: AuditEntityType.MESSAGE,
          entityId: messageId,
          metadata: { channelId },
        },
      );

      return true;
    });
  }

  async toggleReaction(
    userId: string,
    toggleDto: ToggleReactionDto,
  ): Promise<boolean> {
    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);
      const message = await messageRepo.findOne({
        where: { id: toggleDto.messageId },
      });
      if (!message) throw new RpcException(MESSAGE_ERROR.MESSAGE_NOT_FOUND);

      // Check membership
      await this.checkChannelExist(message.channelId, userId);

      const reactionRepo = manager.getRepository(MessageReactionEntity);
      const { messageId, emoji } = toggleDto;

      const existing = await reactionRepo.findOne({
        where: { messageId, userId, emoji },
      });

      let isAdded = false;
      if (existing) {
        await reactionRepo.remove(existing);
        isAdded = false;
      } else {
        const reaction = reactionRepo.create({
          messageId,
          userId,
          emoji,
        });
        await reactionRepo.save(reaction);
        isAdded = true;
      }

      // Emit Socket Event cho Reaction
      const updatedMessage = await this.getMessageById(
        toggleDto.messageId,
        userId,
      );

      const reactionRooms = [updatedMessage.channelId];
      if (updatedMessage.parentId) {
        reactionRooms.push(`thread_${updatedMessage.parentId}`);
      } else {
        reactionRooms.push(`thread_${updatedMessage.id}`);
      }

      await this.queueService.addJob(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        {
          event: ESocketEvent.REACTION_UPDATED,
          room: reactionRooms, // Reaction bắn về cả channel và thread tương ứng
          data: {
            messageId: updatedMessage.id,
            reactions: updatedMessage.reactions,
            userId,
            emoji,
            isAdded,
          },
        },
      );

      // Bắn thông báo tới Activity khi có Reaction mới
      if (isAdded && updatedMessage.sender.id !== userId) {
        const channel = await this.checkChannelExist(
          updatedMessage.channelId,
          userId,
        );
        const userMap = await this.getUsersInfo([userId]);
        const reactor = userMap.get(userId);
        const reactorName = reactor
          ? `${reactor.firstName} ${reactor.lastName}`
          : 'User';

        await this.queueService.addJob(
          EQueueName.NOTIFICATION_QUEUE,
          EJobName.CREATE_NOTIFICATION,
          {
            channelId: updatedMessage.channelId,
            channelName: channel.name || 'Direct Message',
            senderId: userId,
            senderName: reactorName,
            messageId: updatedMessage.id,
            workspaceId: channel.workspaceId,
            content: JSON.stringify(updatedMessage.content),
            reaction: emoji,
            recipientId: updatedMessage.sender.id,
          },
        );
      }

      return isAdded;
    });
  }

  /**
   * Feedback (like/unlike) — CHỈ cho phép trên message DO BOT gửi (đo độ
   * chính xác câu trả lời AI), khác toggleReaction() ở trên vốn cho phép
   * react tin nhắn bất kỳ. 1 user chỉ có ĐÚNG 1 trạng thái/message (unique
   * messageId+userId, không kèm type) — bấm lại đúng lựa chọn cũ thì bỏ vote
   * (toggle off) thay vì cộng dồn.
   */
  async toggleFeedback(
    userId: string,
    toggleDto: ToggleFeedbackDto,
  ): Promise<boolean> {
    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);
      const message = await messageRepo.findOne({
        where: { id: toggleDto.messageId },
      });
      if (!message) throw new RpcException(MESSAGE_ERROR.MESSAGE_NOT_FOUND);

      // Check membership
      await this.checkChannelExist(message.channelId, userId);

      if (!message.userId) throw new RpcException(MESSAGE_ERROR.NOT_AI_MESSAGE);
      const senderMap = await this.getUsersInfo([message.userId]);
      if (!senderMap.get(message.userId)?.isBot) {
        throw new RpcException(MESSAGE_ERROR.NOT_AI_MESSAGE);
      }

      const feedbackRepo = manager.getRepository(MessageFeedbackEntity);
      const { messageId, type } = toggleDto;

      const existing = await feedbackRepo.findOne({
        where: { messageId, userId },
      });

      let myFeedback: 'like' | 'unlike' | null;
      if (existing && existing.type === type) {
        await feedbackRepo.remove(existing);
        myFeedback = null;
      } else if (existing) {
        existing.type = type;
        await feedbackRepo.save(existing);
        myFeedback = type;
      } else {
        const feedback = feedbackRepo.create({ messageId, userId, type });
        await feedbackRepo.save(feedback);
        myFeedback = type;
      }

      // Room RIÊNG của user (không phải channel/thread như reaction) —
      // feedback là tín hiệu private theo viewer, không phải cảm xúc công
      // khai cho cả channel thấy. Chỉ để đồng bộ nhiều tab/thiết bị của
      // CHÍNH người vừa bấm.
      await this.queueService.addJob(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        {
          event: ESocketEvent.MESSAGE_FEEDBACK_UPDATED,
          room: [`user_${userId}`],
          data: { messageId, myFeedback },
        },
      );

      return true;
    });
  }

  async togglePin(id: string, userId: string): Promise<boolean> {
    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);
      const message = await messageRepo.findOne({ where: { id } });
      if (!message) throw new RpcException(MESSAGE_ERROR.MESSAGE_NOT_FOUND);

      // Check membership
      await this.checkChannelExist(message.channelId, userId);

      message.isPinned = !message.isPinned;
      await messageRepo.save(message);

      // Invalidate pinned list cache
      await this.cachedService.invalidateList(
        CACHE.MESSAGE.TRACKERS.PINNED_VERSION(message.channelId),
      );

      return message.isPinned;
    });
  }

  async searchMessages(
    query: SearchMessagesQueryDto,
  ): Promise<{ messages: MessageResponseDto[]; nextCursor?: string }> {
    const { keyword, channelId, senderId, limit = 20, cursor } = query;
    // Check channel permission
    await this.checkChannelExist(channelId, senderId);

    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);
      const queryBuilder = messageRepo
        .createQueryBuilder('message')
        .leftJoinAndSelect('message.reactions', 'reaction')
        .leftJoinAndSelect('message.mentions', 'mention')
        .leftJoinAndSelect('message.attachments', 'attachment')
        .where('message.channelId = :channelId', { channelId });

      // 1. Prepare keyword for prefix matching
      // Replace spaces with ' & ' and add ':*' to each word
      const formattedKeyword = keyword
        .trim()
        .replace(/[&|!():*]/g, '') // Remove characters with special meaning in tsquery
        .split(/\s+/)
        .filter((word) => word.length > 0)
        .map((word) => `${word}:*`)
        .join(' & ');

      if (!formattedKeyword) {
        return { messages: [], nextCursor: undefined };
      }

      // 2. Use to_tsvector on jsonb directly to only search values, not keys
      queryBuilder.andWhere(
        "to_tsvector('simple', message.content) @@ to_tsquery('simple', :formattedKeyword)",
        { formattedKeyword },
      );

      if (cursor) {
        queryBuilder.andWhere('message.id < :cursor', { cursor });
      }

      queryBuilder.orderBy('message.id', 'DESC').take(limit + 1);

      const messages = await queryBuilder.getMany();
      const hasMore = messages.length > limit;
      const resultMessages = hasMore ? messages.slice(0, limit) : messages;

      const response = await this.hydrateMessages(resultMessages, manager);
      return {
        messages: response,
        nextCursor: hasMore
          ? resultMessages[resultMessages.length - 1].id
          : undefined,
      };
    });
  }

  async getPinnedMessages(
    query: GetPinnedMessagesQueryDto,
  ): Promise<{ messages: MessageResponseDto[]; nextCursor?: string }> {
    const { channelId, userId, limit = 20, cursor } = query;

    // Check membership
    await this.checkChannelExist(channelId, userId);

    return this.cachedService.getOrSetList({
      trackerKey: CACHE.MESSAGE.TRACKERS.PINNED_VERSION(channelId),
      keyBuilder: (version) =>
        CACHE.MESSAGE.KEYS.PINNED_LIST(channelId, version, limit, cursor),
      ttl: TTL.SHORT,
      fetcher: async () => {
        return await this.dataSource.transaction(async (manager) => {
          const messageRepo = manager.getRepository(MessageEntity);

          const queryBuilder = messageRepo
            .createQueryBuilder('message')
            .leftJoinAndSelect('message.reactions', 'reaction')
            .leftJoinAndSelect('message.mentions', 'mention')
            .leftJoinAndSelect('message.attachments', 'attachment')
            .where('message.channelId = :channelId', { channelId })
            .andWhere('message.isPinned = true');

          if (cursor) {
            queryBuilder.andWhere('message.id < :cursor', { cursor });
          }

          queryBuilder.orderBy('message.id', 'DESC').take(limit + 1);

          const messages = await queryBuilder.getMany();
          const hasMore = messages.length > limit;
          const resultMessages = hasMore ? messages.slice(0, limit) : messages;

          const response = await this.hydrateMessages(resultMessages, manager);

          return {
            messages: response,
            nextCursor: hasMore
              ? resultMessages[resultMessages.length - 1].id
              : undefined,
          };
        });
      },
    });
  }

  async getSurroundingMessages(
    query: GetSurroundingMessagesQueryDto,
  ): Promise<SurroundingMessageResponseDto> {
    const { channelId, userId, targetMessageId, limit = 20 } = query;

    // Check membership
    await this.checkChannelExist(channelId, userId);

    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);
      const halfLimit = Math.floor(limit / 2);

      // 1. Get messages older than or equal to target (including target)
      const olderMessages = await messageRepo
        .createQueryBuilder('message')
        .leftJoinAndSelect('message.reactions', 'reaction')
        .leftJoinAndSelect('message.mentions', 'mention')
        .leftJoinAndSelect('message.attachments', 'attachment')
        .where('message.channelId = :channelId', { channelId })
        .andWhere('message.id <= :targetId', { targetId: targetMessageId })
        .orderBy('message.id', 'DESC')
        .take(halfLimit + 1)
        .getMany();

      // 2. Get messages newer than target
      const newerMessages = await messageRepo
        .createQueryBuilder('message')
        .leftJoinAndSelect('message.reactions', 'reaction')
        .leftJoinAndSelect('message.mentions', 'mention')
        .leftJoinAndSelect('message.attachments', 'attachment')
        .where('message.channelId = :channelId', { channelId })
        .andWhere('message.id > :targetId', { targetId: targetMessageId })
        .orderBy('message.id', 'ASC')
        .take(halfLimit + 1)
        .getMany();

      const hasMoreBefore = olderMessages.length > halfLimit;
      const hasMoreAfter = newerMessages.length > halfLimit;

      const resultOlder = hasMoreBefore
        ? olderMessages.slice(0, halfLimit)
        : olderMessages;
      const resultNewer = hasMoreAfter
        ? newerMessages.slice(0, halfLimit)
        : newerMessages;

      // Combine: Newer (reversed to be DESC) + Older (already DESC)
      const combinedMessages = [...resultNewer.reverse(), ...resultOlder];

      const response = await this.hydrateMessages(combinedMessages, manager);

      return {
        messages: response,
        hasMoreBefore,
        hasMoreAfter,
      };
    });
  }

  /**
   * Helper to populate user info and metadata for a list of messages.
   * `viewerUserId` — CHỈ getMessageById() truyền (dùng cho response sau khi
   * toggle feedback) — tính myFeedback (trạng thái vote RIÊNG của viewer này,
   * khác reactions vốn là aggregate cho mọi người). Danh sách/tìm kiếm message
   * KHÔNG truyền, myFeedback sẽ luôn undefined ở các nơi đó (chưa cần thiết,
   * xem message_feedback.entity.ts).
   */
  public async hydrateMessages(
    messages: MessageEntity[],
    manager?: EntityManager,
    viewerUserId?: string,
  ): Promise<MessageResponseDto[]> {
    if (messages.length === 0) return [];

    let myFeedbackMap = new Map<string, 'like' | 'unlike'>();
    if (viewerUserId) {
      const feedbackRepo = manager
        ? manager.getRepository(MessageFeedbackEntity)
        : this.dataSource.getRepository(MessageFeedbackEntity);
      const feedbackRows = await feedbackRepo.find({
        where: {
          messageId: In(messages.map((m) => m.id)),
          userId: viewerUserId,
        },
      });
      myFeedbackMap = new Map(feedbackRows.map((f) => [f.messageId, f.type]));
    }

    // 1. Get all user IDs involved (senders + mention users)
    const userIds = new Set<string>();
    messages.forEach((m) => {
      if (m.userId) {
        userIds.add(m.userId);
      }
      m.mentions?.forEach((men) => {
        if (men.userId !== 'all') {
          userIds.add(men.userId);
        }
      });
    });

    const userMap = await this.getUsersInfo(Array.from(userIds));

    // 2. Get reply counts for parent messages
    const replyCounts = new Map<string, number>();
    const parentIds = messages.map((m) => m.id);

    const repo = manager
      ? manager.getRepository(MessageEntity)
      : this.messageRepository;

    const counts = await repo
      .createQueryBuilder('m')
      .select('m.parent_id', 'parentId')
      .addSelect('COUNT(m.id)', 'count')
      .where('m.parent_id IN (:...parentIds)', { parentIds })
      .groupBy('m.parent_id')
      .getRawMany();

    counts.forEach((c) => replyCounts.set(c.parentId, parseInt(c.count)));

    // 3. Map to DTOs
    return messages.map((m) => {
      const reactions = this.groupReactions(m.reactions || []);
      const dto = this.mapToResponseDto(
        m,
        m.userId ? userMap.get(m.userId) : undefined,
        reactions,
        m.mentions || [],
        viewerUserId ? (myFeedbackMap.get(m.id) ?? null) : undefined,
      );
      dto.replyCount = replyCounts.get(m.id) || 0;
      return dto;
    });
  }

  /**
   * Helper to group reactions by emoji
   */
  private groupReactions(
    reactions: MessageReactionEntity[],
  ): ReactionResponseDto[] {
    const groups = new Map<string, ReactionResponseDto>();
    reactions.forEach((r) => {
      if (!groups.has(r.emoji)) {
        groups.set(r.emoji, { emoji: r.emoji, count: 0, userIds: [] });
      }
      const group = groups.get(r.emoji);
      if (group) {
        group.count++;
        group.userIds.push(r.userId);
      }
    });
    return Array.from(groups.values());
  }

  /**
   * Helper to map message entity to DTO
   */
  private mapToResponseDto(
    message: MessageEntity,
    sender?: UserResponseDto,
    reactions: ReactionResponseDto[] = [],
    mentions: any[] = [],
    myFeedback?: 'like' | 'unlike' | null,
  ): MessageResponseDto {
    const dto = new MessageResponseDto();
    dto.id = message.id;
    dto.channelId = message.channelId;
    dto.myFeedback = myFeedback;
    try {
      dto.content =
        typeof message.content === 'string' &&
        (message.content.startsWith('{') || message.content.startsWith('['))
          ? JSON.parse(message.content)
          : message.content;
    } catch {
      dto.content = message.content;
    }
    dto.attachments = (message.attachments || []).map((a) => ({
      id: a.resourceId,
      publicId: a.publicId, // This might need to be fetched if not stored, but I added it to the entity
      url: a.url,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      type: a.type,
      thumbnailUrl: a.thumbnailUrl,
    }));
    dto.isPinned = message.isPinned;
    dto.parentId = message.parentId;
    dto.createdAt = message.createdAt;
    dto.updatedAt = message.updatedAt;

    if (message.webhookId) {
      dto.sender = {
        id: message.webhookId,
        firstName: message.customName || 'APP',
        lastName: '',
        avatarUrl: message.customAvatarUrl || '',
        email: '',
        isApp: true,
      };
    } else {
      dto.sender = sender || {
        id: message.userId,
        firstName: 'Unknown',
        lastName: 'User',
        avatarUrl: '',
        email: '',
      };
    }

    dto.reactions = reactions;
    const allMentions = mentions.map((m) => ({ userId: m.userId }));
    const isMentionAll =
      typeof message.content === 'string'
        ? message.content.includes('"id":"all"')
        : JSON.stringify(message.content).includes('"id":"all"');
    if (isMentionAll && !allMentions.some((m) => m.userId === 'all')) {
      allMentions.push({ userId: 'all' });
    }
    dto.mentions = allMentions;
    dto.replyCount = 0;
    dto.linkPreviews = message.linkPreviews;
    dto.toolCalls = message.toolCalls;
    return dto;
  }
}
