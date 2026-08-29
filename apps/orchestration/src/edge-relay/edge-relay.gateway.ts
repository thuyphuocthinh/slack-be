import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RateLimitService } from '@slack/cached';
import { Socket } from 'socket.io';
import { EdgeRelayRegistryService } from './edge-relay-registry.service';

const CONNECT_RATE_LIMIT = { limit: 10, window: 60 };

interface EdgeRelayHandshake {
  workspaceId?: string;
  token?: string;
}

@WebSocketGateway({ namespace: 'edge-relay' })
export class EdgeRelayGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EdgeRelayGateway.name);

  constructor(
    private readonly registry: EdgeRelayRegistryService,
    private readonly jwtService: JwtService,
    private readonly rateLimitService: RateLimitService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const ip = client.handshake.address;
    const allowed = await this.rateLimitService.isAllowed(
      `edge-relay:connect:ip:${ip}`,
      CONNECT_RATE_LIMIT.limit,
      CONNECT_RATE_LIMIT.window,
    );
    if (!allowed) {
      this.logger.warn(
        `Rejected edge relay connection: rate limit exceeded for ip=${ip}`,
      );
      client.disconnect(true);
      return;
    }

    const { workspaceId, token } = client.handshake.auth as EdgeRelayHandshake;

    if (!workspaceId || !token) {
      this.logger.warn('Rejected edge relay connection: missing credentials');
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify(token);
      if (payload.sub !== workspaceId) {
        throw new Error('workspaceId mismatch');
      }
    } catch (error) {
      this.logger.warn(
        `Rejected edge relay connection for workspaceId=${workspaceId}: ${(error as Error).message}`,
      );
      client.disconnect(true);
      return;
    }

    this.registry.bind(workspaceId, client);
  }

  handleDisconnect(client: Socket): void {
    const { workspaceId } = client.handshake.auth as EdgeRelayHandshake;
    if (!workspaceId) return;
    this.registry.unbind(workspaceId, client);
  }
}
