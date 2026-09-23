import { describe, it, expect } from 'vitest';
import {
  fieldOf, sprintsOf, norm, scoreMatch,
  buildSearchIndex, searchDashboard, flatten, TAB_SOURCES,
} from '../utils/globalSearch';

// The thing worth testing here is not "does includes() work" but the promises the
// search makes: it reads the same field fallbacks the rest of the dashboard reads,
// it ranks the thing you meant above the thing that matched by accident, and the
// place it sends you actually contains what it said it contained.

const row = (over = {}) => ({
  'Issue key': 'PROJ-1',
  Summary: 'Fix the login redirect',
  Assignee: 'Anna Papadopoulou',
  Project: 'Payments',
  Status: 'In Progress',
  'Issue Type': 'Bug',
  Sprint: 'Sprint 12 (01-02-26 to 14-02-26)',
  ...over,
});

const index = (rows) => buildSearchIndex(rows);
const find = (res, kind) => res.groups.find(g => g.kind === kind);

describe('field access follows the dashboard fallback chains', () => {
  it('reads the column-letter fallbacks the parser can emit', () => {
    const r = { D: 'Nikos Georgiou', B: 'Core', G: 'Sprint 9' };
    expect(fieldOf(r, 'assignee')).toBe('Nikos Georgiou');
    expect(fieldOf(r, 'project')).toBe('Core');
    expect(sprintsOf(r)).toEqual(['Sprint 9']);
  });

  it('prefers the canonical header over the fallback', () => {
    expect(fieldOf({ Assignee: 'Real', D: 'Fallback' }, 'assignee')).toBe('Real');
  });

  it('treats a whitespace-only value as absent, like the dashboard does', () => {
    expect(fieldOf({ Assignee: '   ', D: 'Fallback' }, 'assignee')).toBe('Fallback');
    expect(sprintsOf({ Sprint: '  ' })).toEqual([]);
  });

  it('splits a multi-sprint ticket into every sprint it is in', () => {
    expect(sprintsOf({ Sprint: 'Sprint 11, Sprint 12 ' })).toEqual(['Sprint 11', 'Sprint 12']);
  });
});

describe('normalisation', () => {
  it('ignores case', () => {
    expect(norm('PROJ-1')).toBe('proj-1');
  });

  // The dataset carries Greek names and nobody types the tonos while searching.
  it('ignores accents, including Greek ones', () => {
    expect(norm('Μιχάλης')).toBe(norm('ΜΙΧΑΛΗΣ'.toLowerCase().replace('ά', 'α')));
    expect(norm('Μιχάλης')).toBe('μιχαλης');
    expect(norm('Ανδρέας')).toBe('ανδρεας');
  });
});

describe('scoreMatch ranking', () => {
  it('ranks exact above prefix above word-start above mid-word', () => {
    const exact = scoreMatch('bug', 'bug');
    const prefix = scoreMatch('bugfix', 'bug');
    const wordStart = scoreMatch('a bug here', 'bug');
    const midWord = scoreMatch('debugger', 'bug');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(midWord);
    expect(midWord).toBeGreaterThan(0);
  });

  it('returns 0 for no match and for an empty query', () => {
    expect(scoreMatch('bugfix', 'zzz')).toBe(0);
    expect(scoreMatch('bugfix', '')).toBe(0);
    expect(scoreMatch('', 'bug')).toBe(0);
  });
});

describe('index building', () => {
  it('counts a multi-sprint ticket under each of its sprints', () => {
    const idx = index([row({ Sprint: 'Sprint 11, Sprint 12' })]);
    expect(idx.sprints.map(s => s.name).sort()).toEqual(['Sprint 11', 'Sprint 12']);
    expect(idx.sprints.every(s => s.count === 1)).toBe(true);
  });

  it('aggregates a person across sprints', () => {
    const idx = index([
      row({ Sprint: 'Sprint 11' }),
      row({ 'Issue key': 'PROJ-2', Sprint: 'Sprint 12' }),
    ]);
    const anna = idx.people.find(p => p.name === 'Anna Papadopoulou');
    expect(anna.count).toBe(2);
    expect(anna.sprints.size).toBe(2);
  });

  it('survives an empty or absent dataset', () => {
    expect(() => buildSearchIndex(undefined)).not.toThrow();
    expect(buildSearchIndex(null).tickets).toEqual([]);
    expect(searchDashboard(buildSearchIndex([]), 'anything').total).toBe(0);
  });

  it('does not invent a person, sprint or project from blank fields', () => {
    const idx = index([row({ Assignee: '', D: '', Project: '', B: '', Sprint: '' })]);
    expect(idx.people).toEqual([]);
    expect(idx.projects).toEqual([]);
    expect(idx.sprints).toEqual([]);
  });
});

