import { describe, it, expect } from 'vitest';
import {
  headlineLists, statusMatrix, createdVsResolved, workloadFromStats, openLoadByPerson,
  getDue, isHighPriority,
} from '../utils/pmDashboard';

const row = (key, over = {}) => ({ Key: key, Status: 'In Progress', Priority: 'Medium', Assignee: 'Anna', Project: 'P1', 'Story Points': 2, ...over });
const today = '2026-10-07';
const now = new Date('2026-10-07T09:00:00Z');   // Wednesday

describe('headlineLists', () => {
  const rows = [
    row('A-1', { Priority: 'Highest', 'Due Date': '2026-10-06' }),                  // overdue
    row('A-2', { Priority: 'High', 'Due date': '2026-10-07' }),                      // due today: soon, not overdue
    row('A-3', { Status: 'On Hold', 'Due Date': '2026-10-14' }),                     // due in 7 days: soon
    row('A-4', { Assignee: 'Unassigned', 'Due Date': '2026-10-15' }),                // 8 days: neither
    row('A-5', { Status: 'To Do', Assignee: '' }),
  ];
  const changelogs = new Map([
    ['A-1', { status: [{ t: '2026-09-01T10:00:00Z', from: 'To Do', to: 'In Progress' }] }],  // > 10 working days
    ['A-2', { status: [{ t: '2026-10-05T10:00:00Z', from: 'To Do', to: 'In Progress' }] }],  // 2 days
    ['A-3', { status: [{ t: '2026-08-01T10:00:00Z', from: 'In Progress', to: 'On Hold' }] }], // on hold: counted there, not stuck
    ['A-5', { status: [] }],
  ]);
  const h = headlineLists(rows, { today, changelogs, now });
  const keys = l => l.map(t => t.Key);

  it('splits priorities like the Jira dashboard', () => {
    expect(keys(h.highest)).toEqual(['A-1']);
    expect(keys(h.high)).toEqual(['A-2']);
  });
  it('counts overdue as due before today, and due soon as today through the next 7 days', () => {
    expect(keys(h.overdue)).toEqual(['A-1']);
    expect(keys(h.dueSoon)).toEqual(['A-2', 'A-3']);
  });
  it('counts on hold and unassigned (blank or "Unassigned")', () => {
    expect(keys(h.onHold)).toEqual(['A-3']);
    expect(keys(h.unassigned)).toEqual(['A-4', 'A-5']);
  });
  it('flags started work stuck 10+ working days, only from real change history', () => {
    expect(h.stuck.map(t => [t.Key, t._daysInStatus])).toEqual([['A-1', 26]]);
    expect(headlineLists(rows, { today, changelogs: null, now }).stuck).toEqual([]);
  });
});

describe('statusMatrix', () => {
  it('counts projects by status in workflow order, busiest project first', () => {
    const m = statusMatrix([
      row('A-1', { Status: 'Awaiting Testing' }), row('A-2', { Status: 'To Do' }),
      row('B-1', { Project: 'P2', Status: 'In Progress' }), row('B-2', { Project: 'P2', Status: 'In Progress' }), row('B-3', { Project: 'P2', Status: 'Parking Lot' }),
    ]);
    expect(m.columns).toEqual(['To Do', 'In Progress', 'Awaiting Testing', 'Parking Lot']);
    expect(m.rows.map(r => [r.project, r.total])).toEqual([['P2', 3], ['P1', 2]]);
    expect(m.totals).toEqual({ 'To Do': 1, 'In Progress': 2, 'Awaiting Testing': 1, 'Parking Lot': 1 });
    expect(m.total).toBe(5);
  });
});

describe('createdVsResolved', () => {
  it('buckets by Monday-starting week in Athens time and only counts resolved work that is done', () => {
    const r = createdVsResolved([
      row('A-1', { Created: '2026-10-05T06:00:00Z' }),                                                   // this week
      row('A-2', { Created: '2026-10-04T22:30:00Z' }),                                                   // Mon 01:30 Athens: this week
      row('A-3', { Created: '2026-09-29T08:00:00Z', Status: 'Done', Resolved: '2026-10-06T08:00:00Z' }), // created last week, resolved this
      row('A-4', { Status: 'In Progress', Resolved: '2026-10-06T08:00:00Z' }),                           // reopened: not resolved
      row('A-5', { Created: '2025-01-01T08:00:00Z' }),                                                   // outside the window
    ], { now, weeks: 2 });
    expect(r.weeks).toEqual([
      { week: '2026-09-28', created: 1, resolved: 0 },
      { week: '2026-10-05', created: 2, resolved: 1 },
    ]);
    expect(r.net).toBe(2);
  });
});

describe('workload', () => {
  it('takes sprint workload from the capacity stats, alphabetically, skipping excluded and idle people', () => {
    const w = workloadFromStats({
      Zoe: { baseCapacity: 16, activeWorkload: 20, awaitingWorkload: 2, completedWorkload: 1, remainingCapacity: -4, activeItems: 5, capacityStatus: 'Overloaded' },
      Anna: { baseCapacity: 16, activeWorkload: 4, awaitingWorkload: 0, completedWorkload: 6, remainingCapacity: 12, activeItems: 2, capacityStatus: 'Has Capacity' },
      Idle: { baseCapacity: 16, activeWorkload: 0, awaitingWorkload: 0, completedWorkload: 0 },
      Excluded: { baseCapacity: 16, activeWorkload: 9 },
      Unassigned: { baseCapacity: 16, activeWorkload: 0, activeItems: 5 },
    }, ['Excluded']);
    expect(w.map(p => p.name)).toEqual(['Anna', 'Zoe']);
    expect(w[1]).toMatchObject({ utilization: 125, status: 'Overloaded', remaining: -4 });
  });

  it('summarises all open work per person, with Unassigned last', () => {
    const l = openLoadByPerson([
      row('A-1', { Assignee: 'Zoe', Status: 'Awaiting Testing', Priority: 'High' }),
      row('A-2', { Assignee: 'Zoe', 'Due Date': '2026-10-01' }),
      row('A-3', { Assignee: '' }),
      row('A-4', { Assignee: 'Anna', Status: 'To Do' }),
    ], { today });
    expect(l.map(p => p.name)).toEqual(['Anna', 'Zoe', 'Unassigned']);
    expect(l[1]).toMatchObject({ items: 2, sp: 4, inProgress: 1, awaiting: 1, overdue: 1, high: 1 });
  });
});

describe('helpers', () => {
  it('reads due dates under either column name and ignores junk', () => {
    expect(getDue({ 'Due date': '2026-10-09' })).toBe('2026-10-09');
    expect(getDue({ 'Due Date': '2026-10-09T00:00:00.000+0300' })).toBe('2026-10-09');
    expect(getDue({ 'Due Date': 'soon' })).toBeNull();
    expect(isHighPriority({ Priority: ' High ' })).toBe(true);
  });
});
