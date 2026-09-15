import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveAvailability, detectServiceAccountCandidates, loadServiceAccounts, saveJson,
  SERVICE_ACCOUNTS_KEY, overridesForScope, withScopeOverrides,
} from '../utils/teamAllocation';
import { loadPlanningSPPerDay, DEFAULT_SP_PER_DAY } from '../utils/teamEngine';

describe('persisted settings', () => {
  let store;
  beforeEach(() => {
    store = new Map();
    globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('lets a user un-exclude "Unassigned" after a first-ever load', () => {
    expect(loadServiceAccounts()).toEqual(['Unassigned']);   // first load seeds the default
    saveJson(SERVICE_ACCOUNTS_KEY, []);                        // user removes it
    expect(loadServiceAccounts()).toEqual([]);                 // and it stays removed
  });

  it('still folds the default into a list saved before defaults existed, once', () => {
    saveJson(SERVICE_ACCOUNTS_KEY, ['build-bot']);
    expect(loadServiceAccounts().sort()).toEqual(['Unassigned', 'build-bot']);
    saveJson(SERVICE_ACCOUNTS_KEY, ['build-bot']);
    expect(loadServiceAccounts()).toEqual(['build-bot']);
  });

  it('uses the same planning-constant default as Time Tracking', () => {
    expect(loadPlanningSPPerDay()).toBe(DEFAULT_SP_PER_DAY);
    expect(DEFAULT_SP_PER_DAY).toBe(2);
    store.set('tt_spPerDay', '1.5');
    expect(loadPlanningSPPerDay()).toBe(1.5);
  });
});

describe('allocation overrides are per project scope', () => {
  it('keeps one project\'s allocation off every other scope', () => {
    const stored = withScopeOverrides({}, 'ABC', { Ann: 0.5 });
    expect(overridesForScope(stored, 'ABC')).toEqual({ Ann: 0.5 });
    expect(overridesForScope(stored, 'XYZ')).toEqual({});
    expect(overridesForScope(stored, 'all')).toEqual({});
  });

  it('updates one scope without touching another', () => {
    let stored = withScopeOverrides({}, 'ABC', { Ann: 0.5 });
    stored = withScopeOverrides(stored, 'XYZ', { Ann: 0.3 });
    stored = withScopeOverrides(stored, 'ABC', {});
    expect(overridesForScope(stored, 'ABC')).toEqual({});
    expect(overridesForScope(stored, 'XYZ')).toEqual({ Ann: 0.3 });
  });

  it('ignores the old flat format instead of applying it everywhere', () => {
    const legacy = { Ann: 0.5, Bob: 0.25 };
    expect(overridesForScope(legacy, 'ABC')).toEqual({});
    expect(withScopeOverrides(legacy, 'ABC', { Cat: 0.8 })).toEqual({ ABC: { Cat: 0.8 } });
  });
});
import { workingDaysBetween, workingDaysInclusive, workingDaysList } from '../utils/workingDays';

// Six two-week sprints through 2026.
function makeSprints(n = 6) {
  const out = [];
  let cur = new Date(Date.UTC(2026, 0, 5));
  for (let i = 0; i < n; i++) {
    const start = new Date(cur);
    const end = new Date(cur); end.setUTCDate(end.getUTCDate() + 13);
    out.push({ name: `Sprint ${i + 1}`, start, end });
    cur = new Date(end); cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}
const midOf = s => { const d = new Date(s.start); d.setUTCDate(d.getUTCDate() + 3); return d.toISOString(); };

const sprints = makeSprints();
const totalWindowDays = sprints.reduce((a, s) => a + workingDaysInclusive(s.start, s.end), 0);

// Sotirios logs in all 6 · Giorgos in the first 3 · Vasiliki in the last 2 ·
// Panagiota only completes a ticket (no worklog) · Nobody leaves no trace at all.
const worklogByKey = new Map([
  ['A-1', [
    ...sprints.map(s => ({ author: 'Sotirios', started: midOf(s), seconds: 3600 })),
    ...sprints.slice(0, 3).map(s => ({ author: 'Giorgos', started: midOf(s), seconds: 3600 })),
    ...sprints.slice(4).map(s => ({ author: 'Vasiliki', started: midOf(s), seconds: 3600 })),
  ]],
]);
const doneEvents = [
  ...sprints.map(s => ({ name: 'Sotirios', date: midOf(s) })),
  ...sprints.slice(0, 3).map(s => ({ name: 'Giorgos', date: midOf(s) })),
  { name: 'Panagiota', date: midOf(sprints[5]) },
];
const names = ['Sotirios', 'Giorgos', 'Vasiliki', 'Panagiota', 'Nobody'];

const resolve = (extra = {}) => resolveAvailability({
  windowSprints: sprints, names, worklogByKey, doneEvents,
  allocationPctOf: () => 1, allocationBasisOf: () => 'portfolio',
  ...extra,
}).byName;

describe('resolveAvailability — presence gating', () => {
  it('gives a contributor present all window the full working-day count', () => {
    const a = resolve().get('Sotirios');
    expect(a.presentCount).toBe(6);
    expect(a.availableDays).toBeCloseTo(totalWindowDays, 6);
  });

  it('scales available days down to the sprints a contributor was actually present for', () => {
    const g = resolve().get('Giorgos');
    expect(g.presentCount).toBe(3);
    expect(g.availableDays).toBeLessThan(totalWindowDays);
    expect(g.availableDays).toBeCloseTo(sprints.slice(0, 3).reduce((a, s) => a + workingDaysInclusive(s.start, s.end), 0), 6);
  });

  it('raises the throughput of a part-window contributor — the bug this fixes', () => {
    const g = resolve().get('Giorgos');
    const sp = 39.3;
    const before = sp / totalWindowDays;   // the shipped behaviour: full window for everyone
    const after = sp / g.availableDays;
    expect(after).toBeGreaterThan(before * 1.8);
  });

  it('prefers worklog presence over completion presence', () => {
    expect(resolve().get('Giorgos').presenceBasis).toBe('worklog');
  });

  it('flags presence that rests on completed tickets alone as the weaker basis', () => {
    const p = resolve().get('Panagiota');
    expect(p.presenceBasis).toBe('completion');
    expect(p.presentCount).toBe(1);
    expect(p.completionOnlySprints).toBe(1);
  });

  it('does not mark someone absent everywhere when they leave no signal at all', () => {
    const n = resolve().get('Nobody');
    expect(n.presentCount).toBe(6);
    expect(n.availableDays).toBeCloseTo(totalWindowDays, 6);
    expect(n.trusted).toBe(false);   // ...but the figure is not trustworthy, so it is suppressed
    expect(n.presenceBasis).toBe('assumed');
  });
});

describe('resolveAvailability — allocation basis', () => {
  it('labels portfolio scope as fully allocated and trusted', () => {
    const a = resolve().get('Sotirios');
    expect(a.allocPct).toBe(1);
    expect(a.allocBasis).toBe('portfolio');
    expect(a.trusted).toBe(true);
  });

  it('falls back to assumed full-time and marks it untrusted when nothing can be inferred', () => {
    const a = resolve({ allocationPctOf: () => null, allocationBasisOf: () => null }).get('Sotirios');
    expect(a.allocPct).toBe(1);
    expect(a.allocBasis).toBe('assumed');
    expect(a.trusted).toBe(false);
  });

  it('lets an explicit override win over an inferred basis and restores trust', () => {
    const a = resolve({ allocationPctOf: () => null, allocationBasisOf: () => null, configured: { Sotirios: 0.6 } }).get('Sotirios');
    expect(a.allocBasis).toBe('configured');
    expect(a.allocPct).toBeCloseTo(0.6, 6);
    expect(a.availableDays).toBeCloseTo(totalWindowDays * 0.6, 6);
    expect(a.trusted).toBe(true);
  });

  it('multiplies allocation and presence together', () => {
    const g = resolve({ configured: { Giorgos: 0.5 } }).get('Giorgos');
    const presentDays = sprints.slice(0, 3).reduce((a, s) => a + workingDaysInclusive(s.start, s.end), 0);
    expect(g.availableDays).toBeCloseTo(presentDays * 0.5, 6);
  });

  it('applies inferred sp-share allocation and keeps it trusted', () => {
    const a = resolve({ allocationPctOf: () => 0.25, allocationBasisOf: () => 'spShare' }).get('Sotirios');
    expect(a.allocBasis).toBe('spShare');
    expect(a.availableDays).toBeCloseTo(totalWindowDays * 0.25, 6);
    expect(a.trusted).toBe(true);
  });

  it('states the basis in words for every person', () => {
    const a = resolve().get('Giorgos');
    expect(a.basisLabel).toMatch(/allocation/i);
    expect(a.basisLabel).toMatch(/present in 3 of 6/);
  });
});

describe('resolveAvailability — pointing-coverage gate', () => {
  // Sprints whose completed work was largely unpointed cannot support a rate; their days
  // must leave the denominator, or the rate reports a pointing-practice change as delivery.
  const ratedNames = new Set(sprints.slice(2).map(s => s.name));   // first two excluded
  const ratedDays = sprints.slice(2).reduce((a, s) => a + workingDaysInclusive(s.start, s.end), 0);

  it('drops excluded sprints from available days', () => {
    const a = resolve({ ratedSprintNames: ratedNames }).get('Sotirios');
    expect(a.availableDays).toBeCloseTo(ratedDays, 6);
    expect(a.availableDays).toBeLessThan(totalWindowDays);
  });

  it('still records the days the person was actually present, for display', () => {
    const a = resolve({ ratedSprintNames: ratedNames }).get('Sotirios');
    const presentDays = a.perSprint.reduce((acc, s) => acc + s.presentDays, 0);
    expect(presentDays).toBeCloseTo(totalWindowDays, 6);
    expect(a.presentCount).toBe(6);      // presence is unchanged by the gate
  });

  it('marks each sprint slot with whether it counts toward a rate', () => {
    const a = resolve({ ratedSprintNames: ratedNames }).get('Sotirios');
    expect(a.perSprint.map(s => s.rated)).toEqual([false, false, true, true, true, true]);
  });

  it('raises the measured rate once unpointed sprints are excluded', () => {
    const sp = 224;   // points delivered in the rated sprints only
    const gated = resolve({ ratedSprintNames: ratedNames }).get('Sotirios');
    const ungated = resolve().get('Sotirios');
    expect(sp / gated.availableDays).toBeGreaterThan(sp / ungated.availableDays);
  });

  it('counts every sprint when no gate is supplied', () => {
    expect(resolve().get('Sotirios').perSprint.every(s => s.rated)).toBe(true);
  });

  it('does not resurrect days for a sprint the person was absent from', () => {
    const g = resolve({ ratedSprintNames: ratedNames }).get('Giorgos');   // present sprints 1-3
    const overlap = sprints.slice(2, 3).reduce((a, s) => a + workingDaysInclusive(s.start, s.end), 0);
    expect(g.availableDays).toBeCloseTo(overlap, 6);   // only sprint 3 is both present and rated
  });
});

describe('detectServiceAccountCandidates', () => {
  const rows = [
    { name: 'Sotirios', tickets: 43, sp: 90, hours: 91.8, worklogCount: 40, sprintsActive: 6 },
    { name: 'Agent A', tickets: 0, sp: 0, hours: 2, worklogCount: 4, sprintsActive: 0 },
  ];

  it('flags an account that completed nothing and carries no points', () => {
    expect(detectServiceAccountCandidates(rows).map(c => c.name)).toEqual(['Agent A']);
  });

  it('never flags a contributor with completed work', () => {
    expect(detectServiceAccountCandidates(rows).map(c => c.name)).not.toContain('Sotirios');
  });

  it('stops re-suggesting an account already confirmed or excluded', () => {
    expect(detectServiceAccountCandidates(rows, ['Agent A'])).toEqual([]);
  });
});

describe('workingDays', () => {
  it('excludes weekends and Greek public holidays', () => {
    // 2026-03-25 (Independence Day) is a Wednesday and must not be counted.
    const days = workingDaysList(new Date(Date.UTC(2026, 2, 23)), new Date(Date.UTC(2026, 2, 29)));
    expect(days).toContain('2026-03-23');
    expect(days).not.toContain('2026-03-25');
    expect(days).not.toContain('2026-03-28'); // Saturday
  });

  it('counts a sprint inclusively — both the first and last day are working days', () => {
    const a = sprints[0];
    // the elapsed helper skips the start day; the capacity helper must not
    expect(workingDaysInclusive(a.start, a.end)).toBe(workingDaysBetween(a.start, a.end) + 1);
    expect(workingDaysList(a.start, a.end).length).toBe(workingDaysInclusive(a.start, a.end));
  });

  it('counts 58 working days across 27 Apr - 17 Jul 2026, not 52', () => {
    // six two-week sprints; 60 weekdays less 1 May and Holy Spirit Monday (1 Jun)
    const span = workingDaysInclusive(new Date(Date.UTC(2026, 3, 27)), new Date(Date.UTC(2026, 6, 17)));
    expect(span).toBe(58);
  });

  it('elapsed-days helper stays exclusive of the start day, for durations', () => {
    const d = new Date(Date.UTC(2026, 4, 4));           // a Monday
    expect(workingDaysBetween(d, d)).toBe(0);            // opened and closed same day
    expect(workingDaysInclusive(d, d)).toBe(1);          // one day of capacity
  });
});
