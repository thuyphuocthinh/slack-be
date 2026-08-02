import { parseInsertValues } from './parse-insert-values.util';

describe('parseInsertValues', () => {
  it('parses a single-row INSERT', () => {
    const result = parseInsertValues(
      "INSERT INTO Products (Name) VALUES ('A')",
    );

    expect(result?.tuples).toEqual(["('A')"]);
    expect(result?.insertPrefix).toBe('INSERT INTO Products (Name) VALUES');
  });

  it('parses a multi-row INSERT with several VALUES tuples', () => {
    const result = parseInsertValues(
      "INSERT INTO Products (Name, Price) VALUES ('A', 1), ('B', 2), ('C', 3)",
    );

    expect(result?.tuples).toEqual(["('A', 1)", "('B', 2)", "('C', 3)"]);
  });

  it('does not miscount commas/parens inside string literals', () => {
    const result = parseInsertValues(
      "INSERT INTO Notes (Text) VALUES ('a, (b), c'), ('d')",
    );

    expect(result?.tuples).toEqual(["('a, (b), c')", "('d')"]);
  });

  it('does not miscount a nested function call as an extra tuple', () => {
    const result = parseInsertValues(
      'INSERT INTO Logs (Id, CreatedAt) VALUES (NEWID(), GETDATE())',
    );

    expect(result?.tuples).toEqual(['(NEWID(), GETDATE())']);
  });

  it('returns null for INSERT ... SELECT (no VALUES tuples to extract)', () => {
    expect(
      parseInsertValues(
        'INSERT INTO Archive (Id) SELECT Id FROM Products WHERE Active = 0',
      ),
    ).toBeNull();
  });

  it('returns null for a non-INSERT query', () => {
    expect(parseInsertValues('UPDATE Products SET Price = 1')).toBeNull();
  });

  it('gives the same tableSignature for the same table + column list, regardless of value content', () => {
    const first = parseInsertValues(
      "INSERT INTO Products (Name, Price) VALUES ('A', 1)",
    );
    const second = parseInsertValues(
      "INSERT INTO Products (Name, Price) VALUES ('B', 2)",
    );

    expect(first?.tableSignature).toBe(second?.tableSignature);
  });

  it('gives a different tableSignature for a different table or column list', () => {
    const base = parseInsertValues(
      "INSERT INTO Products (Name, Price) VALUES ('A', 1)",
    );
    const otherTable = parseInsertValues(
      "INSERT INTO Categories (Name, Price) VALUES ('A', 1)",
    );
    const otherColumns = parseInsertValues(
      "INSERT INTO Products (Name) VALUES ('A')",
    );

    expect(otherTable?.tableSignature).not.toBe(base?.tableSignature);
    expect(otherColumns?.tableSignature).not.toBe(base?.tableSignature);
  });
});
