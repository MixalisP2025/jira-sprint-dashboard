/**
 * @fileoverview Date utility functions for the CSR Analytics feature.
 *
 * All calculations use UTC to avoid timezone issues. Week boundaries follow
 * ISO 8601: weeks start on Monday and end on Sunday; the Thursday of a week
 * determines which year the week belongs to.
 */

// ---------------------------------------------------------------------------
// isoWeekOf
// ---------------------------------------------------------------------------

/**
 * Returns the ISO 8601 week string (`YYYY-Www`) for a given date string.
 *
 * Uses the standard ISO 8601 week algorithm: the Thursday of a week
 * determines the year, and Sunday is treated as day 7 (not day 0).
 *
 * This is the same algorithm as `getISOWeek` in `CSRAnalyticsTab.jsx`.
 *
 * @param {string} dateStr - An ISO date string (e.g. `'2025-03-17'`).
 * @returns {string} The ISO week string, e.g. `'2025-W12'`, or `''` for
 *   invalid / missing input.
 *
 * @example
 * isoWeekOf('2025-01-06') // '2025-W02'
 * isoWeekOf('2024-12-29') // '2025-W01'  (Sunday belongs to next year's W01)
 */
export function isoWeekOf(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';

  // Work in UTC to avoid DST shifts
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

  // ISO week: Thursday of the week determines the year.
  // Shift to the nearest Thursday: current date + 4 - current day number
  // where Monday = 1 … Sunday = 7 (convert JS Sunday 0 → 7).
  const dayNum = date.getUTCDay() || 7; // Sunday (0) becomes 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  const year = date.getUTCFullYear();

  return `${year}-W${String(weekNo).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the UTC Date for Monday 00:00:00 of the ISO week that contains
 * the given date.
 *
 * @param {Date} date - Any UTC Date.
 * @returns {Date} Monday 00:00:00 UTC of that ISO week.
 */
function mondayOf(date) {
  const dayNum = date.getUTCDay() || 7; // Sunday → 7
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - (dayNum - 1));
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

/**
 * Returns the UTC Date for Sunday 23:59:59.999 of the ISO week that contains
 * the given date.
 *
 * @param {Date} date - Any UTC Date.
 * @returns {Date} Sunday 23:59:59.999 UTC of that ISO week.
 */
function sundayOf(date) {
  const dayNum = date.getUTCDay() || 7; // Sunday → 7
  const sunday = new Date(date);
  sunday.setUTCDate(date.getUTCDate() + (7 - dayNum));
  sunday.setUTCHours(23, 59, 59, 999);
  return sunday;
}

// ---------------------------------------------------------------------------
// currentWeekBounds
// ---------------------------------------------------------------------------

/**
 * Returns the start and end UTC timestamps for the current ISO week.
 *
 * - `start`: Monday 00:00:00.000 UTC of the current ISO week.
 * - `end`:   Sunday 23:59:59.999 UTC of the current ISO week.
 *
 * @returns {{ start: Date, end: Date }}
 *
 * @example
 * const { start, end } = currentWeekBounds();
 * // start → Mon 2025-W12 00:00:00 UTC
 * // end   → Sun 2025-W12 23:59:59.999 UTC
 */
export function currentWeekBounds() {
  const now = new Date();
  return {
    start: mondayOf(now),
    end: sundayOf(now),
  };
}

// ---------------------------------------------------------------------------
// previousWeekBounds
// ---------------------------------------------------------------------------

/**
 * Returns the start and end UTC timestamps for the previous ISO week
 * (one week before the current ISO week).
 *
 * - `start`: Monday 00:00:00.000 UTC of the previous ISO week.
 * - `end`:   Sunday 23:59:59.999 UTC of the previous ISO week.
 *
 * @returns {{ start: Date, end: Date }}
 */
export function previousWeekBounds() {
  const now = new Date();
  // Shift back 7 days to land in the previous ISO week
  const lastWeek = new Date(now.getTime() - 7 * 86400000);
  return {
    start: mondayOf(lastWeek),
    end: sundayOf(lastWeek),
  };
}

// ---------------------------------------------------------------------------
// fourWeekWindowBounds
// ---------------------------------------------------------------------------

/**
 * Returns the start and end UTC timestamps for the 4-Week Window.
 *
 * The 4-Week Window is the 28-day period ending at 23:59:59.999 on the
 * Sunday of the current ISO week.
 *
 * - `end`:   Sunday 23:59:59.999 UTC of the current ISO week.
 * - `start`: 28 days before `end` (i.e. Monday 00:00:00.000 UTC, four weeks
 *   back from the start of the current week).
 *
 * @returns {{ start: Date, end: Date }}
 */
export function fourWeekWindowBounds() {
  const { start: currentMonday, end: currentSunday } = currentWeekBounds();
  // Start is exactly 28 days before the Monday of the current week
  const start = new Date(currentMonday.getTime() - 21 * 86400000);
  return {
    start,
    end: currentSunday,
  };
}

// ---------------------------------------------------------------------------
// previousFourWeekWindowBounds
// ---------------------------------------------------------------------------

/**
 * Returns the start and end UTC timestamps for the Previous 4-Week Window.
 *
 * This is the 28-day period immediately preceding the 4-Week Window —
 * i.e. the same shape shifted back 28 days.
 *
 * @returns {{ start: Date, end: Date }}
 */
export function previousFourWeekWindowBounds() {
  const { start, end } = fourWeekWindowBounds();
  return {
    start: new Date(start.getTime() - 28 * 86400000),
    end: new Date(end.getTime() - 28 * 86400000),
  };
}

// ---------------------------------------------------------------------------
// isInWindow
// ---------------------------------------------------------------------------

/**
 * Returns `true` when the date represented by `isoDateStr` falls within the
 * inclusive range `[bounds.start, bounds.end]`.
 *
 * Returns `false` for null, undefined, or unparseable date strings.
 *
 * @param {string | null | undefined} isoDateStr - An ISO date/datetime string.
 * @param {{ start: Date, end: Date }} bounds - The window to test against.
 * @returns {boolean}
 *
 * @example
 * const bounds = currentWeekBounds();
 * isInWindow('2025-03-17T10:00:00Z', bounds); // true (if in current week)
 * isInWindow(null, bounds);                    // false
 */
export function isInWindow(isoDateStr, bounds) {
  if (!isoDateStr) return false;
  const d = new Date(isoDateStr);
  if (isNaN(d.getTime())) return false;
  return d >= bounds.start && d <= bounds.end;
}
