import { PiiScrubProcessor } from './pii-scrub.processor';

describe('PiiScrubProcessor', () => {
  it('delegates to PiiScrubberUtil.scrub, redacting sensitive keys', () => {
    const processor = new PiiScrubProcessor();

    const result = processor.process({
      username: 'johndoe',
      password: 'MySecretPassword123!',
    }) as Record<string, unknown>;

    expect(result.username).toBe('johndoe');
    expect(result.password).toBe('[REDACTED_BY_SECURITY_GATE]');
  });

  it('masks emails within string values', () => {
    const processor = new PiiScrubProcessor();

    const result = processor.process({ email: 'john.doe@example.com' }) as Record<string, unknown>;

    expect(result.email).toBe('j***e@example.com');
  });
});
