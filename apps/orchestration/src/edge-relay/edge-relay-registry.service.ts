import { Injectable, Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { RelayOfflineError } from './relay-offline.error';
import { RelayTimeoutError } from './relay-timeout.error';

export const EDGE_RELAY_ACK_TIMEOUT_MS = 12_000;
export const EDGE_RELAY_MESSAGE_EVENT = 'mcp:message';

@Injectable()
export class EdgeRelayRegistryService {
  private readonly logger = new Logger(EdgeRelayRegistryService.name);
  private readonly sockets = new Map<string, Socket>();

  bind(workspaceId: string, socket: Socket): void {
    const previous = this.sockets.get(workspaceId);
    if (previous && previous !== socket) {
      previous.disconnect(true);
    }
    this.sockets.set(workspaceId, socket);
    this.logger.log(`Edge relay bound for workspace ${workspaceId}`);
  }

  unbind(workspaceId: string, socket: Socket): void {
    if (this.sockets.get(workspaceId) !== socket) return;
    this.sockets.delete(workspaceId);
    this.logger.log(`Edge relay unbound for workspace ${workspaceId}`);
  }

  isOnline(workspaceId: string): boolean {
    return this.sockets.has(workspaceId);
  }

  async dispatch(
    workspaceId: string,
    message: JSONRPCMessage,
  ): Promise<JSONRPCMessage> {
    const socket = this.sockets.get(workspaceId);
    if (!socket) {
      throw new RelayOfflineError(workspaceId);
    }

    try {
      return await socket
        .timeout(EDGE_RELAY_ACK_TIMEOUT_MS)
        .emitWithAck(EDGE_RELAY_MESSAGE_EVENT, message);
    } catch (error) {
      throw new RelayTimeoutError(workspaceId, error as Error);
    }
  }

  // JSON-RPC notification (không có `id`, VD "notifications/initialized") —
  // theo spec KHÔNG BAO GIỜ có reply, nên không được chờ ack như dispatch()
  // (sẽ luôn timeout 12s vì phía relay không có gì để trả lời).
  notify(workspaceId: string, message: JSONRPCMessage): void {
    const socket = this.sockets.get(workspaceId);
    if (!socket) {
      throw new RelayOfflineError(workspaceId);
    }
    socket.emit(EDGE_RELAY_MESSAGE_EVENT, message);
  }
}
