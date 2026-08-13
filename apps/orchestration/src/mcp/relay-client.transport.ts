import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { EdgeRelayRegistryService } from '../edge-relay/edge-relay-registry.service';

export class RelayClientTransport implements Transport {
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
    const reply = await this.registry.dispatch(this.workspaceId, message);
    this.onmessage?.(reply);
  }

  async close(): Promise<void> {}
}
