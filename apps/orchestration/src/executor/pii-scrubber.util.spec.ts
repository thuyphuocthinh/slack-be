import { PiiScrubberUtil } from './pii-scrubber.util';

describe('PiiScrubberUtil', () => {
  it('should mask credit card numbers', () => {
    const data = {
      message: 'My card is 1234-5678-9012-3456 please use it.',
      nested: { card: '1234567890123456' },
    };
    const scrubbed = PiiScrubberUtil.scrub(data);
    expect(scrubbed.message).toContain('****-****-****-3456');
    expect(scrubbed.nested.card).toBe('****-****-****-3456');
  });

  it('should mask emails', () => {
    const data = { email: 'john.doe@example.com' };
    const scrubbed = PiiScrubberUtil.scrub(data);
    expect(scrubbed.email).toBe('j***e@example.com');
  });

  it('should redact sensitive keys entirely', () => {
    const data = {
      username: 'johndoe',
      password: 'MySecretPassword123!',
      api_key: 'sk-1234567890',
      authorization: 'Bearer 1234',
    };
    const scrubbed = PiiScrubberUtil.scrub(data);
    expect(scrubbed.username).toBe('johndoe');
    expect(scrubbed.password).toBe('[REDACTED_BY_SECURITY_GATE]');
    expect(scrubbed.api_key).toBe('[REDACTED_BY_SECURITY_GATE]');
    expect(scrubbed.authorization).toBe('[REDACTED_BY_SECURITY_GATE]');
  });

  it('should mask phone numbers', () => {
    const data = { phone: '+1-800-555-1234' };
    const scrubbed = PiiScrubberUtil.scrub(data);
    expect(scrubbed.phone).toBe('[PHONE_REDACTED]');
  });

  it('should mask JWT tokens', () => {
    const data = { message: 'Here is my token eyJhbGciOiJIUzI1NiIsInR5cCI.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c' };
    const scrubbed = PiiScrubberUtil.scrub(data);
    expect(scrubbed.message).toBe('Here is my token [JWT_TOKEN_REDACTED]');
  });

  it('should mask Private Keys', () => {
    const data = {
      key: `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA3...
-----END RSA PRIVATE KEY-----`
    };
    const scrubbed = PiiScrubberUtil.scrub(data);
    expect(scrubbed.key).toBe('[PRIVATE_KEY_REDACTED]');
  });
});
