import {
  extractWriteQueryPreviewTarget,
  parseSingleCountResult,
} from './write-query-preview.util';

describe('extractWriteQueryPreviewTarget', () => {
  it('parses UPDATE with a WHERE clause', () => {
    const result = extractWriteQueryPreviewTarget(
      "UPDATE Orders SET Status='Completed' WHERE OrderId=1",
    );

    expect(result).toEqual({
      kind: 'existing-rows',
      table: 'Orders',
      whereClause: 'OrderId=1',
    });
  });

  it('parses DELETE with a WHERE clause', () => {
    const result = extractWriteQueryPreviewTarget(
      'DELETE FROM Orders WHERE OrderId=1',
    );

    expect(result).toEqual({
      kind: 'existing-rows',
      table: 'Orders',
      whereClause: 'OrderId=1',
    });
  });

  it('flags UPDATE with no WHERE clause as whereClause=null (affects the whole table)', () => {
    const result = extractWriteQueryPreviewTarget(
      "UPDATE Orders SET Status='Completed'",
    );

    expect(result).toEqual({
      kind: 'existing-rows',
      table: 'Orders',
      whereClause: null,
    });
  });

  it('flags DELETE with no WHERE clause as whereClause=null', () => {
    const result = extractWriteQueryPreviewTarget('DELETE FROM Orders');

    expect(result).toEqual({
      kind: 'existing-rows',
      table: 'Orders',
      whereClause: null,
    });
  });

  // accuracy_problem.md mục 15 — table alias là cú pháp SQL bình thường mà
  // regex gốc bỏ sót (đòi "SET" đứng NGAY sau tên bảng).
  it('parses UPDATE with a table alias (VD "UPDATE Orders o SET ... WHERE o.Id=1")', () => {
    const result = extractWriteQueryPreviewTarget(
      "UPDATE Orders o SET o.Status='Completed' WHERE o.OrderId=1",
    );

    expect(result).toEqual({
      kind: 'existing-rows',
      table: 'Orders',
      whereClause: 'o.OrderId=1',
    });
  });

  it('parses UPDATE with an "AS" alias', () => {
    const result = extractWriteQueryPreviewTarget(
      "UPDATE Orders AS o SET o.Status='Completed' WHERE o.OrderId=1",
    );

    expect(result).toEqual({
      kind: 'existing-rows',
      table: 'Orders',
      whereClause: 'o.OrderId=1',
    });
  });

  it('parses UPDATE whose SET clause contains a subquery with its own WHERE, without confusing it for the outer WHERE', () => {
    const result = extractWriteQueryPreviewTarget(
      "UPDATE Orders SET total = (SELECT SUM(x) FROM Items WHERE order_id=Orders.id) WHERE status='pending'",
    );

    expect(result).toEqual({
      kind: 'existing-rows',
      table: 'Orders',
      whereClause: "status='pending'",
    });
  });

  // accuracy_problem.md mục 15 — trước đây INSERT luôn null. Giờ đếm TRỰC TIẾP
  // số tuple trong VALUES — không cần đếm thử qua DB.
  it('counts INSERT ... VALUES tuples directly', () => {
    const result = extractWriteQueryPreviewTarget(
      "INSERT INTO Orders (Status) VALUES ('Pending'), ('Shipped'), ('Done')",
    );

    expect(result).toEqual({
      kind: 'insert-rows',
      table: 'Orders',
      rowCount: 3,
    });
  });

  it('counts a single-tuple INSERT as 1 row', () => {
    const result = extractWriteQueryPreviewTarget(
      "INSERT INTO Orders (Status) VALUES ('Pending')",
    );

    expect(result).toEqual({
      kind: 'insert-rows',
      table: 'Orders',
      rowCount: 1,
    });
  });

  it('counts INSERT tuples correctly even with a nested function call (paren depth, not naive split)', () => {
    const result = extractWriteQueryPreviewTarget(
      "INSERT INTO Orders (Status, CreatedAt) VALUES ('Pending', NOW()), ('Done', NOW())",
    );

    expect(result).toEqual({
      kind: 'insert-rows',
      table: 'Orders',
      rowCount: 2,
    });
  });

  it('returns null for INSERT ... SELECT (no VALUES to count directly) — intentionally unsupported', () => {
    const result = extractWriteQueryPreviewTarget(
      'INSERT INTO Orders (Status) SELECT Status FROM OldOrders',
    );

    expect(result).toBeNull();
  });

  // accuracy_problem.md mục 15 — TRUNCATE/DROP huỷ CẢ bảng, "đếm dòng" không
  // còn ý nghĩa — cảnh báo THẲNG, không cần chạy COUNT.
  it('flags TRUNCATE TABLE as whole-table-destructive', () => {
    const result = extractWriteQueryPreviewTarget('TRUNCATE TABLE Orders');

    expect(result).toEqual({
      kind: 'whole-table-destructive',
      table: 'Orders',
      operation: 'TRUNCATE',
    });
  });

  it('flags DROP TABLE as whole-table-destructive', () => {
    const result = extractWriteQueryPreviewTarget('DROP TABLE Orders');

    expect(result).toEqual({
      kind: 'whole-table-destructive',
      table: 'Orders',
      operation: 'DROP',
    });
  });

  it('flags TRUNCATE TABLE ... CASCADE as whole-table-destructive (not a generic fallback)', () => {
    const result = extractWriteQueryPreviewTarget(
      'TRUNCATE TABLE Orders CASCADE',
    );

    expect(result).toEqual({
      kind: 'whole-table-destructive',
      table: 'Orders',
      operation: 'TRUNCATE',
    });
  });

  it('flags a multi-table TRUNCATE as whole-table-destructive, listing every table', () => {
    const result = extractWriteQueryPreviewTarget(
      'TRUNCATE TABLE Orders, Items CASCADE',
    );

    expect(result).toEqual({
      kind: 'whole-table-destructive',
      table: 'Orders, Items',
      operation: 'TRUNCATE',
    });
  });

  it('flags DROP TABLE IF EXISTS ... CASCADE as whole-table-destructive', () => {
    const result = extractWriteQueryPreviewTarget(
      'DROP TABLE IF EXISTS Orders CASCADE',
    );

    expect(result).toEqual({
      kind: 'whole-table-destructive',
      table: 'Orders',
      operation: 'DROP',
    });
  });

  // accuracy_problem.md mục 15 — nhiều statement gộp có thể lẫn ranh giới
  // WHERE giữa 2 câu lệnh — từ chối thẳng thay vì ước lượng sai mà tưởng đúng.
  it('returns null for multiple statements batched together (risk of cross-statement bleed)', () => {
    const result = extractWriteQueryPreviewTarget(
      "UPDATE Orders SET Status='x'; DELETE FROM Users WHERE Id=1;",
    );

    expect(result).toBeNull();
  });

  it('returns null for unrecognized/malformed SQL', () => {
    const result = extractWriteQueryPreviewTarget('EXEC sp_do_something');

    expect(result).toBeNull();
  });
});

describe('parseSingleCountResult', () => {
  it('extracts the numeric value from a 1-row JSON result', () => {
    const result = parseSingleCountResult(
      JSON.stringify([{ affectedRows: 12 }]),
    );

    expect(result).toBe(12);
  });

  it('returns null for an empty result set', () => {
    expect(parseSingleCountResult(JSON.stringify([]))).toBeNull();
  });

  it('returns null for non-numeric or malformed content', () => {
    expect(
      parseSingleCountResult('Query executed successfully. Rows affected: 1'),
    ).toBeNull();
    expect(
      parseSingleCountResult(JSON.stringify([{ affectedRows: 'many' }])),
    ).toBeNull();
  });
});
