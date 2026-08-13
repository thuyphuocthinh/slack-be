import { InsertAccumulator } from './insert-accumulator';

describe('InsertAccumulator', () => {
  it('tableKeyFor() returns the same signature for the same table+columns, regardless of the tuple values', () => {
    const acc = new InsertAccumulator();
    const keyA = acc.tableKeyFor(
      "INSERT INTO Products (Name, Price) VALUES ('A', 1)",
    );
    const keyB = acc.tableKeyFor(
      "INSERT INTO Products (Name, Price) VALUES ('B', 2)",
    );

    expect(keyA).not.toBeNull();
    expect(keyA).toBe(keyB);
  });

  it('tableKeyFor() returns null for a query that is not a parseable INSERT', () => {
    const acc = new InsertAccumulator();

    expect(acc.tableKeyFor('SELECT * FROM Products')).toBeNull();
  });

  it('checkShortfall() returns a shortfallMessage while fewer tuples than requiredCount have accumulated', () => {
    const acc = new InsertAccumulator();

    const outcome = acc.checkShortfall(
      "INSERT INTO Products (Name) VALUES ('A')",
      5,
    );

    expect(outcome).toEqual({ shortfallMessage: expect.any(String) });
  });

  it('accumulates tuples across multiple calls for the SAME table, then returns mergedQuery once requiredCount is reached', () => {
    const acc = new InsertAccumulator();

    const first = acc.checkShortfall(
      "INSERT INTO Products (Name) VALUES ('A')",
      2,
    );
    expect(first).toEqual({ shortfallMessage: expect.any(String) });

    const second = acc.checkShortfall(
      "INSERT INTO Products (Name) VALUES ('B')",
      2,
    );
    expect(second).toEqual({
      mergedQuery: "INSERT INTO Products (Name) VALUES ('A'), ('B')",
    });
  });

  it('dedupes identical tuples sent again instead of counting them twice', () => {
    const acc = new InsertAccumulator();

    acc.checkShortfall("INSERT INTO Products (Name) VALUES ('A')", 2);
    const outcome = acc.checkShortfall(
      "INSERT INTO Products (Name) VALUES ('A')",
      2,
    );

    expect(outcome).toEqual({ shortfallMessage: expect.any(String) });
  });

  it('keeps 2 different tables completely independent', () => {
    const acc = new InsertAccumulator();

    acc.checkShortfall("INSERT INTO Products (Name) VALUES ('A')", 2);
    const outcome = acc.checkShortfall('INSERT INTO Orders (Id) VALUES (1)', 1);

    expect(outcome).toEqual({
      mergedQuery: 'INSERT INTO Orders (Id) VALUES (1)',
    });
  });

  it('checkShortfall() returns null for a query that does not parse as an INSERT', () => {
    const acc = new InsertAccumulator();

    expect(acc.checkShortfall('SELECT * FROM Products', 5)).toBeNull();
  });

  it('clear() removes the accumulated entry so a later call starts fresh for that table', () => {
    const acc = new InsertAccumulator();
    acc.checkShortfall("INSERT INTO Products (Name) VALUES ('A')", 5);

    acc.clear("INSERT INTO Products (Name) VALUES ('A')");

    const outcome = acc.checkShortfall(
      "INSERT INTO Products (Name) VALUES ('B')",
      2,
    );
    expect(outcome).toEqual({ shortfallMessage: expect.any(String) });
  });
});
