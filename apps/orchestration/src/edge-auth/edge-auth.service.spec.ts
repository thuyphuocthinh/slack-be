import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import { EdgeAuthService } from './edge-auth.service';
import { isValidRelaySecret } from '../edge-relay/edge-relay-secret.util';

jest.mock('../edge-relay/edge-relay-secret.util', () => ({
  isValidRelaySecret: jest.fn(),
}));

describe('EdgeAuthService', () => {
  let service: EdgeAuthService;
  let jwtService: { sign: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    service = new EdgeAuthService(jwtService as any);
  });

  it('signs a JWT with sub=workspaceId when the secret is valid', () => {
    (isValidRelaySecret as jest.Mock).mockReturnValue(true);

    const result = service.login('ws-1', 'correct-secret');

    expect(isValidRelaySecret).toHaveBeenCalledWith('ws-1', 'correct-secret');
    expect(jwtService.sign).toHaveBeenCalledWith({ sub: 'ws-1' });
    expect(result).toEqual({ accessToken: 'signed.jwt.token' });
  });

  it('throws RpcException(EDGE_RELAY_UNAUTHORIZED) and never signs a JWT when the secret is invalid', () => {
    (isValidRelaySecret as jest.Mock).mockReturnValue(false);

    expect(() => service.login('ws-1', 'wrong-secret')).toThrow(RpcException);
    try {
      service.login('ws-1', 'wrong-secret');
    } catch (error) {
      expect((error as RpcException).getError()).toEqual(
        ORCHESTRATION_ERROR.EDGE_RELAY_UNAUTHORIZED,
      );
    }
    expect(jwtService.sign).not.toHaveBeenCalled();
  });
});
