import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseFilters, UsePipes, ValidationPipe } from '@nestjs/common';
import { SocketService } from '../services/socket.service';
import { JwtService } from '@nestjs/jwt';
import { AuthCacheService } from '@slack/cached';
import { WebsocketExceptionsFilter } from '../common/filters/ws-exception.filter';
import { SubscribeChannelDto } from '../dto/subscribe-channel.dto';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  pingInterval: 30000,
  pingTimeout: 5000,
})
@UseFilters(new WebsocketExceptionsFilter())
@UsePipes(new ValidationPipe({ transform: true }))
export class SocketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(SocketGateway.name);

  constructor(
    private readonly socketService: SocketService,
    private readonly jwtService: JwtService,
    private readonly authCache: AuthCacheService,
  ) {}

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
    } catch (error) {
      this.logger.warn(
        `Authentication failed for client ${client.id}: ${error.message}`,
      );
      client.disconnect(); // Ngắt kết nối nếu không hợp lệ
    }
  }

  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    // Dọn dẹp các subscription khi client ngắt kết nối
    const rooms = Array.from(client.rooms);
    for (const room of rooms) {
      if (room !== client.id) {
        await this.socketService.unsubscribeChannel(room);
      }
    }
  }

  @SubscribeMessage('subscribe_channel')
  async handleSubscribeChannel(
    client: Socket,
    @MessageBody() payload: SubscribeChannelDto,
  ) {
    const { channelId } = payload;
    if (!channelId) return;

    this.logger.log(
      `User ${client.data.user?.sub} subscribing to channel: ${channelId}`,
    );

    client.join(channelId);

    await this.socketService.subscribeChannel(channelId, (data) => {
      this.server.to(channelId).emit('message_received', data);
    });
  }

  @SubscribeMessage('unsubscribe_channel')
  async handleUnsubscribeChannel(
    client: Socket,
    payload: { channelId: string },
  ) {
    const { channelId } = payload;
    if (!channelId) return;

    client.leave(channelId);
    await this.socketService.unsubscribeChannel(channelId);
  }
}
