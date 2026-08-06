import { Test, TestingModule } from '@nestjs/testing';
import { SupervisorPromptBuilder } from './supervisor-prompt.builder';
import { MemoryManagerService } from '../memory/memory-manager.service';
import {
  resolveDataCharBudget,
  resolveHistoryCharBudget,
  resolveMemoryCharBudget,
} from '../executor/tool-result-size-cap.util';

describe('SupervisorPromptBuilder', () => {
  let builder: SupervisorPromptBuilder;
  const mockMemoryManager = {
    buildBudget: jest.fn((modelId: string) => ({
      toolResultCharBudget: resolveDataCharBudget(modelId),
      memoryCharBudget: resolveMemoryCharBudget(modelId),
      historyCharBudget: resolveHistoryCharBudget(modelId),
    })),
  };
  const MODEL_ID = 'gpt-4o-mini';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupervisorPromptBuilder,
        { provide: MemoryManagerService, useValue: mockMemoryManager },
      ],
    }).compile();

    builder = module.get<SupervisorPromptBuilder>(SupervisorPromptBuilder);
  });

  afterEach(() => jest.clearAllMocks());

  it('only includes the original prompt when there is no memory, skill, history, or round yet', () => {
    const result = builder.build('câu hỏi', [], [], [], MODEL_ID, null);

    expect(result).toBe('Câu hỏi gốc của user: câu hỏi');
  });

  it('includes channel_memory framed as a reference, not an instruction', () => {
    const result = builder.build(
      'câu hỏi',
      [],
      [],
      [{ content: 'notion.create_page: Page "Roadmap" (id=abc123)' } as any],
      MODEL_ID,
      null,
    );

    expect(result).toContain('Thông tin đã xác nhận trước đó');
    expect(result).toContain('GỢI Ý tham khảo');
    expect(result).toContain('notion.create_page: Page "Roadmap" (id=abc123)');
  });

  it('includes the matched skill summary framed as optional guidance', () => {
    const result = builder.build('câu hỏi', [], [], [], MODEL_ID, {
      summaryMarkdown: '## Tạo sản phẩm\nGọi execute_write_query để INSERT.',
    } as any);

    expect(result).toContain('Gợi ý từ 1 lần làm việc tương tự');
    expect(result).toContain('Gọi execute_write_query để INSERT.');
  });

  it('redacts old AI answers in history so stale data cannot be reused as fact', () => {
    const result = builder.build(
      'câu hỏi',
      [],
      [
        { role: 'user', text: 'Bảng Orders có bao nhiêu dòng?' } as any,
        { role: 'model', text: 'Có 42 dòng' } as any,
      ],
      [],
      MODEL_ID,
      null,
    );

    expect(result).toContain('User: Bảng Orders có bao nhiêu dòng?');
    expect(result).not.toContain('42 dòng');
    expect(result).toContain('nội dung câu trả lời cũ đã ẩn');
  });

  it('includes rounds already run this turn, capped by the budget for the given model', () => {
    const rounds = [
      { agent: 'sql_server', task: 'đếm dòng', result: 'kết quả: 42' } as any,
    ];

    const result = builder.build('câu hỏi', rounds, [], [], MODEL_ID, null);

    expect(mockMemoryManager.buildBudget).toHaveBeenCalledWith(MODEL_ID);
    expect(result).toContain('Các bước đã thực hiện trong turn này');
    expect(result).toContain('sql_server');
    expect(result).toContain('kết quả: 42');
  });

  it('prepends a frustration warning before every other section when the prompt matches a frustration pattern', () => {
    const result = builder.build(
      'sao vẫn lỗi hoài vậy',
      [],
      [],
      [{ content: 'fact cũ' } as any],
      MODEL_ID,
      null,
    );

    expect(result).toContain('dấu hiệu không hài lòng/bực bội');
    expect(result.indexOf('không hài lòng/bực bội')).toBeLessThan(
      result.indexOf('Thông tin đã xác nhận trước đó'),
    );
  });

  it('orders sections as: memory, then matched skill, then history, then original prompt, then rounds', () => {
    const result = builder.build(
      'câu hỏi',
      [{ agent: 'sql_server', task: 't', result: 'r' } as any],
      [{ role: 'user', text: 'trước đó' } as any],
      [{ content: 'fact cũ' } as any],
      MODEL_ID,
      { summaryMarkdown: 'skill cũ' } as any,
    );

    const memoryIdx = result.indexOf('Thông tin đã xác nhận trước đó');
    const skillIdx = result.indexOf('Gợi ý từ 1 lần làm việc tương tự');
    const historyIdx = result.indexOf('Lịch sử hội thoại gần đây');
    const promptIdx = result.indexOf('Câu hỏi gốc của user');
    const roundsIdx = result.indexOf('Các bước đã thực hiện trong turn này');

    expect(memoryIdx).toBeLessThan(skillIdx);
    expect(skillIdx).toBeLessThan(historyIdx);
    expect(historyIdx).toBeLessThan(promptIdx);
    expect(promptIdx).toBeLessThan(roundsIdx);
  });
});
