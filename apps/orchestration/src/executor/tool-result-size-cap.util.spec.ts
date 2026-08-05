import {
  capRoundResults,
  capRoundResultsWeighted,
  capToolResultSize,
  resolveDataCharBudget,
  resolveHistoryCharBudget,
  resolveMemoryCharBudget,
} from './tool-result-size-cap.util';

describe('capToolResultSize', () => {
  it('falls back to a flat truncate when maxChars is too small to fit head+tail+marker (bug fix — used to return ONLY the marker, dropping all real content)', () => {
    const text = 'a'.repeat(200);

    expect(capToolResultSize(text, 30)).toBe('a'.repeat(30));
  });

  it('never returns a negative-length result when maxChars is 0', () => {
    expect(capToolResultSize('a'.repeat(200), 0)).toBe('');
  });

  it('returns the text unchanged when it is at or under the limit', () => {
    const text = 'a'.repeat(100);
    expect(capToolResultSize(text)).toBe(text);
  });

  it('cuts the text down to the limit using ContextCapper when it exceeds 6000 chars', () => {
    const text = 'a'.repeat(6001);
    const result = capToolResultSize(text);

    // ContextCapper reserves 40 chars for its own truncation marker out of the
    // 6000 budget -> effective 5960 -> 3576 head, 2384 tail. This keeps the
    // capper's own output under MAX_TOOL_RESULT_CHARS so the outer safety net
    // does not fire a second time on top of it.
    expect(result.startsWith('a'.repeat(3576))).toBe(true);
    expect(result.endsWith('a'.repeat(2384))).toBe(true);
    // 6001 chars in, 3576 head + 2384 tail kept -> 41 chars actually dropped
    expect(result).toContain('[truncated 41 chars]');
    expect(result.length).toBeLessThanOrEqual(6000);
  });

  it('minifies json but skips key compression when the payload is already small', () => {
    const json = [
      { organization_id: 1, department_name: 'IT' },
      { organization_id: 2, department_name: 'HR' },
    ];
    const text = JSON.stringify(json, null, 2);
    const result = capToolResultSize(text);

    // Payload is well under the cap, so compression would only add noise
    // (alias keys + a dictionary the LLM has to cross-reference) for no gain.
    expect(result).not.toContain('MAPPING_KEYS');
    expect(result).toContain('organization_id');
    // Result should be fully minified (no extra spaces outside of keys/values)
    expect(result).not.toContain('  ');
  });

  it('compresses keys with an alias dictionary once the payload is actually over the cap', () => {
    const json = Array.from({ length: 100 }, (_, i) => ({
      organization_id: i,
      department_name: 'IT'.repeat(20),
    }));
    const result = capToolResultSize(JSON.stringify(json));

    expect(result).toContain('MAPPING_KEYS');
    expect(result).toContain('organization_id');
  });

  it('never exceeds the cap even when several individually-capped fields add up past it', () => {
    const json = {
      field1: 'x'.repeat(4000),
      field2: 'y'.repeat(4000),
      field3: 'z'.repeat(4000),
    };
    const result = capToolResultSize(JSON.stringify(json));

    expect(result.length).toBeLessThanOrEqual(6000);
    // Only the outer safety net's own marker should appear, no leftover
    // per-field ContextCapper markers nested inside it.
    expect((result.match(/\[truncated \d+ chars\]/g) ?? []).length).toBe(1);
  });
});

describe('resolveDataCharBudget', () => {
  it('scales the budget with the model context window', () => {
    expect(resolveDataCharBudget('gpt-4o-mini')).toBe(153_600);
  });

  it('falls back to the flat default for an unregistered model', () => {
    expect(resolveDataCharBudget('some-unknown-model')).toBe(6000);
  });
});

describe('resolveMemoryCharBudget', () => {
  it('returns a fraction of the model data budget', () => {
    expect(resolveMemoryCharBudget('gpt-4o-mini')).toBe(15_360);
  });

  it('never exceeds the tool-result data budget for the same model', () => {
    const modelId = 'gpt-4o-mini';
    expect(resolveMemoryCharBudget(modelId)).toBeLessThan(
      resolveDataCharBudget(modelId),
    );
  });

  it('falls back proportionally for an unregistered model', () => {
    expect(resolveMemoryCharBudget('some-unknown-model')).toBe(600);
  });
});

describe('resolveHistoryCharBudget', () => {
  it('returns a fraction of the model data budget', () => {
    expect(resolveHistoryCharBudget('gpt-4o-mini')).toBe(76_800);
  });

  it('never exceeds the tool-result data budget for the same model', () => {
    const modelId = 'gpt-4o-mini';
    expect(resolveHistoryCharBudget(modelId)).toBeLessThan(
      resolveDataCharBudget(modelId),
    );
  });

  it('falls back proportionally for an unregistered model', () => {
    expect(resolveHistoryCharBudget('some-unknown-model')).toBe(3000);
  });
});

describe('capRoundResults', () => {
  it('keeps some real content per round even when many rounds shrink the per-round budget below the marker overhead (bug fix)', () => {
    const rounds = Array.from({ length: 300 }, (_, i) => ({
      agent: 'sql_server',
      task: `round ${i}`,
      result: 'x'.repeat(200),
    }));

    const capped = capRoundResults(rounds, 6000); // 20 chars/round — below the 40-char marker overhead

    for (const round of capped) {
      expect(round.result).toBe('x'.repeat(20));
    }
  });
});

describe('capRoundResultsWeighted', () => {
  it('gives an irreplaceable round (write action) more budget than a read-only round', () => {
    const rounds = [
      {
        agent: 'sql_server',
        task: 'xem danh sách order',
        result: 'x'.repeat(1000),
      },
      {
        agent: 'sql_server',
        task: 'tạo order mới cho khách A',
        result: 'y'.repeat(1000),
      },
    ];

    const capped = capRoundResultsWeighted(rounds, 300);

    expect(capped[1].result.length).toBeGreaterThan(capped[0].result.length);
  });

  it('splits the budget evenly when every round has the same classification', () => {
    const rounds = [
      { agent: 'sql_server', task: 'tạo order A', result: 'x'.repeat(1000) },
      { agent: 'sql_server', task: 'tạo order B', result: 'y'.repeat(1000) },
    ];

    const capped = capRoundResultsWeighted(rounds, 300);

    expect(capped[0].result.length).toBe(capped[1].result.length);
  });

  it('returns an empty array unchanged', () => {
    expect(capRoundResultsWeighted([], 6000)).toEqual([]);
  });

  it('never exceeds the requested budget for any single round', () => {
    const rounds = [
      { agent: 'a', task: 'xem báo cáo', result: 'x'.repeat(50) },
      { agent: 'b', task: 'tạo báo cáo', result: 'y'.repeat(50) },
    ];

    const capped = capRoundResultsWeighted(rounds, 40);

    for (const round of capped) {
      expect(round.result.length).toBeLessThanOrEqual(40);
    }
  });
});
