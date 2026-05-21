import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthCacheService, PresenceCacheService, CachedService, CACHE } from '@slack/cached';
import { WebsocketExceptionsFilter } from '../common/filters/ws-exception.filter';
import { OnModuleInit } from '@nestjs/common';
import { createBreaker } from '../common/utils/circuit-breaker.util';
import CircuitBreaker from 'opossum';
import {
  ESocketEvent,
  NAME_SERVICE_TCP,
  CHANNEL_MESSAGE_PATTERN,
  MESSAGE_MESSAGE_PATTERNS,
} from '@slack/constants';
import { Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  pingInterval: 30000,
  pingTimeout: 20000,
})
@UseFilters(new WebsocketExceptionsFilter())
@UsePipes(new ValidationPipe({ transform: true }))
export class SocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SocketGateway.name);
  private channelBreaker: CircuitBreaker;
  private messageBreaker: CircuitBreaker;

  constructor(
    private readonly jwtService: JwtService,
    private readonly authCache: AuthCacheService,
    private readonly presenceCache: PresenceCacheService,
    private readonly cachedService: CachedService,
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.MESSAGE_SERVICE)
    private readonly messageClient: ClientProxy,
  ) { }

  onModuleInit() {
    // Khởi tạo Circuit Breaker cho Channel Service
    this.channelBreaker = createBreaker(
      (data: any) =>
        firstValueFrom(
          this.channelClient.send(CHANNEL_MESSAGE_PATTERN.GET_CHANNEL, data),
        ),
      {
        name: 'ChannelService',
        timeout: 3000,
        errorThresholdPercentage: 50,
        resetTimeout: 10000,
      },
    );

    // Fallback khi Channel Service ngắt mạch
    this.channelBreaker.fallback(() => {
      throw new Error('Channel Service đang gặp sự cố, vui lòng thử lại sau!');
    });

    // Khởi tạo Circuit Breaker cho Message Service
    this.messageBreaker = createBreaker(
      (data: any) =>
        firstValueFrom(
          this.messageClient.send(MESSAGE_MESSAGE_PATTERNS.GET_BY_ID, data),
        ),
      {
        name: 'MessageService',
        timeout: 3000,
        errorThresholdPercentage: 50,
        resetTimeout: 10000,
      },
    );

    this.messageBreaker.fallback(() => {
      throw new Error('Message Service đang gặp sự cố, vui lòng thử lại sau!');
    });
  }

  private async verifyToken(client: Socket) {
    // 1. Lấy token từ handshake (auth object hoặc header)
    const token =
      client.handshake.auth?.token ||
      client.handshake.headers['authorization']?.split(' ')[1];

    if (!token) {
      throw new Error('No token provided');
    }

    // 2. Verify JWT
    const payload = await this.jwtService.verifyAsync(token);

    // 3. Kiểm tra xem token có bị blacklist (đã logout) không
    if (await this.authCache.isBlacklisted(token)) {
      throw new Error('Token is blacklisted');
    }

    // 4. Kiểm tra Token Version (nếu đổi pass/logout thiết bị khác thì ngắt kết nối)
    const currentVersion = await this.authCache.getUserTokenVersion(
      payload.sub,
    );
    if (payload.tokenVersion !== currentVersion) {
      throw new Error('Token version mismatch');
    }

    // 5. Lưu payload vào socket để dùng cho các event sau
    client.data.user = payload;
    client.data.token = token;
    this.logger.log(
      `Client authenticated: ${client.id} (User: ${payload.sub})`,
    );
  }

  async handleConnection(client: Socket) {
    try {
      await this.verifyToken(client);
      const userId = client.data.user.sub;

      // Join vào phòng cá nhân (Nhận: Unread count, Mention, Reaction, v.v.)
      client.join(`user_${userId}`);

      this.logger.log(`User ${userId} connected and joined private room`);

      // Cập nhật trạng thái online ban đầu
      await this.presenceCache.updateLastSeen(userId);

      // Gửi thông báo sẵn sàng
      client.emit(ESocketEvent.SERVER_READY, {
        message: 'Kết nối Socket thành công và đã vào phòng cá nhân!',
        userId,
      });
    } catch (error) {
      this.logger.warn(
        `Authentication failed for client ${client.id}: ${error.message}`,
      );
      client.disconnect();
    }
  }

  // TEST: Sự kiện Ping-Pong
  @SubscribeMessage(ESocketEvent.PING)
  handlePing(client: Socket, data: any) {
    this.logger.log(`Received ping from ${client.id}`);
    return {
      event: ESocketEvent.PONG,
      data: { reply: 'Server is alive!', yourData: data },
    };
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data?.user?.sub;
    if (userId) {
      // Tùy chọn: Xóa ngay lập tức trạng thái để hiện offline nhanh
      await this.presenceCache.removeStatus(userId);
      this.logger.log(`User ${userId} disconnected`);
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage(ESocketEvent.SUBSCRIBE_CHANNEL)
  async handleSubscribeChannel(client: Socket, payload: { channelId: string }) {
    const { channelId } = payload;
    if (!channelId) return;

    const userId = client.data.user.sub;

    try {
      // Dùng cachedService để lưu cache quyền truy cập kênh trong 5 phút (300 giây)
      // tránh spam request TCP sang channel-service dưới tải cao
      const cacheKey = CACHE.CHANNEL.KEYS.ACCESS(channelId, userId);
      await this.cachedService.getOrSetDetail(
        cacheKey,
        300,
        () =>
          this.channelBreaker.fire({
            channelId,
            memberId: userId,
          }),
      );

      // leave all channels before joining new channel
      const currentRooms = Array.from(client.rooms);
      const previousChannelRoom = currentRooms.find(
        (room) => room !== `user_${userId}`,
      );

      if (previousChannelRoom) {
        client.leave(previousChannelRoom);
        this.logger.debug(
          `User ${userId} left channel: ${previousChannelRoom}`,
        );
      }

      client.join(channelId);
      this.logger.debug(`User ${userId} joined channel: ${channelId}`);
      client.emit(ESocketEvent.SUBSCRIBED, { channelId });

      return { status: 'success', room: channelId };
    } catch (error) {
      this.logger.warn(
        `User ${userId} failed to join channel ${channelId}: ${error.message}`,
      );
      return {
        status: 'error',
        message: 'You are not a member of this channel',
      };
    }
  }

  @SubscribeMessage(ESocketEvent.UNSUBSCRIBE_CHANNEL)
  handleUnsubscribeChannel(client: Socket, payload: { channelId: string }) {
    const { channelId } = payload;
    if (!channelId) return;

    client.leave(channelId);
    this.logger.debug(`User ${client.id} left channel: ${channelId}`);
    client.emit(ESocketEvent.UNSUBSCRIBED, { channelId });
    return { status: 'success', room: channelId };
  }

  @SubscribeMessage(ESocketEvent.MESSAGE_READ)
  async handleMessageRead(
    client: Socket,
    payload: { channelId: string; lastMessageId: string },
  ) {
    const { channelId, lastMessageId } = payload;
    if (!channelId || !lastMessageId) return;

    const userId = client.data.user.sub;

    // Gọi sang Channel Service để cập nhật trạng thái đã đọc qua TCP
    try {
      await firstValueFrom(
        this.channelClient.send(CHANNEL_MESSAGE_PATTERN.MARK_AS_READ, {
          channelId,
          memberId: userId,
          lastReadMessageId: lastMessageId,
        }),
      );
    } catch (error) {
      this.logger.error(`Failed to mark as read: ${error.message}`);
      return { status: 'error', message: 'Failed to sync unread status' };
    }

    this.logger.debug(
      `User ${userId} marked channel ${channelId} as read up to ${lastMessageId}`,
    );

    // Bắn ngược lại thông báo unread count = 0 cho chính user đó để update UI tức thì
    client.emit(ESocketEvent.CHANNEL_UNREAD_UPDATED, {
      channelId,
      unreadCount: 0,
    });

    return { status: 'success' };
  }

  @SubscribeMessage(ESocketEvent.USER_START_TYPING)
  handleUserStartTyping(
    client: Socket,
    payload: { channelId?: string; threadId?: string },
  ) {
    try {
      const { channelId, threadId } = payload;
      if (!channelId && !threadId) return;

      const user = client.data.user;
      const userId = user.sub;

      const targetRoom = threadId ? `thread_${threadId}` : channelId;

      this.logger.debug(
        `User ${userId} started typing in ${threadId ? 'thread' : 'channel'} ${targetRoom}`,
      );

      client.to(targetRoom!).emit(ESocketEvent.USER_START_TYPING, {
        userId,
        firstName: user.firstName || '',
        lastName: user.lastName || '',
        email: user.email || '',
        channelId,
        threadId,
      });
    } catch (error) {
      this.logger.error(`Error in handleUserStartTyping: ${error.message}`);
    }
  }

  @SubscribeMessage(ESocketEvent.USER_STOP_TYPING)
  handleUserStopTyping(
    client: Socket,
    payload: { channelId?: string; threadId?: string },
  ) {
    try {
      const { channelId, threadId } = payload;
      if (!channelId && !threadId) return;

      const userId = client.data.user.sub;
      const targetRoom = threadId ? `thread_${threadId}` : channelId;

      this.logger.debug(
        `User ${userId} stopped typing in ${threadId ? 'thread' : 'channel'} ${targetRoom}`,
      );

      client.to(targetRoom!).emit(ESocketEvent.USER_STOP_TYPING, {
        userId,
        channelId,
        threadId,
      });
    } catch (error) {
      this.logger.error(`Error in handleUserStopTyping: ${error.message}`);
    }
  }

  @SubscribeMessage(ESocketEvent.USER_HEARTBEAT)
  async handleUserHeartbeat(client: Socket) {
    try {
      const user = client.data?.user;
      const token = client.data?.token;
      if (!user || !token) {
        client.disconnect();
        return { status: 'error', message: 'Unauthorized' };
      }

      if (await this.authCache.isBlacklisted(token)) {
        this.logger.warn(`Heartbeat rejected: Token blacklisted for user ${user.sub}`);
        client.disconnect();
        return { status: 'error', message: 'Token blacklisted' };
      }

      const currentVersion = await this.authCache.getUserTokenVersion(user.sub);
      if (user.tokenVersion !== currentVersion) {
        this.logger.warn(`Heartbeat rejected: Token version mismatch for user ${user.sub}`);
        client.disconnect();
        return { status: 'error', message: 'Token version mismatch' };
      }

      await this.presenceCache.updateLastSeen(user.sub);
      return { status: 'success' };
    } catch (error) {
      this.logger.error(`Error in handleUserHeartbeat: ${error.message}`);
      client.disconnect();
      return { status: 'error', message: 'Internal server error' };
    }
  }

  @SubscribeMessage(ESocketEvent.USER_PRESENCE_GET)
  async handleGetUserPresence(client: Socket, payload: { userIds: string[] }) {
    try {
      const { userIds } = payload;
      if (!userIds || !Array.isArray(userIds)) return { status: 'error', message: 'Invalid payload' };

      const presences = await this.presenceCache.getPresences(userIds.slice(0, 100));
      client.emit(ESocketEvent.USER_PRESENCE_GET, { status: 'success', presences });
      return { status: 'success', presences };
    } catch (error) {
      this.logger.error(`Error in handleGetUserPresence: ${error.message}`);
      client.emit(ESocketEvent.USER_PRESENCE_GET, { status: 'error', message: 'Failed to fetch presence' });
      return { status: 'error', message: 'Failed to fetch presence' };
    }
  }

  @SubscribeMessage(ESocketEvent.SUBSCRIBE_THREAD)
  async handleSubscribeThread(client: Socket, payload: { threadId: string }) {
    const { threadId } = payload;
    if (!threadId) return;

    const userId = client.data.user.sub;

    try {
      // Sử dụng Circuit Breaker cho Thread (Kiểm tra quyền truy cập nếu cần)
      await this.messageBreaker.fire({
        id: threadId,
        userId,
      });

      const roomName = `thread_${threadId}`;
      client.join(roomName);
      this.logger.debug(`User ${userId} joined thread: ${roomName}`);
      client.emit(ESocketEvent.THREAD_SUBSCRIBED, { threadId });
      return { status: 'success', room: roomName };
    } catch (error) {
      this.logger.warn(
        `User ${userId} failed to join thread ${threadId}: ${error.message}`,
      );
      return {
        status: 'error',
        message: 'You do not have access to this thread',
      };
    }
  }

  @SubscribeMessage(ESocketEvent.UNSUBSCRIBE_THREAD)
  handleUnsubscribeThread(client: Socket, payload: { threadId: string }) {
    try {
      const { threadId } = payload;
      if (!threadId) return;

      const roomName = `thread_${threadId}`;
      client.leave(roomName);
      this.logger.debug(`User ${client.id} left thread: ${roomName}`);
      client.emit(ESocketEvent.THREAD_UNSUBSCRIBED, { threadId });
      return { status: 'success', room: roomName };
    } catch (error) {
      this.logger.error(`Error in handleUnsubscribeThread: ${error.message}`);
      return { status: 'error', message: 'Failed to unsubscribe thread' };
    }
  }
}