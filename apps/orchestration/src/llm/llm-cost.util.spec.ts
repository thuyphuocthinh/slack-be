const mockGetCurrentRunTree = jest.fn();

jest.mock('langsmith/traceable', () => ({
  getCurrentRunTree: (...args: unknown[]) => mockGetCurrentRunTree(...args),
}));

import { attachLlmCostMetadata, estimateCostUsd } from './llm-cost.util';

describe('estimateCostUsd (Giai đoạn 4, Step 7)', () => {
  it('computes cost from input/output tokens using the registry price for a known model', () => {
    const cost = estimateCostUsd('gpt-4o-mini', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    // gpt-4o-mini: $0.15/1M in + $0.6/1M out
    expect(cost).toBeCloseTo(0.15 + 0.6, 5);
  });

  it('scales proportionally for token counts smaller than 1 million', () => {
    const cost = estimateCostUsd('gpt-4o-mini', {
      inputTokens: 500_000,
      outputTokens: 0,
    });

    expect(cost).toBeCloseTo(0.075, 5);
  });

  it('returns null for a model id not in the registry', () => {
    const cost = estimateCostUsd('unknown-model', {
      inputTokens: 100,
      outputTokens: 100,
    });

    expect(cost).toBeNull();
  });
});

describe('attachLlmCostMetadata (Giai đoạn 4, Step 7)', () => {
  afterEach(() => jest.clearAllMocks());

  it('sets usage_metadata (LangSmith-recognized snake_case shape) on the current run tree when tracing is active', () => {
    const runTree: {
      metadata?: {
        usage_metadata: {
          input_tokens: number;
          output_tokens: number;
          total_tokens: number;
          total_cost?: number;
        };
      };
    } = {};
    mockGetCurrentRunTree.mockReturnValue(runTree);

    attachLlmCostMetadata('gpt-4o-mini', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(mockGetCurrentRunTree).toHaveBeenCalledWith(true);
    expect(runTree.metadata?.usage_metadata.input_tokens).toBe(1_000_000);
    expect(runTree.metadata?.usage_metadata.output_tokens).toBe(1_000_000);
    expect(runTree.metadata?.usage_metadata.total_tokens).toBe(2_000_000);
    expect(runTree.metadata?.usage_metadata.total_cost).toBeCloseTo(0.75, 5);
  });

  it('does nothing (no throw) when tracing is disabled — getCurrentRunTree(true) returns undefined', () => {
    mockGetCurrentRunTree.mockReturnValue(undefined);

    expect(() =>
      attachLlmCostMetadata('gpt-4o-mini', {
        inputTokens: 100,
        outputTokens: 100,
      }),
    ).not.toThrow();
  });

  it('includes cached_tokens (ver3.md — prompt caching) when provided', () => {
    const runTree: {
      metadata?: { usage_metadata: { cached_tokens?: number } };
    } = {};
    mockGetCurrentRunTree.mockReturnValue(runTree);

    attachLlmCostMetadata('gpt-4o-mini', {
      inputTokens: 1000,
      outputTokens: 100,
      cachedTokens: 800,
    });

    expect(runTree.metadata?.usage_metadata.cached_tokens).toBe(800);
  });

  it('omits cached_tokens entirely when not provided (no cache hit info from the provider)', () => {
    const runTree: { metadata?: { usage_metadata: object } } = {};
    mockGetCurrentRunTree.mockReturnValue(runTree);

    attachLlmCostMetadata('gpt-4o-mini', {
      inputTokens: 1000,
      outputTokens: 100,
    });

    expect(runTree.metadata?.usage_metadata).not.toHaveProperty(
      'cached_tokens',
    );
  });

  it('omits total_cost (instead of sending null, which LangSmith would reject) for an unregistered model — token usage itself is not lost', () => {
    const runTree: { metadata?: unknown } = {};
    mockGetCurrentRunTree.mockReturnValue(runTree);

    attachLlmCostMetadata('unknown-model', {
      inputTokens: 10,
      outputTokens: 20,
    });

    expect(runTree.metadata).toEqual({
      usage_metadata: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
    });
  });
});
