import { describe, it, expect } from 'vitest';
import { datesFromSprintName, deriveSprintDates, mergeSprintDates, getSprintName } from '../utils/sprintDates';

// The Timeline tab rendered "No Timeline Data Available" on every ordinary page load,
// because sprint dates were only ever derived on the CSV-upload and Jira-refresh paths
// while the dates sat in the sprint names of the rows already in memory. These tests
// pin the recovery, including the day-first ordering that is easy to get backwards.

describe('datesFromSprintName', () => {
  // DD-MM-YY. Reading this as month-first would silently shift every project by months.
  it('reads the dates day-first', () => {
    expect(datesFromSprintName('Sprint 23 27-04-26 to 08-05-26'))
      .toEqual({ start: '04/27/2026', end: '05/08/2026' });
  });

  // Compared in LOCAL components, not via toISOString: these strings are parsed as
  // local midnight everywhere in the dashboard, so in any timezone east of UTC the
  // UTC form is the previous day. That is existing behaviour, not a defect here.
  it('produces dates the rest of the dashboard can parse', () => {
    const d = datesFromSprintName('Sprint 12 24-11-25 to 05-12-25');
    const local = iso => { const x = new Date(iso); return [x.getFullYear(), x.getMonth() + 1, x.getDate()]; };
    expect(local(d.start)).toEqual([2025, 11, 24]);
    expect(local(d.end)).toEqual([2025, 12, 5]);
  });

  it('returns null for a name with no dates in it', () => {
    expect(datesFromSprintName('Backlog grooming')).toBeNull();
    expect(datesFromSprintName('')).toBeNull();
    expect(datesFromSprintName(null)).toBeNull();
  });

  // An Invalid Date reaching the gantt produces NaN widths and an axis stretching
  // nowhere, which looks like a rendering bug rather than bad input.
  it('rejects a name that matches the shape but is not a real date', () => {
    expect(datesFromSprintName('Sprint 9 40-13-26 to 45-99-26')).toBeNull();
  });
});

describe('getSprintName', () => {
  it('follows the same fallback chain as the rest of the dashboard', () => {
    expect(getSprintName({ G: 'Sprint 1 01-01-26 to 14-01-26' })).toBe('Sprint 1 01-01-26 to 14-01-26');
    expect(getSprintName({ 'Sprint Name': 'Sprint 2' })).toBe('Sprint 2');
    expect(getSprintName({ Sprint: ' padded ' })).toBe('padded');
    expect(getSprintName({})).toBe('');
  });
});

describe('deriveSprintDates', () => {
  const S1 = 'Sprint 1 05-01-26 to 16-01-26';
  const S2 = 'Sprint 2 19-01-26 to 30-01-26';

  it('collects every dated sprint present in the rows', () => {
    const out = deriveSprintDates([{ Sprint: S1 }, { Sprint: S2 }, { Sprint: S1 }]);
    expect(Object.keys(out).sort()).toEqual([S1, S2].sort());
  });

  // A ticket in two sprints carries one compound string; without splitting, both
  // sprints lose their dates and the projects using them drop off the timeline.
  it('splits a multi-sprint ticket so both sprints keep their dates', () => {
    const out = deriveSprintDates([{ Sprint: `${S1}, ${S2}` }]);
    expect(Object.keys(out).sort()).toEqual([S1, S2].sort());
  });

  it('ignores undated sprints without discarding the dated ones', () => {
    const out = deriveSprintDates([{ Sprint: 'No dates here' }, { Sprint: S1 }]);
    expect(Object.keys(out)).toEqual([S1]);
  });

  it('survives an empty or absent dataset', () => {
    expect(deriveSprintDates([])).toEqual({});
    expect(deriveSprintDates(null)).toEqual({});
  });
});

describe('mergeSprintDates', () => {
  const derived = { A: { start: '01/01/2026', end: '01/14/2026' }, B: { start: '02/01/2026', end: '02/14/2026' } };

  it('fills gaps without overwriting what is already known', () => {
    const existing = { A: { start: 'from/jira', end: 'from/jira' } };
    const merged = mergeSprintDates(existing, derived);
    expect(merged.A.start).toBe('from/jira');   // a Jira refresh beats a name parse
    expect(merged.B).toEqual(derived.B);
  });

  // Returning a new object when nothing changed would re-trigger the effect that
  // calls this, against its own state — a render loop.
  it('returns the same object when it adds nothing', () => {
    const existing = { ...derived };
    expect(mergeSprintDates(existing, derived)).toBe(existing);
  });

  it('copes with no existing dates at all', () => {
    expect(mergeSprintDates(undefined, derived)).toEqual(derived);
    expect(mergeSprintDates({}, derived)).toEqual(derived);
  });
});
