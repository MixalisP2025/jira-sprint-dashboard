import { describe, it, expect } from 'vitest';
import {
  isAwaiting, sprintHistory, sprintCalendar, currentSprint, sprintLedger, daysInStatus,
  sprintMembership, reviewContext, hasSprintHistory, latestRowPerIssue,
  cycleDays, staleTickets, sprintElapsedPct, paceVerdict, compareSprints, suggestions,
} from '../utils/sprintReview';

// Sprints as Jira returns them in customfield_10010.
const S = (n, start, end, state = 'closed') => ({ name: `Sprint ${n}`, state, startDate: `${start}T08:00:00Z`, endDate: `${end}T17:00:00Z` });
const S31 = S(31, '2026-08-17', '2026-08-28');
const S32 = S(32, '2026-08-31', '2026-09-11');
const S33 = S(33, '2026-09-14', '2026-09-25');
const S34 = S(34, '2026-09-28', '2026-10-09', 'active');
// Another board's sprint running alongside S34.
const OTHER = { name: 'CS Board 12', state: 'active', startDate: '2026-09-21T08:00:00Z', endDate: '2026-10-02T17:00:00Z' };

const row = (key, sprints, over = {}) => ({
  Key: key, Status: 'In Progress', 'Story Points': 3, Assignee: 'Anna', Project: 'P',
  Created: '2026-08-01T09:00:00Z', Sprint: sprints.at(-1)?.name || '',
  _rawFields: { customfield_10010: sprints }, ...over,
});

describe('status rules', () => {
  it('treats testing, versioning and review as awaiting, never a done status', () => {
    expect(isAwaiting('Awaiting Testing')).toBe(true);
    expect(isAwaiting('AWAITING VERSIONING')).toBe(true);
    expect(isAwaiting('In Review')).toBe(true);
    expect(isAwaiting('In Progress')).toBe(false);
    expect(isAwaiting('Done')).toBe(false);
  });
});

describe('sprintHistory', () => {
  it('reads every sprint from the Jira field, oldest first, even when Jira lists them out of order', () => {
    const h = sprintHistory(row('A-1', [S34, S33]));
    expect(h.map(s => s.name)).toEqual(['Sprint 33', 'Sprint 34']);
    expect(h[0].start).toBeInstanceOf(Date);
  });

  it('repairs a mistyped year in a sprint name to a two-week sprint', () => {
    const [s] = sprintHistory({ Sprint: 'Sprint 32 31-08-26 to 11-09-27' });
    expect(s.end.toISOString().slice(0, 10)).toBe('2026-09-13');
  });

  it('falls back to the flat Sprint column for CSV uploads', () => {
    const h = sprintHistory({ Sprint: 'Sprint 34 28-09-26 to 09-10-26' });
    expect(h).toHaveLength(1);
    expect(h[0].start.toISOString().slice(0, 10)).toBe('2026-09-28');
  });
});

describe('sprintCalendar / currentSprint', () => {
  const rows = [row('A-1', [S32]), row('A-2', [S33, S34]), row('A-3', [OTHER])];
  it('orders sprints by start date', () => {
    expect(sprintCalendar(rows).map(s => s.name)).toEqual(['Sprint 32', 'Sprint 33', 'CS Board 12', 'Sprint 34']);
  });
  it('picks the sprint running today', () => {
    expect(currentSprint(sprintCalendar(rows), new Date('2026-10-06T12:00:00Z'))).toBe('Sprint 34');
  });
});

