/**
 * Checks if a given string is a strictly formatted UTC ISO 8601 date string.
 * It must end with 'Z' and must be a valid parseable date.
 * 
 * @param dateStr The date string to validate
 * @returns boolean True if it's a valid strict UTC ISO string
 */
export function isUtcString(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  
  if (!dateStr.endsWith('Z')) return false;

  const parsed = Date.parse(dateStr);
  if (isNaN(parsed)) return false;

  return true;
}
