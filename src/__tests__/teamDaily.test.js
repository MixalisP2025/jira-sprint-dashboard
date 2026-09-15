import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { computeDailyNote, findCurrentSprint, STALL_DAYS_DEFAULT, AGING_DAYS, loadBaseline, saveSnapshot, buildDailyNoteText } from '../utils/teamDaily';
import { deriveChangelog, parseSprintDates } from '../utils/teamEngine';
import { previousWorkingDay, previousWorkingDayKey, zonedDayKey, workingDaysInclusive, REPORT_TZ } from '../utils/workingDays';

// Wed 15 Jul 2026 — mid-sprint, so "the last working day" is Tue 14 Jul.
const TODAY = new Date(Date.UTC(2026, 6, 15, 9, 0));
const YESTERDAY = previousWorkingDay(TODAY);
const DAY = 86400000;
const at = (d, h = 12) => new Date(d.getTime() + h * 3600000).toISOString();

const SPRINT = { name: 'Sprint 29 06-07-26 to 17-07-26', state: 'active', start: new Date(Date.UTC(2026, 6, 6)), end: new Date(Date.UTC(2026, 6, 17)) };
const PREV = { name: 'Sprint 28', state: 'closed', start: new Date(Date.UTC(2026, 5, 22)), end: new Date(Date.UTC(2026, 6, 3)) };

const mk = (o) => ({
  'Issue key': o.key, 'Issue Type': 'Story', 'Status': o.status ?? 'In Progress',
  'Assignee': o.assignee ?? 'Sotirios', 'Story Points': o.sp ?? 3,
  'Resolved': o.resolved ?? null, 'Start date': o.start ?? null,
  'Created': o.created ?? new Date(SPRINT.start.getTime() - 5 * DAY).toISOString(),
  'Updated': o.updated ?? null,
});

const run = (over = {}) => computeDailyNote({
  sprint: SPRINT, today: TODAY, deriveChangelog,
  sprintTickets: [], allScoped: [], worklog: null, changelog: null, prev: null,
  ...over,
});

describe('findCurrentSprint', () => {
  it('picks the sprint today falls inside', () => {
    expect(findCurrentSprint([PREV, SPRINT], TODAY).name).toBe(SPRINT.name);
  });

  it('falls back to the most recently finished when nothing is running', () => {
    const after = new Date(Date.UTC(2026, 7, 1));
    expect(findCurrentSprint([PREV], after).name).toBe(PREV.name);
  });

  it('returns null when there are no sprints at all', () => {
    expect(findCurrentSprint([], TODAY)).toBeNull();
  });

  it('still counts the last day of a sprint whose dates come from its name', () => {
    const name = 'Sprint 29 06-07-26 to 17-07-26';
    const w = { name, ...parseSprintDates(name) };            // no Jira state to fall back on
    const lastDay = new Date(Date.UTC(2026, 6, 17, 15, 0));    // Fri 17 Jul, mid-afternoon
    expect(findCurrentSprint([w], lastDay).name).toBe(name);
    expect(computeDailyNote({ sprint: w, today: lastDay, deriveChangelog }).sprint.finished).toBe(false);
    expect(computeDailyNote({ sprint: w, today: new Date(Date.UTC(2026, 6, 18, 9)), deriveChangelog }).sprint.finished).toBe(true);
  });
});

