import { isLikelyCreateToolCall } from './create-tool-heuristic.util';

describe('isLikelyCreateToolCall', () => {
  it('matches tool names containing create/insert/append/add', () => {
    expect(isLikelyCreateToolCall({ tool: 'notion.create_page' })).toBe(true);
    expect(
      isLikelyCreateToolCall({ tool: 'google_sheets.append_sheet_values' }),
    ).toBe(true);
    expect(isLikelyCreateToolCall({ tool: 'github.insert_comment' })).toBe(
      true,
    );
    expect(isLikelyCreateToolCall({ tool: 'crm.add_contact' })).toBe(true);
  });

  it('matches sql_server write tools via an INSERT INTO argsPreview', () => {
    expect(
      isLikelyCreateToolCall({
        tool: 'sql_server.execute_write_query',
        argsPreview: "INSERT INTO products (name) VALUES ('foo')",
      }),
    ).toBe(true);
  });

  it('matches tool names where the verb is not in leading position (bug fix)', () => {
    expect(isLikelyCreateToolCall({ tool: 'bulk_create_report' })).toBe(true);
    expect(isLikelyCreateToolCall({ tool: 'batch_insert_rows' })).toBe(true);
  });

  it('matches an INSERT INTO buried inside a JSON argsPreview for multi-arg tool calls (bug fix)', () => {
    expect(
      isLikelyCreateToolCall({
        tool: 'sql_server.execute_write_query',
        argsPreview: JSON.stringify(
          {
            query: "INSERT INTO products (name) VALUES ('foo')",
            database: 'db1',
          },
          null,
          2,
        ),
      }),
    ).toBe(true);
  });

  it('does not match read-only or non-create write tools', () => {
    expect(isLikelyCreateToolCall({ tool: 'sql_server.execute_query' })).toBe(
      false,
    );
    expect(
      isLikelyCreateToolCall({
        tool: 'sql_server.execute_write_query',
        argsPreview: 'UPDATE products SET name = 1',
      }),
    ).toBe(false);
    expect(isLikelyCreateToolCall({ tool: 'notion.delete_page' })).toBe(false);
  });

  it('handles missing argsPreview safely', () => {
    expect(
      isLikelyCreateToolCall({ tool: 'sql_server.execute_write_query' }),
    ).toBe(false);
  });
});
