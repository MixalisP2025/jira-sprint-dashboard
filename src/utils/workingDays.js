// Greek public holidays + working-day arithmetic.
// Shared so the Team panel and its allocation resolver cannot drift apart.

export function getGreekHolidays(year) {
  const fixed = [`${year}-01-01`, `${year}-01-06`, `${year}-03-25`, `${year}-05-01`, `${year}-08-15`, `${year}-10-28`, `${year}-12-25`, `${year}-12-26`];
  const a = year % 4, b = year % 7, c = year % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, month - 1, day + 13));
  const addDays = (date, n) => { const x = new Date(date); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const movable = [addDays(easter, -48), addDays(easter, -2), easter.toISOString().slice(0, 10), addDays(easter, 1), addDays(easter, 50)];
  return new Set([...fixed, ...movable]);
}

/**
 * ELAPSED working days from start to end, NOT counting the start day itself.
 * Correct for durations — a ticket opened and closed the same day took 0 days.
 * Wrong for capacity: a sprint that runs Mon–Fri has five working days, not four.
 * Use workingDaysInclusive for anything that counts days a person was available.
 */
export function workingDaysBetween(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate), end = new Date(endDate);
  start.setUTCHours(0, 0, 0, 0); end.setUTCHours(0, 0, 0, 0);
  if (end <= start) return 0;
  const holidays = new Set();
  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) getGreekHolidays(y).forEach(h => holidays.add(h));
  let count = 0; const cur = new Date(start); cur.setUTCDate(cur.getUTCDate() + 1);
  while (cur <= end) {
    const dow = cur.getUTCDay(); const iso = cur.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

/**
 * CAPACITY working days across a window, counting both endpoints.
 * This is the one to use for sprint length and anyone's available days.
 */
export function workingDaysInclusive(startDate, endDate) {
  return workingDaysList(startDate, endDate).length;
}

// Every working day (as YYYY-MM-DD) inside a window — used for day-by-day WIP sampling.
export function workingDaysList(startDate, endDate) {
  const out = [];
  if (!startDate || !endDate) return out;
  const start = new Date(startDate), end = new Date(endDate);
  start.setUTCHours(0, 0, 0, 0); end.setUTCHours(0, 0, 0, 0);
  if (end < start) return out;
  const holidays = new Set();
  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) getGreekHolidays(y).forEach(h => holidays.add(h));
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getUTCDay(); const iso = cur.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) out.push(iso);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// The team works in Athens. Jira timestamps carry their own offset (…+0300), so `new Date`
// yields the right instant — but bucketing an instant into "which day did this happen on"
// must use the Athens civil date, not UTC. At 01:00 Athens the two disagree, and a worklog
// logged just after midnight would otherwise be attributed to the previous day.
export const REPORT_TZ = 'Europe/Athens';

const fmtCache = new Map();
const dayFmt = tz => {
  if (!fmtCache.has(tz)) fmtCache.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return fmtCache.get(tz);
};

/** Civil date (YYYY-MM-DD) of an instant, in the reporting timezone. */
export function zonedDayKey(date, tz = REPORT_TZ) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d)) return null;
  try { return dayFmt(tz).format(d); }
  catch { return d.toISOString().slice(0, 10); }   // environment without full ICU
}

/** Treat a YYYY-MM-DD civil date as a value we can do calendar arithmetic on. */
const keyToUTC = key => new Date(`${key}T00:00:00Z`);
export const dayKeyToDate = keyToUTC;

const isWorkingDayKey = (key, holidays) => {
  const dow = keyToUTC(key).getUTCDay();
  return dow !== 0 && dow !== 6 && !holidays.has(key);
};

/**
 * The working day immediately before `date`, as a civil date in the reporting zone.
 * Friday when today is Monday; Friday when Monday was a public holiday and today is Tuesday.
 */
export function previousWorkingDayKey(date, tz = REPORT_TZ) {
  const startKey = zonedDayKey(date, tz);
  if (!startKey) return null;
  const cur = keyToUTC(startKey);
  const holidays = new Set();
  const y = cur.getUTCFullYear();
  for (let yy = y - 1; yy <= y + 1; yy++) getGreekHolidays(yy).forEach(h => holidays.add(h));
  for (let i = 0; i < 30; i++) {
    cur.setUTCDate(cur.getUTCDate() - 1);
    const key = cur.toISOString().slice(0, 10);
    if (isWorkingDayKey(key, holidays)) return key;
  }
  return cur.toISOString().slice(0, 10);
}

/** Same, as a Date at UTC midnight of that civil day — for display only. */
export function previousWorkingDay(date, tz = REPORT_TZ) {
  return keyToUTC(previousWorkingDayKey(date, tz));
}

export function cycleWorkingDays(a, b) {
  if (!a || !b) return null;
  const wd = workingDaysBetween(a, b);
  return wd >= 0 ? wd : null;
}