describe('daily baseline', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('keeps comparing against yesterday however often today is saved', () => {
    saveSnapshot('ABC', { date: '2026-07-14', aging: 5, unassigned: 2 });
    saveSnapshot('ABC', { date: '2026-07-15', aging: 7, unassigned: 2 });   // first render today
    saveSnapshot('ABC', { date: '2026-07-15', aging: 8, unassigned: 3 });   // recompute after data loads
    expect(loadBaseline('ABC', '2026-07-15')).toEqual({ date: '2026-07-14', aging: 5, unassigned: 2 });
  });

  it('the recomputed note still reports the change since yesterday', () => {
    saveSnapshot('ABC', { date: '2026-07-14', aging: 1, unassigned: 0 });
    const first = run({ prev: loadBaseline('ABC', '2026-07-15') });
    saveSnapshot('ABC', first.snapshot);
    const again = run({ prev: loadBaseline('ABC', '2026-07-15') });
    expect(again.aging.hasBaseline).toBe(true);
    expect(again.aging.prev).toBe(1);
  });

  it('never treats a same-day snapshot as a baseline', () => {
    const note = run({ prev: { date: zonedDayKey(TODAY), aging: 99, unassigned: 99 } });
    expect(note.aging.hasBaseline).toBe(false);
    expect(note.unassigned.changed).toBe(false);
  });

  it('keeps each project scope separate', () => {
    saveSnapshot('ABC', { date: '2026-07-14', aging: 5, unassigned: 1 });
    saveSnapshot('XYZ', { date: '2026-07-14', aging: 40, unassigned: 9 });
    expect(loadBaseline('ABC', '2026-07-15').aging).toBe(5);
    expect(loadBaseline('XYZ', '2026-07-15').aging).toBe(40);
    expect(loadBaseline('all', '2026-07-15')).toBeNull();
  });

  it('has no baseline on the very first day', () => {
    saveSnapshot('ABC', { date: '2026-07-15', aging: 3, unassigned: 0 });
    expect(loadBaseline('ABC', '2026-07-15')).toBeNull();
  });
});

describe('buildDailyNoteText', () => {
  it('is the daily note, not the contribution report', () => {
    const note = run({
      sprintTickets: [mk({ key: 'A-1', status: 'Done', resolved: at(YESTERDAY) }), mk({ key: 'A-2', status: 'Blocked' })],
    });
    const text = buildDailyNoteText(note, 'ABC');
    expect(text).toContain(SPRINT.name);
    expect(text).toContain('WHERE THE SPRINT STANDS');
    expect(text).toContain('A-1');
    expect(text).toContain('BLOCKED (1)');
    expect(text).not.toMatch(/points per (available )?day|ahead|on pace|behind/i);
  });

  it('says plainly when no sprint is running', () => {
    expect(buildDailyNoteText(run({ sprint: null }), 'ABC')).toContain('No sprint is running');
  });
});

describe('where the sprint stands', () => {
  const tickets = [
    mk({ key: 'A-1', sp: 5, status: 'Done', resolved: at(YESTERDAY) }),
    mk({ key: 'A-2', sp: 3, status: 'Done', resolved: at(new Date(SPRINT.start.getTime() + DAY)) }),
    mk({ key: 'A-3', sp: 8, status: 'In Progress' }),
    mk({ key: 'A-4', sp: 4, status: 'To Do' }),
  ];

  it('counts committed and done from the sprint contents', () => {
    const n = run({ sprintTickets: tickets });
    expect(n.standing.committedSP).toBe(20);
    expect(n.standing.committedTickets).toBe(4);
    expect(n.standing.doneSP).toBe(8);
    expect(n.standing.doneTickets).toBe(2);
  });

  it('reports elapsed and done as two comparable fractions', () => {
    const n = run({ sprintTickets: tickets });
    expect(n.standing.pctDone).toBeCloseTo(8 / 20, 6);
    expect(n.standing.pctElapsed).toBeGreaterThan(0);
    expect(n.standing.pctElapsed).toBeLessThanOrEqual(1);
  });

  it('never reports a day beyond the length of the sprint', () => {
    const after = computeDailyNote({ sprint: SPRINT, today: new Date(Date.UTC(2026, 7, 1)), sprintTickets: tickets, deriveChangelog });
    expect(after.sprint.dayOfSprint).toBeLessThanOrEqual(after.sprint.totalDays);
    expect(after.sprint.totalDays).toBe(workingDaysInclusive(SPRINT.start, SPRINT.end));
    expect(after.sprint.finished).toBe(true);
  });

  it("projects on this sprint's own rate, not a trailing average", () => {
    const n = run({ sprintTickets: tickets });
    expect(n.standing.projectedSP).toBeCloseTo(n.standing.ratePerDay * n.sprint.totalDays, 6);
    expect(n.standing.ratePerDay).toBeCloseTo(n.standing.doneSP / n.sprint.dayOfSprint, 6);
  });
});

