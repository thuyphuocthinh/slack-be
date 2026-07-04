import { extractWriteQueryPreviewTarget, parseSingleCountResult } from './write-query-preview.util';

describe('extractWriteQueryPreviewTarget', () => {
  it('parses UPDATE with a WHERE clause', () => {
    const result = extractWriteQueryPreviewTarget("UPDATE Orders SET Status='Completed' WHERE OrderId=1");

    expect(result).toEqual({ table: 'Orders', whereClause: 'OrderId=1' });
  });

  it('parses DELETE with a WHERE clause', () => {
    const result = extractWriteQueryPreviewTarget('DELETE FROM Orders WHERE OrderId=1');

    expect(result).toEqual({ table: 'Orders', whereClause: 'OrderId=1' });
  });

  it('flags UPDATE with no WHERE clause as whereClause=null (affects the whole table)', () => {
    const result = extractWriteQueryPreviewTarget("UPDATE Orders SET Status='Completed'");

    expect(result).toEqual({ table: 'Orders', whereClause: null });
  });

  it('flags DELETE with no WHERE clause as whereClause=null', () => {
    const result = extractWriteQueryPreviewTarget('DELETE FROM Orders');

    expect(result).toEqual({ table: 'Orders', whereClause: null });
  });

  it('returns null for INSERT (nothing to count beforehand)', () => {
    const result = extractWriteQueryPreviewTarget("INSERT INTO Orders (Status) VALUES ('Pending')");

    expect(result).toBeNull();
  });

  it('returns null for unrecognized/malformed SQL', () => {
    const result = extractWriteQueryPreviewTarget('EXEC sp_do_something');

    expect(result).toBeNull();
  });
});

describe('parseSingleCountResult', () => {
  it('extracts the numeric value from a 1-row JSON result', () => {
    const result = parseSingleCountResult(JSON.stringify([{ affectedRows: 12 }]));

    expect(result).toBe(12);
  });

  it('returns null for an empty result set', () => {
    expect(parseSingleCountResult(JSON.stringify([]))).toBeNull();
  });

  it('returns null for non-numeric or malformed content', () => {
    expect(parseSingleCountResult('Query executed successfully. Rows affected: 1')).toBeNull();
    expect(parseSingleCountResult(JSON.stringify([{ affectedRows: 'many' }]))).toBeNull();
  });
});
