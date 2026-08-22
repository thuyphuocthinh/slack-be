import { RelayClientTransport } from './relay-client.transport';
import { EdgeRelayRegistryService } from '../edge-relay/edge-relay-registry.service';
import { RelayOfflineError } from '../edge-relay/relay-offline.error';

describe('RelayClientTransport', () => {
  let registry: { dispatch: jest.Mock; notify: jest.Mock };
  let transport: RelayClientTransport;

  beforeEach(() => {
    registry = { dispatch: jest.fn(), notify: jest.fn() };
    transport = new RelayClientTransport(
      'ws-1',
      registry as unknown as EdgeRelayRegistryService,
    );
  });

  it('dispatches the message to the registry scoped to its own workspaceId', async () => {
    const request = { jsonrpc: '2.0' as const, id: 1, method: 'tools/call' };
    registry.dispatch.mockResolvedValue({ jsonrpc: '2.0', id: 1, result: {} });

    await transport.send(request);

    expect(registry.dispatch).toHaveBeenCalledWith('ws-1', request);
  });

  it('feeds the reply from the registry into onmessage', async () => {
    const reply = { jsonrpc: '2.0' as const, id: 1, result: { ok: true } };
    registry.dispatch.mockResolvedValue(reply);
    const onmessage = jest.fn();
    transport.onmessage = onmessage;

    await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/call' });

    expect(onmessage).toHaveBeenCalledWith(reply);
  });

  it('propagates a registry error (e.g. RelayOfflineError) instead of swallowing it', async () => {
    registry.dispatch.mockRejectedValue(new RelayOfflineError('ws-1'));

    await expect(
      transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/call' }),
    ).rejects.toThrow(RelayOfflineError);
  });

  it('never routes to a different workspace, even across repeated sends', async () => {
    registry.dispatch.mockResolvedValue({ jsonrpc: '2.0', id: 1, result: {} });

    await transport.send({ jsonrpc: '2.0', id: 1, method: 'a' });
    await transport.send({ jsonrpc: '2.0', id: 2, method: 'b' });

    expect(registry.dispatch).toHaveBeenNthCalledWith(
      1,
      'ws-1',
      expect.objectContaining({ method: 'a' }),
    );
    expect(registry.dispatch).toHaveBeenNthCalledWith(
      2,
      'ws-1',
      expect.objectContaining({ method: 'b' }),
    );
  });

  it('routes a notification (no "id") through registry.notify(), NOT dispatch() — không có reply thật để chờ', async () => {
    const notification = {
      jsonrpc: '2.0' as const,
      method: 'notifications/initialized',
    };

    await transport.send(notification);

    expect(registry.notify).toHaveBeenCalledWith('ws-1', notification);
    expect(registry.dispatch).not.toHaveBeenCalled();
  });

  it('does not call onmessage for a notification — nothing to forward', async () => {
    const onmessage = jest.fn();
    transport.onmessage = onmessage;

    await transport.send({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });

    expect(onmessage).not.toHaveBeenCalled();
  });
});
