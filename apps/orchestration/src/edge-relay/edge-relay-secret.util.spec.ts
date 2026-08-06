import { isValidRelaySecret } from './edge-relay-secret.util';

describe('isValidRelaySecret', () => {
  const originalSecrets = process.env.EDGE_RELAY_SECRETS;

  afterEach(() => {
    process.env.EDGE_RELAY_SECRETS = originalSecrets;
  });

  it('accepts a token that matches the configured secret for that workspace', () => {
    process.env.EDGE_RELAY_SECRETS = JSON.stringify({
      'ws-1': 'correct-secret',
    });

    expect(isValidRelaySecret('ws-1', 'correct-secret')).toBe(true);
  });

  it('rejects a token that does not match', () => {
    process.env.EDGE_RELAY_SECRETS = JSON.stringify({
      'ws-1': 'correct-secret',
    });

    expect(isValidRelaySecret('ws-1', 'wrong-secret')).toBe(false);
  });

  it('rejects a workspaceId with no configured secret', () => {
    process.env.EDGE_RELAY_SECRETS = JSON.stringify({
      'ws-1': 'correct-secret',
    });

    expect(isValidRelaySecret('ws-unknown', 'correct-secret')).toBe(false);
  });

  it('rejects when workspaceId or token is missing', () => {
    process.env.EDGE_RELAY_SECRETS = JSON.stringify({
      'ws-1': 'correct-secret',
    });

    expect(isValidRelaySecret(undefined, 'correct-secret')).toBe(false);
    expect(isValidRelaySecret('ws-1', undefined)).toBe(false);
  });

  it('rejects everything when EDGE_RELAY_SECRETS is unset or malformed', () => {
    delete process.env.EDGE_RELAY_SECRETS;
    expect(isValidRelaySecret('ws-1', 'correct-secret')).toBe(false);

    process.env.EDGE_RELAY_SECRETS = 'not json';
    expect(isValidRelaySecret('ws-1', 'correct-secret')).toBe(false);
  });

  it('does not throw when tokens of different lengths are compared', () => {
    process.env.EDGE_RELAY_SECRETS = JSON.stringify({
      'ws-1': 'a-long-secret-value',
    });

    expect(() => isValidRelaySecret('ws-1', 'short')).not.toThrow();
    expect(isValidRelaySecret('ws-1', 'short')).toBe(false);
  });
});
