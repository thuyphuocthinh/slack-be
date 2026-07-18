import { classifyToolError } from './tool-error-classifier.util';

describe('classifyToolError', () => {
  it.each([429, 502, 503, 504])(
    'classifies HTTP %i as retryable when found under "code"',
    (code) => {
      const text = JSON.stringify({ code, message: 'There was an error processing your request.' });
      expect(classifyToolError(text)).toBe('retryable');
    },
  );

  it.each([429, 502, 503, 504])(
    'classifies HTTP %i as retryable when found under "statusCode"',
    (code) => {
      const text = JSON.stringify({ statusCode: code, message: 'Too many requests' });
      expect(classifyToolError(text)).toBe('retryable');
    },
  );

  it('classifies a generic HTTP 500 as permanent — only the classic transient codes count', () => {
    const text = JSON.stringify({ code: 500, message: 'Internal error' });
    expect(classifyToolError(text)).toBe('permanent');
  });

  it.each([400, 401, 403, 404, 422])(
    'classifies client-error HTTP %i as permanent',
    (code) => {
      const text = JSON.stringify({ code, message: 'Bad request' });
      expect(classifyToolError(text)).toBe('permanent');
    },
  );

  it('classifies semantic error text with no HTTP code at all as permanent (static provider errors, VD "Error [AUTHENTICATION_ERROR]: ...")', () => {
    expect(
      classifyToolError('Error [AUTHENTICATION_ERROR]: Chưa kết nối sql_server.'),
    ).toBe('permanent');
    expect(
      classifyToolError('Error [TOOL_EXECUTION_ERROR:execute_write_query]: Multiple SQL statements are not permitted.'),
    ).toBe('permanent');
  });

  it('classifies empty/unrecognizable text as permanent (safe default)', () => {
    expect(classifyToolError('')).toBe('permanent');
    expect(classifyToolError('something went wrong, no idea what')).toBe('permanent');
  });
});
