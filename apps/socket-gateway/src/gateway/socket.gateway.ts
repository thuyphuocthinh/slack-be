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
import { AuthCacheService } from '@slack/cached';
import { WebsocketExceptionsFilter } from '../common/filters/ws-exception.filter';
import { OnModuleInit } from '@nestjs/common';
import { createBreaker } from '../common/utils/circuit-breaker.util';
import CircuitBreaker from 'opossum';
import {
  ESocketEvent,
  NAME_SERVICE_TCP,
  CHANNEL_MESSAGE_PATTERN,
} from '@slack/constants';
import { Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { MESSAGE_MESSAGE_PATTERNS } from '@slack/constants';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  pingInterval: 30000,
  pingTimeout: 5000,
})
@UseFilters(new WebsocketExceptionsFilter())
@UsePipes(new ValidationPipe({ transform: true }))
export class SocketGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SocketGateway.name);
  private channelBreaker: CircuitBreaker;
  private messageBreaker: CircuitBreaker;

  constructor(
    private readonly jwtService: JwtService,
    private readonly authCache: AuthCacheService,
    @Inject(NAME_SERVICE_TCP.CHANNEL_SERVICE)
    private readonly channelClient: ClientProxy,
    @Inject(NAME_SERVICE_TCP.MESSAGE_SERVICE)
    private readonly messageClient: ClientProxy,
  ) {}

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
    const payload = this.jwtService.verify(token);

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
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage(ESocketEvent.SUBSCRIBE_CHANNEL)
  async handleSubscribeChannel(client: Socket, payload: { channelId: string }) {
    const { channelId } = payload;
    if (!channelId) return;

    const userId = client.data.user.sub;

    try {
      // Sử dụng Circuit Breaker thay vì gọi trực tiếp
      await this.channelBreaker.fire({
        channelId,
        memberId: userId,
      });

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

  @SubscribeMessage(ESocketEvent.SUBSCRIBE_THREAD)
  async handleSubscribeThread(client: Socket, payload: { threadId: string }) {
    const { threadId } = payload;
    if (!threadId) return;

    const userId = client.data.user.sub;

    try {
      // Sử dụng Circuit Breaker cho Thread
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
    const { threadId } = payload;
    if (!threadId) return;

    const roomName = `thread_${threadId}`;
    client.leave(roomName);
    this.logger.debug(`User ${client.id} left thread: ${roomName}`);
    client.emit(ESocketEvent.THREAD_UNSUBSCRIBED, { threadId });
    return { status: 'success', room: roomName };
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
    this.channelClient.emit(CHANNEL_MESSAGE_PATTERN.MARK_AS_READ, {
      channelId,
      memberId: userId,
      lastMessageId,
    });

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
}
