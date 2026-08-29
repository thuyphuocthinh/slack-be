import { Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { RateLimitService } from '@slack/cached';
import { EdgeRelayGateway } from './edge-relay.gateway';
import { EdgeRelayRegistryService } from './edge-relay-registry.service';

function createFakeClient(
  auth: { workspaceId?: string; token?: string },
  address = '1.2.3.4',
) {
  return {
    handshake: { auth, address },
    disconnect: jest.fn(),
  } as unknown as Socket & { disconnect: jest.Mock };
}

describe('EdgeRelayGateway', () => {
  let gateway: EdgeRelayGateway;
  let registry: { bind: jest.Mock; unbind: jest.Mock };
  let jwtService: { verify: jest.Mock };
  let rateLimitService: { isAllowed: jest.Mock };

  beforeEach(() => {
    registry = { bind: jest.fn(), unbind: jest.fn() };
    jwtService = { verify: jest.fn() };
    rateLimitService = { isAllowed: jest.fn().mockResolvedValue(true) };
    gateway = new EdgeRelayGateway(
      registry as unknown as EdgeRelayRegistryService,
      jwtService as unknown as JwtService,
      rateLimitService as unknown as RateLimitService,
    );
  });

  describe('handleConnection', () => {
    it('binds the client to the registry when the JWT is valid and its sub matches workspaceId', async () => {
      jwtService.verify.mockReturnValue({ sub: 'ws-1' });
      const client = createFakeClient({ workspaceId: 'ws-1', token: 'good' });

      await gateway.handleConnection(client);

      expect(jwtService.verify).toHaveBeenCalledWith('good');
      expect(registry.bind).toHaveBeenCalledWith('ws-1', client);
      expect(client.disconnect).not.toHaveBeenCalled();
    });

    it('disconnects and never binds when the JWT is invalid/expired', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });
      const client = createFakeClient({ workspaceId: 'ws-1', token: 'bad' });

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(registry.bind).not.toHaveBeenCalled();
    });

    it('disconnects when the JWT sub does not match the claimed workspaceId', async () => {
      jwtService.verify.mockReturnValue({ sub: 'ws-other' });
      const client = createFakeClient({ workspaceId: 'ws-1', token: 'good' });

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(registry.bind).not.toHaveBeenCalled();
    });

    it('disconnects when workspaceId or token is missing from the handshake', async () => {
      const client = createFakeClient({});

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(jwtService.verify).not.toHaveBeenCalled();
      expect(registry.bind).not.toHaveBeenCalled();
    });

    it('disconnects without ever checking the JWT once the IP rate limit is exceeded', async () => {
      rateLimitService.isAllowed.mockResolvedValue(false);
      const client = createFakeClient(
        { workspaceId: 'ws-1', token: 'good' },
        '9.9.9.9',
      );

      await gateway.handleConnection(client);

      expect(rateLimitService.isAllowed).toHaveBeenCalledWith(
        'edge-relay:connect:ip:9.9.9.9',
        10,
        60,
      );
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(jwtService.verify).not.toHaveBeenCalled();
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
