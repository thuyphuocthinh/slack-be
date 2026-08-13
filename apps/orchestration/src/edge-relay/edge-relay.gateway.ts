import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { EdgeRelayRegistryService } from './edge-relay-registry.service';
import { isValidRelaySecret } from './edge-relay-secret.util';

interface EdgeRelayHandshake {
  workspaceId?: string;
  token?: string;
}

@WebSocketGateway({ namespace: 'edge-relay' })
export class EdgeRelayGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(EdgeRelayGateway.name);

  constructor(private readonly registry: EdgeRelayRegistryService) {}

  handleConnection(client: Socket): void {
    const { workspaceId, token } = client.handshake.auth as EdgeRelayHandshake;

    if (!isValidRelaySecret(workspaceId, token)) {
      this.logger.warn(
        `Rejected edge relay connection for workspaceId=${workspaceId ?? 'unknown'}`,
      );
      client.disconnect(true);
      return;
    }

    this.registry.bind(workspaceId!, client);
  }

  handleDisconnect(client: Socket): void {
    const { workspaceId } = client.handshake.auth as EdgeRelayHandshake;
    if (!workspaceId) return;
    this.registry.unbind(workspaceId, client);
  }
}
