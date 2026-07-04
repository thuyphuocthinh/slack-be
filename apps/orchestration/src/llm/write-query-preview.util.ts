export interface WriteQueryPreviewTarget {
  table: string;
  // null nghĩa là câu lệnh KHÔNG có mệnh đề WHERE — sẽ ảnh hưởng TOÀN BỘ bảng.
  whereClause: string | null;
}

function splitAtWhere(text: string): string | null {
  const match = text.match(/\bWHERE\b/i);
  if (!match || match.index === undefined) return null;
  return text.slice(match.index + match[0].length).trim() || null;
}

// Heuristic regex, KHÔNG phải SQL parser đầy đủ — đủ dùng vì query đầu vào do
// chính model sinh ra qua tool `execute_write_query` (Bước 6, HITL preview),
// không phải input tự do của người dùng. Parse thất bại thì gọi nơi tự fallback
// về cảnh báo chung, không throw.
export function extractWriteQueryPreviewTarget(
  query: string,
): WriteQueryPreviewTarget | null {
  const trimmed = query.trim().replace(/;\s*$/, '');

  const updateMatch = trimmed.match(/^UPDATE\s+(\S+)\s+SET\s+([\s\S]+)$/i);
  if (updateMatch) {
    return { table: updateMatch[1], whereClause: splitAtWhere(updateMatch[2]) };
  }

  const deleteMatch = trimmed.match(/^DELETE\s+FROM\s+(\S+)([\s\S]*)$/i);
  if (deleteMatch) {
    return { table: deleteMatch[1], whereClause: splitAtWhere(deleteMatch[2]) };
  }

  return null;
}

// `execute_read_only_query` trả JSON.stringify(rows) qua content text (xem
// executeMcpQuery trong mcp_server) — SELECT COUNT(*) luôn trả đúng 1 dòng 1 cột.
export function parseSingleCountResult(mcpResultText: string): number | null {
  try {
    const rows = JSON.parse(mcpResultText);
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const value = Object.values(rows[0] as Record<string, unknown>)[0];
    return typeof value === 'number' ? value : null;
  } catch {
    return null;
  }
}
