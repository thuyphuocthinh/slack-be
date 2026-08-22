import { Logger } from '@nestjs/common';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { EdgeRelayRegistryService } from '../edge-relay/edge-relay-registry.service';

export class RelayClientTransport implements Transport {
  private readonly logger = new Logger(RelayClientTransport.name);

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  sessionId?: string;

  constructor(
    private readonly workspaceId: string,
    private readonly registry: EdgeRelayRegistryService,
  ) {}

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    // Notification (không có `id`, VD "notifications/initialized") — không có
    // reply thật để chờ/forward, khác với request (có `id`, chờ ack ở dispatch()).
    if (!('id' in message) || message.id === undefined || message.id === null) {
      const method = 'method' in message ? message.method : 'unknown';
      this.logger.debug(
        `notify() "${method}" cho workspace ${this.workspaceId} (fire-and-forget, không chờ ack)`,
      );
      this.registry.notify(this.workspaceId, message);
      return;
    }

    try {
      const reply = await this.registry.dispatch(this.workspaceId, message);
      this.onmessage?.(reply);
    } catch (error) {
      this.logger.warn(
        `send() thất bại cho workspace ${this.workspaceId}: ${(error as Error).message}`,
      );
      throw error;
    }
  }

  async close(): Promise<void> {}
}
