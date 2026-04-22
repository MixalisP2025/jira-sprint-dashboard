/**
 * @fileoverview Formatting utilities for the CSR Analytics feature.
 * All functions are pure and side-effect-free.
 * They return the em-dash character "—" for null / undefined inputs.
 */

/**
 * Formats a decimal value in [0, 1] as a percentage string with one decimal place.
 *
 * @param {number | null | undefined} decimal - A value between 0 and 1 (e.g. 0.423).
 * @returns {string} Formatted percentage string (e.g. "42.3%"), or "—" when the
 *   input is null or undefined.
 *
 * @example
 * formatPct(0.423)   // "42.3%"
 * formatPct(1)       // "100.0%"
 * formatPct(0)       // "0.0%"
 * formatPct(null)    // "—"
 */
export function formatPct(decimal) {
  if (decimal == null) return '—';
  return `${(decimal * 100).toFixed(1)}%`;
}

/**
 * Formats a number as a days string.
 *
 * @param {number | null | undefined} n - Number of days (integer or float).
 * @returns {string} Formatted string (e.g. "5 days", "1 days"), or "—" when the
 *   input is null or undefined.
 *
 * @example
 * formatDays(5)     // "5 days"
 * formatDays(1.7)   // "1.7 days"
 * formatDays(null)  // "—"
 */
export function formatDays(n) {
  if (n == null) return '—';
  return `${Math.round(n)} days`;
}

/**
 * Formats a numeric delta with an explicit sign prefix.
 * Positive values are prefixed with "+", negative values keep their "-".
 * Zero is rendered as "0" (no sign).
 *
 * @param {number | null | undefined} n - The delta value (integer or float).
 * @returns {string} Signed string (e.g. "+3", "-2", "0"), or "—" when the
 *   input is null or undefined.
 *
 * @example
 * formatDelta(3)    // "+3"
 * formatDelta(-2)   // "-2"
 * formatDelta(0)    // "0"
 * formatDelta(null) // "—"
 */
export function formatDelta(n) {
  if (n == null) return '—';
  const rounded = Math.round(n);
  if (rounded > 0) return `+${rounded}`;
  return `${rounded}`;
}

/**
 * Formats an ISO 8601 date string into a human-readable date using the
 * browser / Node locale (e.g. "Jan 15, 2025").
 *
 * @param {string | null | undefined} isoStr - An ISO 8601 date string
 *   (e.g. "2025-01-15T10:30:00.000Z").
 * @returns {string} Locale-formatted date string, or "—" when the input is
 *   null, undefined, or not a valid date.
 *
 * @example
 * formatDate("2025-01-15T00:00:00.000Z")  // "Jan 15, 2025"
 * formatDate(null)                         // "—"
 * formatDate("not-a-date")                 // "—"
 */
export function formatDate(isoStr) {
  if (isoStr == null || isoStr === '') return '—';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Escapes a value for safe inclusion in a CSV file.
 *
 * Rules (per RFC 4180):
 * - If the value contains a comma, double-quote, or newline, the entire value
 *   is wrapped in double-quotes.
 * - Any double-quote characters within the value are escaped by doubling them
 *   (i.e. `"` becomes `""`).
 * - null / undefined are converted to an empty string before escaping.
 *
 * @param {string | number | null | undefined} str - The value to escape.
 * @returns {string} A CSV-safe string, possibly wrapped in double-quotes.
 *
 * @example
 * csvEscape('hello')              // 'hello'
 * csvEscape('hello, world')       // '"hello, world"'
 * csvEscape('say "hi"')           // '"say ""hi"""'
 * csvEscape('line1\nline2')       // '"line1\nline2"'
 * csvEscape(null)                 // ''
 */
export function csvEscape(str) {
  const value = str == null ? '' : String(str);
  // Wrap in quotes if the value contains a comma, double-quote, or newline
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