describe('sprintLedger', () => {
  const rows = [
    row('A-1', [S34], { Status: 'Done' }),
    row('A-2', [S34], { Status: 'Awaiting Testing', 'Story Points': 2 }),
    row('A-3', [S33, S34], { Status: 'To Do' }),           // carried in
    row('A-4', [S34, S(35, '2026-10-12', '2026-10-23', 'future')]),   // carried out
    row('A-5', [S34], { 'Story Points': 0, Assignee: 'Unassigned', Created: '2026-10-01T09:00:00Z' }),
    row('B-1', [S33], { Status: 'Done' }),                 // not in the sprint
  ];
  const L = sprintLedger(rows, 'Sprint 34', { start: new Date('2026-09-28T08:00:00Z'), end: new Date('2026-10-09T17:00:00Z') });

  it('counts every ticket that was ever in the sprint as committed', () => {
    expect(L.items).toBe(5);
    expect(L.sp).toBe(11);
  });
  it('splits the commitment into done, awaiting, to do, in progress and carried out', () => {
    expect(L.doneSP).toBe(3);
    expect(L.awaitingSP).toBe(2);
    expect(L.todoSP).toBe(3);
    expect(L.carriedOutItems).toBe(1);
    expect(L.inProgressItems).toBe(1);   // A-5
  });
  it('flags carry-over, mid-sprint additions, unpointed and unassigned work', () => {
    expect(L.carriedIn.map(c => c.ticket.Key)).toEqual(['A-3']);
    expect(L.addedAfterStart).toBe(1);
    expect(L.unpointed).toBe(1);
    expect(L.unassigned).toBe(1);
  });
});

describe('daysInStatus / cycleDays', () => {
  const now = new Date('2026-10-06T12:00:00Z');   // Tuesday
  it('measures from the last status change when history is loaded', () => {
    const d = daysInStatus(row('A-1', [S34]), { status: [{ t: '2026-09-29T10:00:00Z', from: 'To Do', to: 'In Progress' }] }, now);
    expect(d).toMatchObject({ days: 5, exact: true });
  });
  it('falls back to the created date and says so', () => {
    const d = daysInStatus(row('A-1', [S34], { Created: '2026-10-01T09:00:00Z' }), null, now);
    expect(d).toMatchObject({ days: 3, exact: false });
  });
  it('times a cycle from first leaving the backlog to the last move into done', () => {
    const cl = { status: [
      { t: '2026-09-28T09:00:00Z', from: 'To Do', to: 'In Progress' },
      { t: '2026-09-30T09:00:00Z', from: 'In Progress', to: 'Done' },
      { t: '2026-10-01T09:00:00Z', from: 'Done', to: 'In Progress' },
      { t: '2026-10-02T09:00:00Z', from: 'In Progress', to: 'Done' },
    ] };
    expect(cycleDays(row('A-1', [S34]), cl)).toBe(4);
  });
});

describe('staleTickets', () => {
  it('lists open work still in the sprint, longest-stuck first', () => {
    const rows = [
      row('A-1', [S34], { Created: '2026-09-28T09:00:00Z' }),
      row('A-2', [S34], { Created: '2026-09-15T09:00:00Z' }),
      row('A-3', [S34], { Status: 'Done' }),
      row('A-4', [S34, S(35, '2026-10-12', '2026-10-23', 'future')]),
    ];
    const L = sprintLedger(rows, 'Sprint 34', { start: new Date('2026-09-28T08:00:00Z') });
    const s = staleTickets(L, new Map(), new Date('2026-10-06T12:00:00Z'));
    expect(s.map(x => x.key)).toEqual(['A-2', 'A-1']);
  });
});

describe('pace', () => {
  const L = { start: new Date('2026-09-28T08:00:00Z'), end: new Date('2026-10-09T17:00:00Z'), deliveredPct: 20 };
  it('counts only working days already gone', () => {
    // Mon 28 Sep – Fri 9 Oct is 10 working days; Tue 6 Oct has 6 fully gone
    expect(sprintElapsedPct(L, new Date('2026-10-06T12:00:00Z'))).toBe(60);
  });
  it('calls a sprint behind when done % trails the clock by more than the tolerance', () => {
    expect(paceVerdict(L, new Date('2026-10-06T12:00:00Z')).verdict).toBe('behind');
    expect(paceVerdict({ ...L, deliveredPct: 55 }, new Date('2026-10-06T12:00:00Z')).verdict).toBe('on-pace');
  });
});

