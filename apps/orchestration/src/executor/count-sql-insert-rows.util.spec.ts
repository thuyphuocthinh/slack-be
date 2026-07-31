import { countSqlInsertRows } from './count-sql-insert-rows.util';

describe('countSqlInsertRows', () => {
  it('counts a single-row INSERT', () => {
    expect(countSqlInsertRows("INSERT INTO Products (Name) VALUES ('A')")).toBe(
      1,
    );
  });

  it('counts a multi-row INSERT with several VALUES tuples', () => {
    expect(
      countSqlInsertRows(
        "INSERT INTO Products (Name, Price) VALUES ('A', 1), ('B', 2), ('C', 3)",
      ),
    ).toBe(3);
  });

  it('does not miscount commas/parens inside string literals', () => {
    expect(
      countSqlInsertRows(
        "INSERT INTO Notes (Text) VALUES ('a, (b), c'), ('d')",
      ),
    ).toBe(2);
  });

  it('does not miscount a nested function call as an extra row', () => {
    expect(
      countSqlInsertRows(
        'INSERT INTO Logs (Id, CreatedAt) VALUES (NEWID(), GETDATE())',
      ),
    ).toBe(1);
  });

  it('returns null for INSERT ... SELECT (row count not knowable from the query text)', () => {
    expect(
      countSqlInsertRows(
        'INSERT INTO Archive (Id) SELECT Id FROM Products WHERE Active = 0',
      ),
    ).toBeNull();
  });

  it('returns null for a non-INSERT query', () => {
    expect(countSqlInsertRows('UPDATE Products SET Price = 1')).toBeNull();
  });
});
