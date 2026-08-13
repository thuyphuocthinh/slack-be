import { toOpenAiStrictSchema } from './openai-strict-schema.util';

describe('toOpenAiStrictSchema', () => {
  it('marks every property required and adds additionalProperties: false', () => {
    const result = toOpenAiStrictSchema({
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['continue', 'done'] },
        reason: { type: 'string' },
      },
      required: ['verdict'],
    });

    expect(result.required).toEqual(['verdict', 'reason']);
    expect(result.additionalProperties).toBe(false);
  });

  it('makes an originally-optional field nullable instead of dropping it', () => {
    const result: any = toOpenAiStrictSchema({
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: [],
    });

    expect(result.properties.answer.type).toEqual(['string', 'null']);
  });

  it('leaves an originally-required field type untouched', () => {
    const result: any = toOpenAiStrictSchema({
      type: 'object',
      properties: { action: { type: 'string', enum: ['respond', 'plan'] } },
      required: ['action'],
    });

    expect(result.properties.action.type).toBe('string');
  });

  it('recurses into array items and nested objects (VD SUPERVISOR_PLAN_SCHEMA.steps)', () => {
    const result: any = toOpenAiStrictSchema({
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              agent: { type: 'string' },
              mustExecute: { type: 'boolean' },
            },
            required: ['agent'],
          },
        },
      },
      required: [],
    });

    const items = result.properties.steps.items;
    expect(items.additionalProperties).toBe(false);
    expect(items.required).toEqual(['agent', 'mustExecute']);
    expect(items.properties.mustExecute.type).toEqual(['boolean', 'null']);
  });

  it('does not mutate the original schema object', () => {
    const original = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: [],
    };
    toOpenAiStrictSchema(original);

    expect(original.required).toEqual([]);
    expect((original.properties.a as any).type).toBe('string');
  });
});