describe('compareSprints', () => {
  const rows = [
    row('A-1', [S31], { Status: 'Done', 'Story Points': 10 }),
    row('A-2', [S32], { Status: 'Done', 'Story Points': 10 }),
    row('A-3', [S33], { Status: 'Done', 'Story Points': 10 }),
    row('A-4', [S34], { Status: 'Done', 'Story Points': 4 }),
    row('A-5', [S34], { Status: 'To Do', 'Story Points': 6 }),
    row('X-1', [OTHER], { Status: 'Done', 'Story Points': 50 }),
  ];
  const cal = sprintCalendar(rows);
  const c = compareSprints(rows, cal, 'Sprint 34', new Map());

  it('takes the selected sprint and the three before it, skipping a parallel board\'s sprint', () => {
    expect(c.sprints.map(s => s.sprint)).toEqual(['Sprint 31', 'Sprint 32', 'Sprint 33', 'Sprint 34']);
  });
  it('compares the selected sprint with the earlier average', () => {
    expect(c.trend.doneSP).toMatchObject({ avg: 10, direction: 'down', good: false });
    expect(c.trend.deliveredPct).toMatchObject({ avg: 100, direction: 'down', good: false });
  });
});

describe('suggestions', () => {
  const base = { awaitingSP: 0, inProgressSP: 10, todoSP: 0, awaitingItems: 0, items: 10, carriedIn: [], carryInPct: 0, addedAfterStart: 0, unpointed: 0, unassigned: 0, deliveredPct: 50 };
  it('says nothing stands out when no rule fires', () => {
    expect(suggestions({ ledger: base, stale: [], comparison: null, pace: null }).map(s => s.severity)).toEqual(['reassuring']);
  });
  it('flags a testing bottleneck from the share of open SP that is awaiting', () => {
    const s = suggestions({ ledger: { ...base, awaitingSP: 6, inProgressSP: 4, awaitingItems: 3 }, stale: [], comparison: null, pace: null });
    expect(s[0].title).toMatch(/queuing/);
  });
  it('does not compare delivery with earlier sprints until the sprint has ended', () => {
    const comparison = { sprints: [{ deliveredPct: 80 }, { deliveredPct: 20 }], trend: { deliveredPct: { avg: 80, delta: -60, good: false } } };
    const titles = p => suggestions({ ledger: base, stale: [], comparison, pace: p }).map(s => s.title);
    expect(titles({ verdict: 'on-pace', elapsed: 40 })).not.toContain('Less of the commitment is being delivered');
    expect(titles({ verdict: 'behind', elapsed: 100 })).toContain('Less of the commitment is being delivered');
  });

  it('never names a person', () => {
    const s = suggestions({ ledger: { ...base, unassigned: 2, carryInPct: 40, carriedIn: [{}, {}, {}, {}] }, stale: [{ days: 20, assignee: 'Anna' }], comparison: null, pace: { verdict: 'behind', elapsed: 80 } });
    expect(JSON.stringify(s)).not.toMatch(/Anna/);
  });
});

