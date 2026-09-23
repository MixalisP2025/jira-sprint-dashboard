// Sprint calendar dates, recovered from the sprint NAME.
//
// Jira sprint names in this instance carry their own dates — "Sprint 23 27-04-26 to
// 08-05-26" — and that string is the only time signal that survives the Oracle round
// trip, because the stored issue rows hold no date fields at all (ISSUE_DB_FIELDS in
// dbSync.js). The Timeline tab, the gantt and the overlap view all need these dates.
//
// This parsing already existed in three places: the CSV parser, the Jira-refresh
// fallback, and teamEngine.parseSprintDates. None of them ran on the ordinary page
// load from Oracle, so the whole Timeline tab rendered "No Timeline Data Available"
// on every fresh visit until someone pressed Refresh from Jira. This module is the
// one copy the load path can also use.

// The shape the dashboard's sprintDates state uses: US-ordered date strings, because
// everything downstream does `new Date(dates.start)`.
const usDate = (dd, mm, yy) => `${mm}/${dd}/20${yy}`;

const RANGE = /(\d{2})-(\d{2})-(\d{2})\s+to\s+(\d{2})-(\d{2})-(\d{2})/;

// A sprint name's dates, or null when the name carries none. Day-first: these names are
// written DD-MM-YY, so "27-04-26 to 08-05-26" is 27 April to 8 May 2026.
export function datesFromSprintName(name) {
  const m = RANGE.exec(String(name || ''));
  if (!m) return null;
  const [, sd, sm, sy, ed, em, ey] = m;
  const start = usDate(sd, sm, sy);
  const end = usDate(ed, em, ey);
  // A name can match the shape and still be nonsense (month 13, day 40). Reject those
  // rather than handing an Invalid Date to the gantt, which would silently produce NaN
  // widths and an axis stretching to nowhere.
  if (isNaN(new Date(start)) || isNaN(new Date(end))) return null;
  return { start, end };
}

export function getSprintName(row) {
  return String(
    row?.['Sprint'] || row?.['G'] || row?.['Custom field (Sprint)'] ||
    row?.['Sprints'] || row?.['Sprint Name'] || ''
  ).trim();
}

// Every dated sprint present in the rows, keyed by the full sprint name (which is what
// the rest of the dashboard looks these up by).
//
// Multi-sprint tickets carry a comma-separated list, and each part is a sprint in its
// own right — splitting matters because a ticket in two sprints would otherwise yield
// one unparsable compound name and both sprints would lose their dates.
export function deriveSprintDates(rows) {
  const out = {};
  (rows || []).forEach(row => {
    const raw = getSprintName(row);
    if (!raw) return;
    (raw.includes(',') ? raw.split(',') : [raw]).forEach(part => {
      const name = part.trim();
      if (!name || out[name]) return;
      const dates = datesFromSprintName(name);
      if (dates) out[name] = dates;
    });
  });
  return out;
}

// Merge derived dates under whatever is already known. A Jira refresh supplies dates
// straight from the sprint API, which is more authoritative than a name parse, so
// existing entries win and this only fills the gaps.
export function mergeSprintDates(existing, derived) {
  const merged = { ...derived, ...(existing || {}) };
  const before = Object.keys(existing || {});
  if (before.length === Object.keys(merged).length) return existing || {};
  return merged;
}
