// manual_test_bank.md V1/V2 — đếm số dòng (VALUES (...)) trong 1 câu SQL
// INSERT, để chặn TRƯỚC KHI qua approval gate nếu model ghi thiếu so với
// yêu cầu. Chỉ đếm được câu dạng "INSERT INTO ... VALUES (...), (...)" —
// trả null khi không chắc (VD "INSERT INTO ... SELECT ..."), AN TOÀN hơn
// đếm nhầm.
export function countSqlInsertRows(query: string): number | null {
  const match = /INSERT\s+INTO\b[\s\S]*?\bVALUES\b/i.exec(query);
  if (!match) return null;

  const rest = query.slice(match.index + match[0].length);
  let depth = 0;
  let count = 0;
  let inString = false;

  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (inString) {
      if (ch === "'") {
        if (rest[i + 1] === "'") {
          i++;
          continue;
        }
        inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
    } else if (ch === '(') {
      if (depth === 0) count++;
      depth++;
    } else if (ch === ')') {
      depth = Math.max(0, depth - 1);
    } else if (ch === ';' && depth === 0) {
      break;
    }
  }

  return count > 0 ? count : null;
}
