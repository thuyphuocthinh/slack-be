import { JsonRepair } from 'agentic-io-parser';

export type WriteQueryPreviewTarget =
  | { kind: 'existing-rows'; table: string; whereClause: string | null }
  | {
    kind: 'insert-rows';
    table: string;
    rowCount: number;
    // INSERT ... VALUES cho con số chính xác; INSERT ... SELECT TOP N chỉ
    // đảm bảo giới hạn trên vì nguồn SELECT có thể trả về ít hơn N dòng.
    countKind?: 'maximum';
  }
  | {
    kind: 'whole-table-destructive';
    table: string;
    operation: 'TRUNCATE' | 'DROP';
  };

function parseTableList(tableListText: string): string {
  return tableListText
    .replace(/\s+(?:CASCADE|RESTRICT)\s*$/i, '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .join(', ');
}

function isWhereKeywordAt(text: string, index: number): boolean {
  if (text.slice(index, index + 5).toUpperCase() !== 'WHERE') return false;
  const isWordChar = (c: string | undefined) => !!c && /\w/.test(c);
  return !isWordChar(text[index - 1]) && !isWordChar(text[index + 5]);
}

function splitAtWhere(text: string): string | null {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (depth === 0 && isWhereKeywordAt(text, i)) {
      return text.slice(i + 5).trim() || null;
    }
  }
  return null;
}

function countTopLevelTuples(valuesText: string): number | null {
  let depth = 0;
  let count = 0;
  let openedAtDepth0 = false;
  for (const ch of valuesText) {
    if (ch === '(') {
      if (depth === 0) openedAtDepth0 = true;
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth < 0) return null;
      if (depth === 0 && openedAtDepth0) {
        count++;
        openedAtDepth0 = false;
      }
    }
  }
  return depth === 0 && count > 0 ? count : null;
}

export function extractWriteQueryPreviewTarget(
  query: string,
): WriteQueryPreviewTarget | null {
  const trimmed = query.trim().replace(/;\s*$/, '');
  if (trimmed.includes(';')) return null;

  const truncateMatch = trimmed.match(/^TRUNCATE\s+TABLE\s+([\s\S]+)$/i);
  if (truncateMatch) {
    return {
      kind: 'whole-table-destructive',
      table: parseTableList(truncateMatch[1]),
      operation: 'TRUNCATE',
    };
  }

  const dropMatch = trimmed.match(
    /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\s\S]+)$/i,
  );
  if (dropMatch) {
    return {
      kind: 'whole-table-destructive',
      table: parseTableList(dropMatch[1]),
      operation: 'DROP',
    };
  }

  const updateMatch = trimmed.match(
    /^UPDATE\s+(\S+)(?:\s+(?:AS\s+)?(?!SET\b)\S+)?\s+SET\s+([\s\S]+)$/i,
  );
  if (updateMatch) {
    return {
      kind: 'existing-rows',
      table: updateMatch[1],
      whereClause: splitAtWhere(updateMatch[2]),
    };
  }

  const deleteMatch = trimmed.match(/^DELETE\s+FROM\s+(\S+)([\s\S]*)$/i);
  if (deleteMatch) {
    return {
      kind: 'existing-rows',
      table: deleteMatch[1],
      whereClause: splitAtWhere(deleteMatch[2]),
    };
  }

  const insertMatch = trimmed.match(
    /^INSERT\s+INTO\s+(\S+)\s*(?:\([^)]*\))?\s*VALUES\s*([\s\S]+)$/i,
  );
  if (insertMatch) {
    const rowCount = countTopLevelTuples(insertMatch[2]);
    if (rowCount !== null) {
      return { kind: 'insert-rows', table: insertMatch[1], rowCount };
    }
  }

  const insertSelectTopMatch = trimmed.match(
    /^INSERT\s+INTO\s+(\S+)\s*(?:\([^)]*\))?\s*SELECT\s+(?:ALL\s+|DISTINCT\s+)?TOP\s*(?:\(\s*(\d+)\s*\)|(\d+))\s+([\s\S]+)$/i,
  );
  if (insertSelectTopMatch) {
    const selectRemainder = insertSelectTopMatch[4].trimStart();
    if (
      !/^PERCENT\b/i.test(selectRemainder) &&
      !/^WITH\s+TIES\b/i.test(selectRemainder)
    ) {
      const rowCount = Number(
        insertSelectTopMatch[2] ?? insertSelectTopMatch[3],
      );
      if (Number.isSafeInteger(rowCount) && rowCount > 0) {
        return {
          kind: 'insert-rows',
          table: insertSelectTopMatch[1],
          rowCount,
          countKind: 'maximum',
        };
      }
    }
  }

  return null;
}

export function parseSingleCountResult(mcpResultText: string): number | null {
  try {
    const repair = new JsonRepair();
    const rows = JSON.parse(repair.repair(mcpResultText));
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const value = Object.values(rows[0] as Record<string, unknown>)[0];
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}
