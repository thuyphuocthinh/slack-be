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

/**
 * Returns the Monday of the week for a given date string (YYYY-MM-DD).
 */
export function getMondayOfWeek(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff)).toISOString().split('T')[0];
}

/**
 * Returns the Sunday of the week for a given Monday date string (YYYY-MM-DD).
 */
export function getSundayOfWeek(mondayStr: string): string {
  const sundayDate = new Date(mondayStr);
  sundayDate.setDate(sundayDate.getDate() + 6);
  return sundayDate.toISOString().split('T')[0];
}

/**
 * Returns the last day of the month for a given month string (YYYY-MM).
 */
export function getLastDayOfMonth(monthStr: string): string {
  const lastDayObj = new Date(parseInt(monthStr.substring(0, 4)), parseInt(monthStr.substring(5, 7)), 0);
  return lastDayObj.toISOString().split('T')[0];
}

/**
 * Calculates the difference in hours between two dates.
 */
export function calculateDiffHours(startTime: Date, endTime: Date): number {
  return (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
}
