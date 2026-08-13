import { RpcException } from '@nestjs/microservices';
import { ORCHESTRATION_ERROR } from '@slack/constants';
import { describeExternalServiceError } from './external-service-error.util';
import { RelayOfflineError } from '../edge-relay/relay-offline.error';
import { RelayTimeoutError } from '../edge-relay/relay-timeout.error';

describe('describeExternalServiceError', () => {
  it('surfaces the code+message of an internal RpcException nguyên văn', () => {
    const error = new RpcException(ORCHESTRATION_ERROR.AGENT_NOT_REGISTERED);
    const result = describeExternalServiceError(error);
    expect(result).toContain(ORCHESTRATION_ERROR.AGENT_NOT_REGISTERED.code);
    expect(result).toContain(ORCHESTRATION_ERROR.AGENT_NOT_REGISTERED.message);
  });

  it('surfaces the raw message of a normal Error (VD lỗi SDK provider/MCP client)', () => {
    const error = new Error(
      '429 You exceeded your current quota, please check your plan and billing details.',
    );
    expect(describeExternalServiceError(error)).toBe(
      '⚠️ Lỗi: 429 You exceeded your current quota, please check your plan and billing details.',
    );
  });

  it('surfaces a connection-level error message nguyên văn (VD mcp_server unreachable)', () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:3008');
    expect(describeExternalServiceError(error)).toBe(
      '⚠️ Lỗi: connect ECONNREFUSED 127.0.0.1:3008',
    );
  });

  it('falls back to String(error) when error is not an Error instance', () => {
    expect(describeExternalServiceError('some raw string error')).toBe(
      '⚠️ Lỗi: some raw string error',
    );
  });

  it('surfaces a clean Vietnamese message for RelayOfflineError instead of the internal English error text', () => {
    const error = new RelayOfflineError('workspace-1');
    const result = describeExternalServiceError(error);
    expect(result).toContain('on-prem');
    expect(result).toContain('offline');
    expect(result).not.toContain('Edge relay offline for workspace');
  });

  it('surfaces a clean Vietnamese message for RelayTimeoutError instead of the internal English error text', () => {
    const error = new RelayTimeoutError('workspace-1');
    const result = describeExternalServiceError(error);
    expect(result).toContain('on-prem');
    expect(result).not.toContain('Edge relay timed out for workspace');
  });

  it('scrubs a token echoed back inside a raw provider error message instead of leaking it verbatim', () => {
    const rawToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const error = new Error(`Unauthorized, request had header: ${rawToken}`);

    const result = describeExternalServiceError(error);

    expect(result).not.toContain(rawToken);
    expect(result).toContain('[JWT_TOKEN_REDACTED]');
  });

  it('scrubs a token echoed back inside an RpcException message too', () => {
    const rawToken =
      'eyJhbGciOiJIUzI1NiIsInR5cCI.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const error = new RpcException({
      code: 'UPSTREAM_ERROR',
      message: `token rejected: ${rawToken}`,
    });

    const result = describeExternalServiceError(error);

    expect(result).not.toContain(rawToken);
    expect(result).toContain('[JWT_TOKEN_REDACTED]');
  });
});
