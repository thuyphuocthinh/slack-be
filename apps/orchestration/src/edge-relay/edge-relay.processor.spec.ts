import { Job } from 'bullmq';
import { EJobName } from '@slack/queue';
import { EdgeRelayProcessor } from './edge-relay.processor';
import { EdgeRelayRegistryService } from './edge-relay-registry.service';

describe('EdgeRelayProcessor', () => {
  let processor: EdgeRelayProcessor;
  let registry: { dispatch: jest.Mock; notify: jest.Mock };

  beforeEach(() => {
    registry = { dispatch: jest.fn(), notify: jest.fn() };
    processor = new EdgeRelayProcessor(
      registry as unknown as EdgeRelayRegistryService,
    );
  });

  function createJob(name: string, data: unknown) {
    return { name, data } as unknown as Job;
  }

  describe('EDGE_DISPATCH_MESSAGE', () => {
    it('dispatches the message through the registry and returns its reply', async () => {
      const reply = { jsonrpc: '2.0', id: 1, result: { ok: true } };
      registry.dispatch.mockResolvedValue(reply);
      const message = { jsonrpc: '2.0', id: 1, method: 'tools/call' };

      const result = await processor.process(
        createJob(EJobName.EDGE_DISPATCH_MESSAGE, {
          workspaceId: 'ws-1',
          message,
        }),
      );

      expect(registry.dispatch).toHaveBeenCalledWith('ws-1', message);
      expect(result).toEqual(reply);
    });

    it('rethrows when the registry dispatch fails (e.g. RelayOfflineError)', async () => {
      registry.dispatch.mockRejectedValue(new Error('offline'));
      const message = { jsonrpc: '2.0', id: 1, method: 'tools/call' };

      await expect(
        processor.process(
          createJob(EJobName.EDGE_DISPATCH_MESSAGE, {
            workspaceId: 'ws-1',
            message,
          }),
        ),
      ).rejects.toThrow('offline');
    });
  });

  describe('EDGE_NOTIFY_MESSAGE', () => {
    it('forwards the notification through registry.notify(), fire-and-forget', async () => {
      const message = { jsonrpc: '2.0', method: 'notifications/initialized' };

      const result = await processor.process(
        createJob(EJobName.EDGE_NOTIFY_MESSAGE, {
          workspaceId: 'ws-1',
          message,
        }),
      );

      expect(registry.notify).toHaveBeenCalledWith('ws-1', message);
      expect(result).toBeUndefined();
    });

    it('rethrows when the registry notify fails (e.g. RelayOfflineError)', async () => {
      registry.notify.mockImplementation(() => {
        throw new Error('offline');
      });
      const message = { jsonrpc: '2.0', method: 'notifications/initialized' };

      await expect(
        processor.process(
          createJob(EJobName.EDGE_NOTIFY_MESSAGE, {
            workspaceId: 'ws-1',
            message,
          }),
        ),
      ).rejects.toThrow('offline');
    });
  });
});
