import { hasPendingActionStep } from './pending-action-step.util';
import { DelegationDto } from '../dto/supervisor.dto';

describe('hasPendingActionStep', () => {
  const step = (task: string, mustExecute?: boolean): DelegationDto =>
    ({ agent: 'a', task, mustExecute: mustExecute ?? false }) as DelegationDto;

  // ─── mustExecute flag ──────────────────────────────────────────────────────

  it('returns true immediately when mustExecute=true, regardless of task text', () => {
    expect(hasPendingActionStep([step('khám phá schema', true)])).toBe(true);
  });

  it('returns false when mustExecute=false and task has no action/verify/compute keyword', () => {
    expect(hasPendingActionStep([step('lấy danh sách sản phẩm')])).toBe(false);
  });

  // ─── action keywords (tiếng Việt) ─────────────────────────────────────────

  it('detects tiếng Việt action keywords: ghi', () => {
    expect(hasPendingActionStep([step('ghi kết quả vào bảng')])).toBe(true);
  });

  it('detects tiếng Việt action keywords: chèn', () => {
    expect(hasPendingActionStep([step('chèn dữ liệu mới')])).toBe(true);
  });

  it('detects tiếng Việt action keywords: xoá', () => {
    expect(hasPendingActionStep([step('xoá bản ghi cũ')])).toBe(true);
  });

  // ─── English action keywords ───────────────────────────────────────────────

  it('detects English action keywords: insert', () => {
    expect(hasPendingActionStep([step('insert into orders')])).toBe(true);
  });

  it('detects English action keywords: update', () => {
    expect(hasPendingActionStep([step('update the record')])).toBe(true);
  });

  // ─── verification keywords ─────────────────────────────────────────────────

  it('detects verification keywords: kiểm tra', () => {
    expect(hasPendingActionStep([step('kiểm tra kết quả')])).toBe(true);
  });

  it('detects verification keywords: verify', () => {
    expect(hasPendingActionStep([step('verify the total matches')])).toBe(true);
  });

  // ─── compute keywords ──────────────────────────────────────────────────────

  it('detects compute keywords: tính', () => {
    expect(hasPendingActionStep([step('tính tổng doanh thu')])).toBe(true);
  });

  it('detects compute keywords: aggregate', () => {
    expect(hasPendingActionStep([step('aggregate by category')])).toBe(true);
  });

  // ─── Bug fix — null/undefined task (LLM drops field from JSON output) ──────

  it('Bug fix: does NOT crash when task is null — treats it as empty string (no keyword match)', () => {
    const badStep = {
      agent: 'sql_server',
      mustExecute: false,
      task: null,
    } as unknown as DelegationDto;
    // TRƯỚC fix: TypeError: Cannot read properties of null reading 'toLowerCase'
    // SAU fix: trả false bình thường (null task → '' → không keyword nào khớp)
    expect(() => hasPendingActionStep([badStep])).not.toThrow();
    expect(hasPendingActionStep([badStep])).toBe(false);
  });

  it('Bug fix: does NOT crash when task is undefined — treats it as empty string', () => {
    const badStep = {
      agent: 'sql_server',
      mustExecute: false,
    } as unknown as DelegationDto;
    expect(() => hasPendingActionStep([badStep])).not.toThrow();
    expect(hasPendingActionStep([badStep])).toBe(false);
  });

  it('Bug fix: mustExecute=true still short-circuits correctly even when task is null', () => {
    const badStep = {
      agent: 'sql_server',
      mustExecute: true,
      task: null,
    } as unknown as DelegationDto;
    expect(hasPendingActionStep([badStep])).toBe(true);
  });

  it('correctly handles a mixed array where one step has null task and another has a valid action keyword', () => {
    const nullStep = {
      agent: 'a',
      mustExecute: false,
      task: null,
    } as unknown as DelegationDto;
    const actionStep = step('chèn vào bảng products');
    expect(hasPendingActionStep([nullStep, actionStep])).toBe(true);
  });

  // ─── empty / all-read steps ────────────────────────────────────────────────

  it('returns false for an empty steps array', () => {
    expect(hasPendingActionStep([])).toBe(false);
  });

  it('returns false when all steps are read-only (no action/verify/compute keyword, mustExecute=false)', () => {
    expect(
      hasPendingActionStep([
        step('lấy danh sách khách hàng'),
        step('đọc file báo cáo'),
      ]),
    ).toBe(false);
  });

  it('returns true as soon as at least one step in a mixed array matches', () => {
    expect(
      hasPendingActionStep([
        step('lấy danh sách khách hàng'),
        step('ghi kết quả vào bảng'),
      ]),
    ).toBe(true);
  });
});