describe('moved in the last working day', () => {
  it('lists what reached Done and what started yesterday, and nothing else', () => {
    const n = run({
      sprintTickets: [
        mk({ key: 'A-1', status: 'Done', resolved: at(YESTERDAY) }),
        mk({ key: 'A-2', status: 'Done', resolved: at(new Date(YESTERDAY.getTime() - 5 * DAY)) }),
        mk({ key: 'A-3', status: 'In Progress', start: at(YESTERDAY) }),
        mk({ key: 'A-4', status: 'In Progress', start: at(new Date(YESTERDAY.getTime() - 9 * DAY)) }),
      ],
    });
    expect(n.moved.done.map(r => r.key)).toEqual(['A-1']);
    expect(n.moved.started.map(r => r.key)).toEqual(['A-3']);
  });

  it('skips the weekend — Monday reports on Friday', () => {
    const monday = new Date(Date.UTC(2026, 6, 13, 9));      // 13 Jul 2026 is a Monday
    const n = computeDailyNote({ sprint: SPRINT, today: monday, deriveChangelog, sprintTickets: [] });
    expect(n.moved.on.getUTCDay()).toBe(5);                 // Friday
  });

  it('returns empty lists when nothing moved, so the view can say so', () => {
    const n = run({ sprintTickets: [mk({ key: 'A-9', status: 'In Progress', start: at(new Date(YESTERDAY.getTime() - 20 * DAY)) })] });
    expect(n.moved.done).toHaveLength(0);
    expect(n.moved.started).toHaveLength(0);
  });
});

describe('not moving', () => {
  const stale = mk({ key: 'S-1', status: 'In Progress', updated: at(new Date(TODAY.getTime() - 12 * DAY)) });
  const fresh = mk({ key: 'S-2', status: 'In Progress', updated: at(YESTERDAY) });

  it('lists only in-progress tickets untouched for the threshold', () => {
    const n = run({ sprintTickets: [stale, fresh] });
    expect(n.stalled.map(s => s.key)).toEqual(['S-1']);
    expect(n.stalled[0].daysSince).toBeGreaterThanOrEqual(STALL_DAYS_DEFAULT);
  });

  it('sorts oldest first', () => {
    const older = mk({ key: 'S-0', status: 'In Progress', updated: at(new Date(TODAY.getTime() - 30 * DAY)) });
    const n = run({ sprintTickets: [stale, older, fresh] });
    expect(n.stalled.map(s => s.key)).toEqual(['S-0', 'S-1']);
  });

  it('counts a recent worklog as activity even when Jira has not been updated', () => {
    const worklog = new Map([['S-1', [{ author: 'Sotirios', started: at(YESTERDAY), seconds: 3600 }]]]);
    const n = run({ sprintTickets: [stale], worklog });
    expect(n.stalled).toHaveLength(0);
  });

  it('counts a recent status transition as activity', () => {
    const changelog = new Map([['S-1', { key: 'S-1', status: [{ t: at(YESTERDAY), from: 'To Do', to: 'In Progress' }] }]]);
    const n = run({ sprintTickets: [stale], changelog });
    expect(n.stalled).toHaveLength(0);
  });

  it('never lists Done or To Do tickets', () => {
    const n = run({ sprintTickets: [
      mk({ key: 'D-1', status: 'Done', updated: at(new Date(TODAY.getTime() - 40 * DAY)) }),
      mk({ key: 'T-1', status: 'To Do', updated: at(new Date(TODAY.getTime() - 40 * DAY)) }),
    ] });
    expect(n.stalled).toHaveLength(0);
  });
});

describe('blocked', () => {
  it('reports days blocked from the transition into the blocked status', () => {
    const blockedAt = new Date(TODAY.getTime() - 9 * DAY);
    const changelog = new Map([['B-1', { key: 'B-1', status: [{ t: at(blockedAt), from: 'In Progress', to: 'Blocked' }] }]]);
    const n = run({ sprintTickets: [mk({ key: 'B-1', status: 'Blocked' })], changelog });
    expect(n.blocked).toHaveLength(1);
    expect(n.blocked[0].daysBlocked).toBeGreaterThan(0);
  });

  it('clears the blocked-since clock when a ticket comes back out', () => {
    const changelog = new Map([['B-2', {
      key: 'B-2',
      status: [
        { t: at(new Date(TODAY.getTime() - 9 * DAY)), from: 'In Progress', to: 'Blocked' },
        { t: at(new Date(TODAY.getTime() - 2 * DAY)), from: 'Blocked', to: 'In Progress' },
      ],
    }]]);
    const n = run({ sprintTickets: [mk({ key: 'B-2', status: 'In Progress' })], changelog });
    expect(n.blocked).toHaveLength(0);
  });
});

