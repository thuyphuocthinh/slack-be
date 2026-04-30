import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  CreateMessageDto,
  UpdateMessageDto,
  MessageResponseDto,
  GetMessagesQueryDto,
  ToggleReactionDto,
  UserResponseDto,
  ReactionResponseDto,
} from '../dto';
import { ClientProxy, RpcException } from '@nestjs/microservices';
import {
  CHANNEL_MESSAGE_PATTERN,
  MESSAGE_ERROR,
  NAME_SERVICE_TCP,
  USER_MESSAGE_PATTERNS,
} from '@slack/constants';
import { InjectRepository } from '@nestjs/typeorm';
import { MessageEntity } from '../entity/message.entity';
import { DataSource, Repository } from 'typeorm';
import { MessageMentionEntity } from '../entity/message_mention.entity';
import { MessageReactionEntity } from '../entity/message_reaction.entity';
import { firstValueFrom } from 'rxjs';
import { v7 as uuidv7 } from 'uuid';

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
  ) {}

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
          userIds: [...new Set(userIds)],
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

  async createMessage(
    createMessageDto: CreateMessageDto,
  ): Promise<MessageResponseDto> {
    const { channelId, senderId, content, parentId, mentions } =
      createMessageDto;

    // check channel exist
    await this.checkChannelExist(channelId, senderId);

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

      // 4. Handle mentions
      if (mentions && mentions.length > 0) {
        const mentionEntities = mentions.map((userId) =>
          manager.create(MessageMentionEntity, {
            messageId: savedMessage.id,
            userId,
          }),
        );
        await manager.save(mentionEntities);
      }

      // 5. Hydrate and return
      // We reload to get relations if needed, but since we just saved,
      // we can manually populate or just let hydrateMessages handle it (it will fetch user info)
      const [response] = await this.hydrateMessages([savedMessage], manager);
      return response;
    });
  }

  async getMessages(
    query: GetMessagesQueryDto,
  ): Promise<{ messages: MessageResponseDto[]; nextCursor?: string }> {
    // cursor - id of message (uuidv7 is sortable)
    // cursor mean "old messages" => message id is less than cursor, like "get messages before this cursor"
    // cursor !== offset that cursor does not start from the beginning and skip "offset" messages
    const { channelId, parentId, limit = 20, cursor } = query;

    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);

      const queryBuilder = messageRepo
        .createQueryBuilder('message')
        .leftJoinAndSelect('message.reactions', 'reaction')
        .leftJoinAndSelect('message.mentions', 'mention')
        .where('message.channelId = :channelId', { channelId });

      if (parentId) {
        queryBuilder.andWhere('message.parentId = :parentId', { parentId });
      } else {
        queryBuilder.andWhere('message.parentId IS NULL');
      }

      if (cursor) {
        // UUIDv7 is sortable, so we can use LessThan for "older" messages
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

  async getMessageById(id: string): Promise<MessageResponseDto> {
    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);
      const message = await messageRepo.findOne({
        where: { id },
        relations: ['reactions', 'mentions'],
      });

      if (!message) {
        throw new RpcException(MESSAGE_ERROR.MESSAGE_NOT_FOUND);
      }

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

      message.content =
        typeof updateDto.content === 'string'
          ? updateDto.content
          : JSON.stringify(updateDto.content);
      await messageRepo.save(message);

      return this.getMessageById(id);
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

      await messageRepo.remove(message);
      return true;
    });
  }

  async toggleReaction(
    userId: string,
    toggleDto: ToggleReactionDto,
  ): Promise<boolean> {
    return await this.dataSource.transaction(async (manager) => {
      const reactionRepo = manager.getRepository(MessageReactionEntity);
      const { messageId, emoji } = toggleDto;

      const existing = await reactionRepo.findOne({
        where: { messageId, userId, emoji },
      });

      if (existing) {
        await reactionRepo.remove(existing);
        return false; // removed
      } else {
        const reaction = reactionRepo.create({
          messageId,
          userId,
          emoji,
        });
        await reactionRepo.save(reaction);
        return true; // added
      }
    });
  }

  async togglePin(id: string): Promise<boolean> {
    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);
      const message = await messageRepo.findOne({ where: { id } });
      if (!message) throw new RpcException(MESSAGE_ERROR.MESSAGE_NOT_FOUND);
      message.isPinned = !message.isPinned;
      await messageRepo.save(message);
      return message.isPinned;
    });
  }

  async searchMessages(query: {
    keyword: string;
    channelId: string;
    senderId: string;
  }) {
    const { keyword, channelId, senderId } = query;
    // Check channel permission
    await this.checkChannelExist(channelId, senderId);

    return await this.dataSource.transaction(async (manager) => {
      const messageRepo = manager.getRepository(MessageEntity);
      const queryBuilder = messageRepo
        .createQueryBuilder('message')
        .leftJoinAndSelect('message.reactions', 'reaction')
        .leftJoinAndSelect('message.mentions', 'mention')
        .where('message.channelId = :channelId', { channelId });

      // Use Full Text Search on JSONB content cast to text
      queryBuilder.andWhere(
        "to_tsvector('simple', message.content::text) @@ plainto_tsquery('simple', :keyword)",
        { keyword },
      );

      queryBuilder.orderBy('message.id', 'DESC').take(50);

      const messages = await queryBuilder.getMany();
      return await this.hydrateMessages(messages, manager);
    });
  }

  /**
   * Helper to populate user info and metadata for a list of messages
   */
  private async hydrateMessages(
    messages: MessageEntity[],
    manager?: any,
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