describe('sprintMembership with Sprint change history', () => {
  // Shapes copied from real bulkfetch output: "" for no sprint, names as they were then.
  const S33renamed = 'Sprint 33 14-09-26 to 25-09-28';   // later corrected to ...25-09-26
  const s33 = { ...S33, name: 'Sprint 33 14-09-26 to 25-09-26' };
  const s34 = { ...S34, name: 'Sprint 34 28-09-26 to 09-10-26' };
  const now = new Date('2026-10-06T12:00:00Z');
  const rows = [
    // moved S33 -> S34 at close: the sprint field only shows S34
    row('CC-11', [s34], { Created: '2026-09-10T09:00:00Z' }),
    // added to S33 for a minute, removed, later planned into S34
    row('CC-10', [s34], { Created: '2026-09-10T09:00:00Z' }),
    // pulled into S34 mid-sprint from the backlog
    row('CC-20', [s34], { Created: '2026-09-01T09:00:00Z' }),
    row('CC-30', [s33], { Status: 'Done' }),
  ];
  const changelogs = new Map([
    ['CC-11', { sprint: [
      { t: '2026-09-18T05:52:46Z', from: '', to: S33renamed },
      { t: '2026-09-25T14:37:29Z', from: s33.name, to: 'Sprint 34 28-09-26 to 09-10-26' },
    ] }],
    ['CC-10', { sprint: [
      { t: '2026-09-18T05:54:42Z', from: '', to: s33.name },
      { t: '2026-09-18T05:55:25Z', from: s33.name, to: '' },
      { t: '2026-09-25T14:39:19Z', from: '', to: 'Sprint 34 28-09-26 to 09-10-26' },
    ] }],
    ['CC-20', { sprint: [{ t: '2026-10-02T10:00:00Z', from: '', to: 'Sprint 34 28-09-26 to 09-10-26' }] }],
  ]);
  const ctx = reviewContext(rows, changelogs, now);

  it('recovers a sprint the ticket was moved out of, matching a renamed sprint', () => {
    expect(sprintMembership(rows[0], ctx).map(s => s.name)).toEqual(['Sprint 33', 'Sprint 34'].map(n => expect.stringContaining(n)));
  });
  it('ignores a sprint the ticket passed through for seconds', () => {
    expect(sprintMembership(rows[1], ctx)).toHaveLength(1);
  });
  it('counts carry-over in and out, and work moved in mid-sprint', () => {
    const cal = [...ctx.calendar.values()];
    const L33 = sprintLedger(rows, s33.name, cal.find(s => s.name.startsWith('Sprint 33')), ctx);
    expect(L33.items).toBe(2);              // CC-11 and CC-30, not CC-10
    expect(L33.carriedOutItems).toBe(1);
    expect(L33.deliveredPct).toBe(50);
    const L34 = sprintLedger(rows, 'Sprint 34 28-09-26 to 09-10-26', cal.find(s => s.name.startsWith('Sprint 34')), ctx);
    expect(L34.carriedIn.map(c => c.ticket.Key)).toEqual(['CC-11']);
    expect(L34.addedAfterStart).toBe(1);    // CC-20; CC-10 and CC-11 were planned before the start
  });
  it('reports history as available once Sprint changelogs are loaded', () => {
    expect(hasSprintHistory([{ Sprint: 'Sprint 34' }], changelogs)).toBe(true);
    expect(hasSprintHistory([{ Sprint: 'Sprint 34' }], null)).toBe(false);
  });
});

describe('compareSprints with back-to-back sprints', () => {
  it('keeps a sprint that ended a few hours after the next one started', () => {
    const s31 = { ...S31, endDate: '2026-08-28T14:30:00Z' };
    const s32 = { ...S32, startDate: '2026-08-28T06:00:00Z' };
    const rows = [row('A-1', [s31], { Status: 'Done' }), row('A-2', [s32], { Status: 'Done' })];
    const c = compareSprints(rows, sprintCalendar(rows), 'Sprint 32', new Map());
    expect(c.sprints.map(s => s.sprint)).toEqual(['Sprint 31', 'Sprint 32']);
  });
});

describe('latestRowPerIssue', () => {
  it('keeps the row in the latest sprint when the database snapshot repeats an issue per sprint', () => {
    const rows = [
      { Key: 'T-1', Sprint: 'Sprint 34 28-09-26 to 09-10-26', Status: 'In Progress' },
      { Key: 'T-1', Sprint: 'Sprint 33 14-09-26 to 25-09-26', Status: 'To Do' },
      { Key: 'T-2', Sprint: 'Sprint 33 14-09-26 to 25-09-26', Status: 'Done' },
    ];
    const out = latestRowPerIssue(rows);
    expect(out).toHaveLength(2);
    expect(out.find(r => r.Key === 'T-1').Status).toBe('In Progress');
  });
});
