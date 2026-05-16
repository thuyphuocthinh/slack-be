import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CreateMessageDto,
  UpdateMessageDto,
  MessageResponseDto,
  GetMessagesQueryDto,
  ToggleReactionDto,
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
  MESSAGE_ERROR,
  NAME_SERVICE_TCP,
  USER_MESSAGE_PATTERNS,
  ESocketEvent,
} from '@slack/constants';
import { InjectRepository } from '@nestjs/typeorm';
import { MessageEntity } from '../entity/message.entity';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { MessageMentionEntity } from '../entity/message_mention.entity';
import { MessageReactionEntity } from '../entity/message_reaction.entity';
import { MessageAttachmentEntity } from '../entity/message_attachment.entity';
import { firstValueFrom } from 'rxjs';
import { v7 as uuidv7 } from 'uuid';
import { EQueueName, EJobName, QueueService } from '@slack/queue';
import { IMessageAttachment } from '../types/message-attachment.interface';
import { CACHE, CachedService, TTL } from '@slack/cached';
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
  ) { }

  private async checkChannelExist(channelId: string, senderId: string) {
    try {
      const channel = await firstValueFrom(
        this.channelService.send(CHANNEL_MESSAGE_PATTERN.GET_CHANNEL, {
          channelId,
          senderId,
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
      const mentionEntities = createMessageDto.mentions.map((userId) =>
        manager.create(MessageMentionEntity, {
          messageId: savedMessage.id,
          userId,
        }),
      );
      savedMessage.mentions = await manager.save(mentionEntities);
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
    const targetRoom = response.parentId
      ? `thread_${response.parentId}`
      : response.channelId;

    await this.queueService.addJob(
      EQueueName.SOCKET_QUEUE,
      EJobName.EMIT_EVENT,
      {
        event: ESocketEvent.MESSAGE_RECEIVED,
        room: targetRoom,
        data: response,
      },
    );

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
      }
    }

    // 7. Push to Notification Queue (Background)
    await this.queueService.addJob(
      EQueueName.NOTIFICATION_QUEUE,
      EJobName.CREATE_NOTIFICATION,
      {
        channelId: response.channelId,
        channelName: channel.name,
        senderId: response.sender.id,
        senderName: response.sender.firstName + ' ' + response.sender.lastName,
        messageId: response.id,
        mentions: response.mentions,
        parentId: response.parentId || undefined,
        workspaceId: channel.workspaceId,
        content: JSON.stringify(response.content),
      },
    );

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

  async createMessage(
    createMessageDto: CreateMessageDto,
  ): Promise<MessageResponseDto> {
    const { channelId, senderId, content, parentId } = createMessageDto;

    // check channel exist
    const channel = await this.checkChannelExist(channelId, senderId);

    return await this.dataSource.transaction(async (manager) => {
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
        content:
          typeof content === 'string' ? content : JSON.stringify(content),
        parentId,
      });

      const savedMessage = await manager.save(message);

      // 4. Handle mentions and attachments
      await this.handleMentionsAndAttachments(savedMessage, createMessageDto, manager);

      // 5. Hydrate and return
      const [response] = await this.hydrateMessages([savedMessage], manager);

      // 6. Broadcast events and queues
      await this.broadcastMessageEvents(response, channel, savedMessage, manager);

      return response;
    });
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

      const [dto] = await this.hydrateMessages([message], manager);
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

      message.content =
        typeof updateDto.content === 'string'
          ? updateDto.content
          : JSON.stringify(updateDto.content);

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

        if (updateDto.mentions.length > 0) {
          const mentionEntities = updateDto.mentions.map((mentionUserId) =>
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
        relations: ['reactions', 'mentions'],
      });
      const [response] = await this.hydrateMessages([freshMessage!], manager);
      // Emit Socket Event
      const targetRoom = updatedMessage.parentId
        ? `thread_${updatedMessage.parentId}`
        : updatedMessage.channelId;

      await this.queueService.addJob(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        {
          event: ESocketEvent.MESSAGE_UPDATED,
          room: targetRoom,
          data: response,
        },
      );

      this.queueService.addJob(EQueueName.AUDIT_QUEUE, EJobName.SAVE_AUDIT_LOG, {
        action: AuditAction.MESSAGE_EDITED,
        actorId: userId,
        entityType: AuditEntityType.MESSAGE,
        entityId: updatedMessage.id,
        metadata: { channelId: updatedMessage.channelId },
      });


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

      await messageRepo.remove(message);

      // Emit Socket Event
      const targetRoom = message.parentId
        ? `thread_${message.parentId}`
        : message.channelId;
      await this.queueService.addJob(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        {
          event: ESocketEvent.MESSAGE_DELETED,
          room: targetRoom,
          data: {
            messageId: message.id,
            userId,
            channelId: message.channelId,
            parentId: message.parentId,
          },
        },
      );

      this.queueService.addJob(EQueueName.AUDIT_QUEUE, EJobName.SAVE_AUDIT_LOG, {
        action: AuditAction.MESSAGE_DELETED,
        actorId: userId,
        entityType: AuditEntityType.MESSAGE,
        entityId: message.id,
        metadata: { channelId: message.channelId },
      });


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

      await this.queueService.addJob(
        EQueueName.SOCKET_QUEUE,
        EJobName.EMIT_EVENT,
        {
          event: ESocketEvent.REACTION_UPDATED,
          room: updatedMessage.channelId, // Reaction luôn bắn về channel để update UI
          data: {
            messageId: updatedMessage.id,
            reactions: updatedMessage.reactions,
            userId,
            emoji,
            isAdded,
          },
        },
      );

      return isAdded;
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
        .filter(word => word.length > 0)
        .map(word => `${word}:*`)
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
   * Helper to populate user info and metadata for a list of messages
   */
  public async hydrateMessages(
    messages: MessageEntity[],
    manager?: EntityManager,
  ): Promise<MessageResponseDto[]> {
    if (messages.length === 0) return [];

    // 1. Get all user IDs involved (senders + mention users)
    const userIds = new Set<string>();
    messages.forEach((m) => {
      userIds.add(m.userId);
      m.mentions?.forEach((men) => userIds.add(men.userId));
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
        userMap.get(m.userId),
        reactions,
        m.mentions || [],
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
  ): MessageResponseDto {
    const dto = new MessageResponseDto();
    dto.id = message.id;
    dto.channelId = message.channelId;
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
    dto.sender = sender || {
      id: message.userId,
      firstName: 'Unknown',
      lastName: 'User',
      avatarUrl: '',
      email: '',
    };
    dto.reactions = reactions;
    dto.mentions = mentions.map((m) => ({ userId: m.userId }));
    dto.replyCount = 0;
    return dto;
  }
}