describe('aging and unassigned queue', () => {
  const old = mk({ key: 'Q-1', status: 'In Progress', start: at(new Date(TODAY.getTime() - 120 * DAY)) });
  const recent = mk({ key: 'Q-2', status: 'In Progress', start: at(new Date(TODAY.getTime() - 2 * DAY)) });
  const unassigned = mk({ key: 'Q-3', status: 'In Progress', assignee: 'Unassigned', start: at(new Date(TODAY.getTime() - 200 * DAY)) });

  it('counts tickets open past the aging threshold across the whole scope', () => {
    const n = run({ allScoped: [old, recent, unassigned] });
    expect(n.aging.count).toBe(2);
    expect(AGING_DAYS).toBe(20);
  });

  it('reports the movement against the previous snapshot', () => {
    const n = run({ allScoped: [old, recent, unassigned], prev: { date: '2026-07-14', aging: 5, unassigned: 1 } });
    expect(n.aging.prev).toBe(5);
    expect(n.aging.delta).toBe(-3);
  });

  it('has no delta to report on the first run', () => {
    const n = run({ allScoped: [old] });
    expect(n.aging.delta).toBeNull();
    expect(n.aging.hasBaseline).toBe(false);
  });

  it('flags the unassigned queue only when the count moved', () => {
    const same = run({ allScoped: [unassigned], prev: { date: '2026-07-14', aging: 0, unassigned: 1 } });
    expect(same.unassigned.changed).toBe(false);
    const moved = run({ allScoped: [unassigned], prev: { date: '2026-07-14', aging: 0, unassigned: 4 } });
    expect(moved.unassigned.changed).toBe(true);
    expect(moved.unassigned.count).toBe(1);
  });

  it('emits a snapshot for tomorrow to compare against', () => {
    const n = run({ allScoped: [old, unassigned] });
    expect(n.snapshot).toEqual({ date: '2026-07-15', aging: 2, unassigned: 1 });
  });
});

describe('scope discipline', () => {
  it('carries no rates, intervals or per-person throughput', () => {
    const n = run({ sprintTickets: [mk({ key: 'A-1', status: 'Done', resolved: at(YESTERDAY) })] });
    const json = JSON.stringify(n);
    expect(json).not.toMatch(/spPerDay|CI|confidence|allocPct|availableDays/i);
    expect(n).not.toHaveProperty('rows');
  });
});

// ─── Boundary conditions raised in review ────────────────────────────────────

describe('timezone: the last-working-day boundary', () => {
  // Jira returns timestamps with an explicit offset (…+0300). The instant parses fine;
  // the risk is bucketing it by UTC date instead of the Athens civil date.
  it('assigns 01:00 Athens to that Athens day, not the previous UTC day', () => {
    const at0100Athens = '2026-07-14T01:00:00.000+03:00';   // 22:00 UTC on 13 Jul
    expect(new Date(at0100Athens).toISOString().slice(0, 10)).toBe('2026-07-13');  // UTC disagrees
    expect(zonedDayKey(at0100Athens, REPORT_TZ)).toBe('2026-07-14');               // Athens is right
  });

  it('assigns 23:00 Athens to that same Athens day', () => {
    const at2300Athens = '2026-07-14T23:00:00.000+03:00';   // 20:00 UTC on 14 Jul
    expect(zonedDayKey(at2300Athens, REPORT_TZ)).toBe('2026-07-14');
  });

  it('reports a worklog logged at 01:00 Athens under the right working day', () => {
    // A ticket resolved just after midnight Athens on Tue 14 Jul must appear in
    // Wednesday's note, not be lost to the UTC day before.
    const n = computeDailyNote({
      sprint: SPRINT, today: TODAY, deriveChangelog,
      sprintTickets: [mk({ key: 'TZ-1', status: 'Done', resolved: '2026-07-14T01:00:00.000+03:00' })],
    });
    expect(n.moved.onKey).toBe('2026-07-14');
    expect(n.moved.done.map(r => r.key)).toEqual(['TZ-1']);
  });

  it('reports one logged at 23:00 Athens on the same day too', () => {
    const n = computeDailyNote({
      sprint: SPRINT, today: TODAY, deriveChangelog,
      sprintTickets: [mk({ key: 'TZ-2', status: 'Done', resolved: '2026-07-14T23:00:00.000+03:00' })],
    });
    expect(n.moved.done.map(r => r.key)).toEqual(['TZ-2']);
  });

  it('excludes 23:00 Athens on the day before the target', () => {
    const n = computeDailyNote({
      sprint: SPRINT, today: TODAY, deriveChangelog,
      sprintTickets: [mk({ key: 'TZ-3', status: 'Done', resolved: '2026-07-13T23:00:00.000+03:00' })],
    });
    expect(n.moved.done).toHaveLength(0);
  });

  it('names the zone it counted days in', () => {
    expect(computeDailyNote({ sprint: SPRINT, today: TODAY, deriveChangelog }).tz).toBe('Europe/Athens');
  });
});

