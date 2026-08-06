jest.mock('../registry/agents.registry', () => ({
  AGENT_REGISTRY: {
    sql_server: { label: 'SQL Server', endpoint: 'http://x' },
    edge_relay_test: {
      label: 'Edge Relay Test',
      endpoint: undefined,
      perWorkspaceInstance: true,
    },
  },
}));

import { routeKey } from './route-key.util';

describe('routeKey (Edge MCP Server plan, Phase 1)', () => {
  it('returns the bare provider name for a shared-instance provider, regardless of workspaceId — KHÔNG đổi hành vi provider hiện có', () => {
    expect(routeKey('sql_server', 'workspace-A')).toBe('sql_server');
    expect(routeKey('sql_server', undefined)).toBe('sql_server');
  });

  it('returns "<provider>:<workspaceId>" for a perWorkspaceInstance provider when workspaceId is given', () => {
    expect(routeKey('edge_relay_test', 'workspace-A')).toBe(
      'edge_relay_test:workspace-A',
    );
  });

  it('falls back to the bare provider for a perWorkspaceInstance provider when workspaceId is missing (chưa route được thì không tự bịa key)', () => {
    expect(routeKey('edge_relay_test', undefined)).toBe('edge_relay_test');
  });

  it('returns the bare provider name for an unknown provider (không có entry trong registry)', () => {
    expect(routeKey('unknown_provider', 'workspace-A')).toBe(
      'unknown_provider',
    );
  });
});
