import { JsonRepair } from 'agentic-io-parser';

// mục 15 — trước đây chỉ 1 shape {table, whereClause} (UPDATE/DELETE). Giờ
// discriminated union vì INSERT (đếm tuple, không cần WHERE) và
// TRUNCATE/DROP (huỷ CẢ bảng, không có khái niệm "đếm dòng ảnh hưởng") cần
// preview HẲN KHÁC — checkpoint-pause.service.ts switch theo `kind`.
export type WriteQueryPreviewTarget =
  | { kind: 'existing-rows'; table: string; whereClause: string | null }
  | { kind: 'insert-rows'; table: string; rowCount: number }
  | {
      kind: 'whole-table-destructive';
      table: string;
      operation: 'TRUNCATE' | 'DROP';
    };

function isWhereKeywordAt(text: string, index: number): boolean {
  if (text.slice(index, index + 5).toUpperCase() !== 'WHERE') return false;
  const isWordChar = (c: string | undefined) => !!c && /\w/.test(c);
  return !isWordChar(text[index - 1]) && !isWordChar(text[index + 5]);
}

// Chỉ nhận WHERE ở độ sâu ngoặc 0 — UPDATE Orders SET total = (SELECT ... WHERE ...)
// WHERE status = 'pending' có 2 chữ WHERE, cái đầu nằm TRONG subquery của SET. Bản cũ
// dùng match không global nên luôn ăn phải cái đầu tiên (sai bảng WHERE thật).
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

// Đếm số tuple TOP-LEVEL trong mệnh đề VALUES (...), (...), ... — tôn trọng
// ĐỘ SÂU ngoặc, KHÔNG phải split ngây thơ theo "),(" — 1 giá trị có thể chứa
// hàm lồng ngoặc bên trong (VD VALUES (1, NOW(), 'x')), split ngây thơ sẽ đếm
// sai số dòng.
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

// Heuristic regex, KHÔNG phải SQL parser đầy đủ — đủ dùng vì query đầu vào do
// chính model sinh ra qua tool `execute_write_query` (Bước 6, HITL preview),
// không phải input tự do của người dùng. Parse thất bại thì gọi nơi tự fallback
// về cảnh báo chung, không throw.
//
// mục 15 — CỐ Ý KHÔNG cố xử lý: UPDATE nhiều bảng kèm JOIN (cú pháp khác nhau
// nhiều giữa MSSQL/MySQL/Postgres, dễ đoán sai bảng đích), INSERT ... SELECT
// (không có VALUES để đếm trực tiếp, muốn ước lượng phải bọc SELECT con vào
// COUNT(*) — rủi ro sai với SELECT phức tạp). Cả 2 case này trả về null, rơi
// về fallback chung (buildGenericArgsPreview) — AN TOÀN (vẫn bắt buộc duyệt
// tay), chỉ là preview kém chi tiết hơn, không phải lỗ hổng bảo mật.
export function extractWriteQueryPreviewTarget(
  query: string,
): WriteQueryPreviewTarget | null {
  const trimmed = query.trim().replace(/;\s*$/, '');

  // Nhiều câu lệnh gộp (VD "UPDATE a SET x=1; DELETE FROM b;") — regex bên
  // dưới dùng [\s\S]+ tham lam, có thể LẪN RANH GIỚI giữa các statement (VD
  // WHERE của câu SAU bị hiểu nhầm là của câu ĐẦU, ước lượng ra 1 con số
  // TRÔNG CÓ VẺ ĐÚNG nhưng thực chất SAI). Từ chối thẳng — thà "không ước
  // lượng được" còn hơn ước lượng sai mà tưởng đúng.
  if (trimmed.includes(';')) return null;

  const truncateMatch = trimmed.match(/^TRUNCATE\s+TABLE\s+(\S+)$/i);
  if (truncateMatch) {
    return {
      kind: 'whole-table-destructive',
      table: truncateMatch[1],
      operation: 'TRUNCATE',
    };
  }

  const dropMatch = trimmed.match(/^DROP\s+TABLE\s+(\S+)$/i);
  if (dropMatch) {
    return {
      kind: 'whole-table-destructive',
      table: dropMatch[1],
      operation: 'DROP',
    };
  }

  // Cho phép table alias (VD "UPDATE Orders o SET ..."), cú pháp SQL rất bình
  // thường mà bản gốc bỏ sót (đòi "SET" phải đứng NGAY sau tên bảng) — lookahead
  // phủ định đảm bảo từ xen giữa không phải chính chữ "SET".
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

  // INSERT ... VALUES (...), (...), ... — đếm TRỰC TIẾP số tuple trong câu
  // lệnh, không cần đếm thử qua DB (không có "trạng thái cũ" để so sánh).
  const insertMatch = trimmed.match(
    /^INSERT\s+INTO\s+(\S+)\s*(?:\([^)]*\))?\s*VALUES\s*([\s\S]+)$/i,
  );
  if (insertMatch) {
    const rowCount = countTopLevelTuples(insertMatch[2]);
    if (rowCount !== null) {
      return { kind: 'insert-rows', table: insertMatch[1], rowCount };
    }
  }

  return null;
}

// `execute_read_only_query` trả JSON.stringify(rows) qua content text (xem
// executeMcpQuery trong mcp_server) — SELECT COUNT(*) luôn trả đúng 1 dòng 1 cột.
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
