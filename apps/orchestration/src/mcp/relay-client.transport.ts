import { Logger } from '@nestjs/common';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { EQueueName, EJobName, QueueService } from '@slack/queue';
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
    private readonly queueService: QueueService,
  ) {}

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    // Notification (không có `id`) — không có reply để chờ, đi qua queue thay vì gọi registry trực tiếp.
    if (!('id' in message) || message.id === undefined || message.id === null) {
      const method = 'method' in message ? message.method : 'unknown';
      this.logger.debug(
        `notify() "${method}" cho workspace ${this.workspaceId} (fire-and-forget qua queue, không chờ ack)`,
      );
      await this.queueService.addJob(
        EQueueName.EDGE_RELAY_QUEUE,
        EJobName.EDGE_NOTIFY_MESSAGE,
        {
          workspaceId: this.workspaceId,
          message,
        },
      );
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
