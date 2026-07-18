import { classifyToolError } from './tool-error-classifier.util';

describe('classifyToolError', () => {
  it('classifies as retryable when the JSON envelope has retryable: true', () => {
    const text = JSON.stringify({
      error: true,
      retryable: true,
      code: 'TOOL_EXECUTION_ERROR:getInventory',
      message: 'Service temporarily unavailable',
    });
    expect(classifyToolError(text)).toBe('retryable');
  });

  it('classifies as permanent when the JSON envelope has retryable: false', () => {
    const text = JSON.stringify({
      error: true,
      retryable: false,
      code: 'AUTHENTICATION_ERROR',
      message: 'Chưa kết nối sql_server.',
    });
    expect(classifyToolError(text)).toBe('permanent');
  });

  it('classifies as permanent when retryable is missing entirely from an otherwise-valid JSON object', () => {
    const text = JSON.stringify({ code: 500, message: 'Internal error' });
    expect(classifyToolError(text)).toBe('permanent');
  });

  it('classifies as permanent when the text is not JSON at all (VD exception message từ McpClientService, hoặc lỗi tool cũ chưa theo format mới)', () => {
    expect(
      classifyToolError('Error [AUTHENTICATION_ERROR]: Chưa kết nối sql_server.'),
    ).toBe('permanent');
    expect(classifyToolError('ECONNREFUSED')).toBe('permanent');
  });

  it('classifies as permanent for empty text or non-object JSON (string/number/null)', () => {
    expect(classifyToolError('')).toBe('permanent');
    expect(classifyToolError('"just a string"')).toBe('permanent');
    expect(classifyToolError('42')).toBe('permanent');
    expect(classifyToolError('null')).toBe('permanent');
  });
});