describe('searchDashboard', () => {
  const rows = [
    row(),
    row({ 'Issue key': 'PROJ-2', Summary: 'Anna asked for a payments report', Assignee: 'Nikos Georgiou' }),
    row({ 'Issue key': 'PROJ-3', Summary: 'Debug the payments queue', Assignee: 'Nikos Georgiou', Status: 'Done' }),
  ];
  const idx = index(rows);

  it('stays quiet on a one-character query rather than matching everything', () => {
    expect(searchDashboard(idx, 'a').total).toBe(0);
    expect(searchDashboard(idx, '').total).toBe(0);
  });

  it('puts an exact ticket key first overall, not behind the people who match it', () => {
    const res = searchDashboard(idx, 'PROJ-2');
    expect(flatten(res.groups)[0].title).toBe('PROJ-2');
  });

  it('finds a person and says which tabs show them', () => {
    const hit = find(searchDashboard(idx, 'nikos'), 'person').items[0];
    expect(hit.title).toBe('Nikos Georgiou');
    const tabs = hit.locations.map(l => l.tab);
    expect(tabs).toContain('capacity');
    expect(tabs).toContain('team');
    // Every tab it claims must actually be driven by the person dimension.
    tabs.forEach(t => expect(TAB_SOURCES[t].dims).toContain('person'));
  });

  it('ranks a person above a ticket that merely mentions their name in the summary', () => {
    const flat = flatten(searchDashboard(idx, 'anna').groups);
    const personAt = flat.findIndex(r => r.kind === 'person');
    const ticketAt = flat.findIndex(r => r.kind === 'ticket' && r.title === 'PROJ-2');
    expect(personAt).toBeGreaterThanOrEqual(0);
    expect(ticketAt).toBeGreaterThan(personAt);
  });

  it('matches a tab by name so search doubles as navigation', () => {
    const hit = find(searchDashboard(idx, 'capacity'), 'view').items[0];
    expect(hit.target.tab).toBe('capacity');
    expect(hit.target.filters).toEqual({});
  });

  it('gives every ticket result the coordinates that place it', () => {
    const hit = find(searchDashboard(idx, 'PROJ-1'), 'ticket').items[0];
    expect(hit.coords).toEqual([
      'Sprint 12 (01-02-26 to 14-02-26)',
      'Anna Papadopoulou',
      'Payments',
      'In Progress',
    ]);
  });

  it('labels an unsprinted, unassigned ticket honestly instead of leaving blanks', () => {
    const hit = find(searchDashboard(index([row({ Sprint: '', Assignee: '' })]), 'PROJ-1'), 'ticket').items[0];
    expect(hit.coords[0]).toBe('Backlog');
    expect(hit.coords[1]).toBe('Unassigned');
  });

  // Raw Data is handed the match list instead of a narrowed filter. A leftover filter
  // would hide matches outside it, and back-fill the table with non-matching rows that
  // read as results.
  it('clears every filter on a ticket jump', () => {
    const hit = find(searchDashboard(idx, 'PROJ-1'), 'ticket').items[0];
    expect(hit.target).toEqual({
      tab: 'data',
      filters: { sprint: 'all', assignee: 'all', project: 'all' },
      highlightKey: 'PROJ-1',
    });
  });

  it('carries every matching key, not just the ones the dropdown shows', () => {
    const many = index(Array.from({ length: 30 }, (_, i) =>
      row({ 'Issue key': `PAY-${i}`, Summary: 'payments work' })));
    const res = searchDashboard(many, 'payments work');
    expect(find(res, 'ticket').items.length).toBe(6);
    expect(res.matchedKeys.length).toBe(30);
    expect(res.matchedKeys).toContain('PAY-29');
  });

  // The real report: "55" must not drag in CC-40 just because they share an assignee.
  it('matches only the tickets that match, not their neighbours', () => {
    const neighbours = index([
      row({ 'Issue key': 'CC-55', Summary: 'a' }),
      row({ 'Issue key': 'CC-40', Summary: 'b' }),
      row({ 'Issue key': 'CC-45', Summary: 'c' }),
    ]);
    expect(searchDashboard(neighbours, '55').matchedKeys).toEqual(['CC-55']);
  });

  it('matches a number anywhere in a key, so 55 also finds CC-155', () => {
    const wide = index([
      row({ 'Issue key': 'CC-55' }),
      row({ 'Issue key': 'CC-155' }),
      row({ 'Issue key': 'CC-40' }),
    ]);
    const keys = searchDashboard(wide, '55').matchedKeys;
    expect(keys).toContain('CC-55');
    expect(keys).toContain('CC-155');
    expect(keys).not.toContain('CC-40');
    // The exact-ish key still leads.
    expect(keys[0]).toBe('CC-55');
  });

  it('reports no matched keys when nothing matches or the query is too short', () => {
    expect(searchDashboard(idx, 'zzzzz').matchedKeys).toEqual([]);
    expect(searchDashboard(idx, 'a').matchedKeys).toEqual([]);
  });

  // The dataset really does hold the same key twice (COGP-1259). matchedKeys counts
  // rows so the banner agrees with the table, which renders both of them.
  it('keeps one entry per matching row, even when a key is duplicated', () => {
    const dupes = index([
      row({ 'Issue key': 'COGP-1259', Summary: 'first copy' }),
      row({ 'Issue key': 'COGP-1259', Summary: 'second copy' }),
      row({ 'Issue key': 'COGP-1260' }),
    ]);
    const res = searchDashboard(dupes, 'COGP-1259');
    expect(res.matchedKeys).toEqual(['COGP-1259', 'COGP-1259']);
    expect(res.matchedKeys.length).toBe(res.ticketMatches);
    expect(new Set(res.matchedKeys).size).toBe(1);
  });

  it('drops keyless rows from the match set, since the table identifies rows by key', () => {
    const keyless = index([{ Summary: 'payments work', Assignee: 'Anna Papadopoulou' }]);
    const res = searchDashboard(keyless, 'payments');
    expect(res.ticketMatches).toBe(1);
    expect(res.matchedKeys).toEqual([]);
  });

  it('reports the full ticket match count even though it shows only a page of them', () => {
    const many = index(Array.from({ length: 30 }, (_, i) =>
      row({ 'Issue key': `PAY-${i}`, Summary: 'payments work' })));
    const res = searchDashboard(many, 'payments work');
    expect(res.ticketMatches).toBe(30);
    expect(find(res, 'ticket').items.length).toBe(6);
  });

  it('finds Greek text typed without accents', () => {
    const greek = index([row({ Assignee: 'Μιχάλης Περβόλια' })]);
    expect(find(searchDashboard(greek, 'μιχαλης'), 'person').items[0].title).toBe('Μιχάλης Περβόλια');
  });

  it('returns nothing for a query that matches nothing, without throwing', () => {
    const res = searchDashboard(idx, 'zzzzz');
    expect(res.total).toBe(0);
    expect(res.groups).toEqual([]);
  });
});

describe('TAB_SOURCES is a truthful map of the dashboard', () => {
  it('gives every tab at least one dimension', () => {
    Object.entries(TAB_SOURCES).forEach(([, t]) => {
      expect(t.dims.length).toBeGreaterThan(0);
      expect(t.label).toBeTruthy();
    });
  });

  it('routes ticket results only to a tab that renders individual tickets', () => {
    const idx = index([row()]);
    find(searchDashboard(idx, 'PROJ-1'), 'ticket').items[0].locations
      .forEach(l => expect(TAB_SOURCES[l.tab].dims).toContain('ticket'));
  });
});