describe('holiday edge', () => {
  it('reports on Friday when Monday was a Greek public holiday', () => {
    // Holy Spirit Monday 2026 falls on 1 June. Tuesday 2 June must look back to Fri 29 May.
    const tuesday = new Date(Date.UTC(2026, 5, 2, 9));
    expect(previousWorkingDayKey(tuesday)).toBe('2026-05-29');
    expect(previousWorkingDay(tuesday).getUTCDay()).toBe(5);   // Friday
  });

  it('skips 1 May when it falls midweek', () => {
    // 1 May 2026 is a Friday; Monday 4 May must look back to Thursday 30 April.
    const monday = new Date(Date.UTC(2026, 4, 4, 9));
    expect(previousWorkingDayKey(monday)).toBe('2026-04-30');
  });

  it('still returns the plain previous day when no holiday intervenes', () => {
    const thursday = new Date(Date.UTC(2026, 6, 16, 9));
    expect(previousWorkingDayKey(thursday)).toBe('2026-07-15');
  });
});

describe('no current sprint', () => {
  const openOld = mk({ key: 'X-1', status: 'In Progress', start: at(new Date(TODAY.getTime() - 90 * DAY)) });

  it('computes without throwing', () => {
    expect(() => computeDailyNote({ sprint: null, today: TODAY, deriveChangelog, allScoped: [openOld] })).not.toThrow();
  });

  it('returns a null sprint the view can render an empty state from', () => {
    const n = computeDailyNote({ sprint: null, today: TODAY, deriveChangelog, allScoped: [openOld] });
    expect(n.sprint).toBeNull();
    expect(n.standing.committedSP).toBe(0);
    expect(n.standing.projectedSP).toBeNull();
    expect(n.moved.done).toEqual([]);
  });

  it('still counts the aging queue, which does not depend on a sprint', () => {
    const n = computeDailyNote({ sprint: null, today: TODAY, deriveChangelog, allScoped: [openOld] });
    expect(n.aging.count).toBe(1);
  });
});

describe('first load with no stored baseline', () => {
  it('reports no comparison rather than implying no change', () => {
    const n = computeDailyNote({ sprint: SPRINT, today: TODAY, deriveChangelog, allScoped: [], prev: null });
    expect(n.aging.hasBaseline).toBe(false);
    expect(n.aging.delta).toBeNull();
    expect(n.unassigned.hasBaseline).toBe(false);
    expect(n.unassigned.changed).toBe(false);
  });

  it('treats a malformed stored snapshot as no baseline', () => {
    const n = computeDailyNote({ sprint: SPRINT, today: TODAY, deriveChangelog, prev: { date: '2026-07-14' } });
    expect(n.aging.hasBaseline).toBe(false);
  });
});

describe('configurable not-moving threshold', () => {
  const idle4 = mk({ key: 'C-1', status: 'In Progress', updated: at(new Date(TODAY.getTime() - 6 * DAY)) });

  it('defaults to 3 working days', () => {
    expect(STALL_DAYS_DEFAULT).toBe(3);
    const n = computeDailyNote({ sprint: SPRINT, today: TODAY, deriveChangelog, sprintTickets: [idle4] });
    expect(n.stalled).toHaveLength(1);
    expect(n.stallDays).toBe(3);
  });

  it('drops the item when the threshold is raised past its idle time', () => {
    const n = computeDailyNote({ sprint: SPRINT, today: TODAY, deriveChangelog, sprintTickets: [idle4], stallDays: 7 });
    expect(n.stalled).toHaveLength(0);
    expect(n.stallDays).toBe(7);
  });
});
