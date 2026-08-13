import { Socket } from 'socket.io';
import { EdgeRelayGateway } from './edge-relay.gateway';
import { EdgeRelayRegistryService } from './edge-relay-registry.service';
import { isValidRelaySecret } from './edge-relay-secret.util';

jest.mock('./edge-relay-secret.util', () => ({
  isValidRelaySecret: jest.fn(),
}));

function createFakeClient(auth: { workspaceId?: string; token?: string }) {
  return {
    handshake: { auth },
    disconnect: jest.fn(),
  } as unknown as Socket & { disconnect: jest.Mock };
}

describe('EdgeRelayGateway', () => {
  let gateway: EdgeRelayGateway;
  let registry: { bind: jest.Mock; unbind: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    registry = { bind: jest.fn(), unbind: jest.fn() };
    gateway = new EdgeRelayGateway(
      registry as unknown as EdgeRelayRegistryService,
    );
  });

  describe('handleConnection', () => {
    it('binds the client to the registry when the secret is valid', () => {
      (isValidRelaySecret as jest.Mock).mockReturnValue(true);
      const client = createFakeClient({ workspaceId: 'ws-1', token: 'good' });

      gateway.handleConnection(client);

      expect(registry.bind).toHaveBeenCalledWith('ws-1', client);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects and never binds when the secret is invalid', () => {
      (isValidRelaySecret as jest.Mock).mockReturnValue(false);
      const client = createFakeClient({ workspaceId: 'ws-1', token: 'bad' });

      gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(registry.bind).not.toHaveBeenCalled();
    });

    it('disconnects when workspaceId or token is missing from the handshake', () => {
      (isValidRelaySecret as jest.Mock).mockReturnValue(false);
      const client = createFakeClient({});

      gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(registry.bind).not.toHaveBeenCalled();
    });
  });

  describe('handleDisconnect', () => {
    it('unbinds the client from the registry', () => {
      const client = createFakeClient({ workspaceId: 'ws-1' });

      gateway.handleDisconnect(client);

      expect(registry.unbind).toHaveBeenCalledWith('ws-1', client);
    });

    it('does nothing when the handshake never carried a workspaceId (rejected connection)', () => {
      const client = createFakeClient({});

      gateway.handleDisconnect(client);

      expect(registry.unbind).not.toHaveBeenCalled();
    });
  });
});
