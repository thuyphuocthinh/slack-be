import { EdgeAuthController } from './edge-auth.controller';
import { EdgeAuthService } from './edge-auth.service';

describe('EdgeAuthController', () => {
  let controller: EdgeAuthController;
  let edgeAuthService: { login: jest.Mock };

  beforeEach(() => {
    edgeAuthService = { login: jest.fn() };
    controller = new EdgeAuthController(
      edgeAuthService as unknown as EdgeAuthService,
    );
  });

  it('loginViaTcp forwards workspaceId/clientSecret from the payload and returns the service result', () => {
    edgeAuthService.login.mockReturnValue({ accessToken: 'signed.jwt.token' });

    const result = controller.loginViaTcp({
      workspaceId: 'ws-1',
      clientSecret: 'correct-secret',
    });

    expect(edgeAuthService.login).toHaveBeenCalledWith(
      'ws-1',
      'correct-secret',
    );
    expect(result).toEqual({ accessToken: 'signed.jwt.token' });
  });

  it('propagates the error thrown by the service instead of swallowing it', () => {
    const error = new Error('unauthorized');
    edgeAuthService.login.mockImplementation(() => {
      throw error;
    });

    expect(() =>
      controller.loginViaTcp({ workspaceId: 'ws-1', clientSecret: 'bad' }),
    ).toThrow(error);
  });
});
