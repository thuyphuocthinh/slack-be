import { Socket } from 'socket.io';
import {
  EdgeRelayRegistryService,
  EDGE_RELAY_ACK_TIMEOUT_MS,
  EDGE_RELAY_MESSAGE_EVENT,
} from './edge-relay-registry.service';
import { RelayOfflineError } from './relay-offline.error';
import { RelayTimeoutError } from './relay-timeout.error';

function createFakeSocket(emitWithAck: jest.Mock = jest.fn()) {
  const timeout = jest.fn().mockReturnValue({ emitWithAck });
  return { timeout, emitWithAck } as unknown as Socket & {
    timeout: jest.Mock;
    emitWithAck: jest.Mock;
  };
}

describe('EdgeRelayRegistryService', () => {
  let service: EdgeRelayRegistryService;

  beforeEach(() => {
    service = new EdgeRelayRegistryService();
  });

  describe('bind/unbind/isOnline', () => {
    it('reports online after bind, offline after unbind with the same socket', () => {
      const socket = createFakeSocket();

      service.bind('ws-1', socket);
      expect(service.isOnline('ws-1')).toBe(true);

      service.unbind('ws-1', socket);
      expect(service.isOnline('ws-1')).toBe(false);
    });

    it('does not unbind when the socket passed no longer matches the bound one (a newer connection already replaced it)', () => {
      const stale = createFakeSocket();
      const fresh = createFakeSocket();

      service.bind('ws-1', stale);
      service.bind('ws-1', fresh);
      service.unbind('ws-1', stale);

      expect(service.isOnline('ws-1')).toBe(true);
    });

    it('reports offline for a workspace that was never bound', () => {
      expect(service.isOnline('unknown-workspace')).toBe(false);
    });
  });

  describe('dispatch', () => {
    it('throws RelayOfflineError when no relay is bound for the workspace', async () => {
      await expect(
        service.dispatch('ws-1', { jsonrpc: '2.0', id: 1, method: 'x' }),
      ).rejects.toThrow(RelayOfflineError);
    });

    it('sends the message through emitWithAck with the configured timeout and resolves with the reply', async () => {
      const reply = { jsonrpc: '2.0', id: 1, result: { ok: true } };
      const emitWithAck = jest.fn().mockResolvedValue(reply);
      const socket = createFakeSocket(emitWithAck);
      service.bind('ws-1', socket);

      const request = { jsonrpc: '2.0', id: 1, method: 'tools/call' };
      const result = await service.dispatch('ws-1', request);

      expect(socket.timeout).toHaveBeenCalledWith(EDGE_RELAY_ACK_TIMEOUT_MS);
      expect(emitWithAck).toHaveBeenCalledWith(
        EDGE_RELAY_MESSAGE_EVENT,
        request,
      );
      expect(result).toEqual(reply);
    });

    it('wraps an ack timeout/rejection into RelayTimeoutError', async () => {
      const emitWithAck = jest
        .fn()
        .mockRejectedValue(new Error('operation has timed out'));
      const socket = createFakeSocket(emitWithAck);
      service.bind('ws-1', socket);

      await expect(
        service.dispatch('ws-1', { jsonrpc: '2.0', id: 1, method: 'x' }),
      ).rejects.toThrow(RelayTimeoutError);
    });

    it('routes to the correct relay when 2 different workspaces are bound', async () => {
      const emitWithAckA = jest
        .fn()
        .mockResolvedValue({ jsonrpc: '2.0', id: 1, result: { from: 'A' } });
      const emitWithAckB = jest
        .fn()
        .mockResolvedValue({ jsonrpc: '2.0', id: 1, result: { from: 'B' } });
      service.bind('ws-A', createFakeSocket(emitWithAckA));
      service.bind('ws-B', createFakeSocket(emitWithAckB));

      const resultA = await service.dispatch('ws-A', {
        jsonrpc: '2.0',
        id: 1,
        method: 'x',
      });
      const resultB = await service.dispatch('ws-B', {
        jsonrpc: '2.0',
        id: 1,
        method: 'x',
      });

      expect(resultA).toEqual({ jsonrpc: '2.0', id: 1, result: { from: 'A' } });
      expect(resultB).toEqual({ jsonrpc: '2.0', id: 1, result: { from: 'B' } });
      expect(emitWithAckA).toHaveBeenCalledTimes(1);
      expect(emitWithAckB).toHaveBeenCalledTimes(1);
    });
  });
});
