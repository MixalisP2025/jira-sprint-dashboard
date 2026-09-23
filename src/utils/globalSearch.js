// Global search across the loaded Jira dataset.
//
// The point of this file is the second half of the question "where is it?". A filter
// tells you a row survives; it does not tell you which of the fifteen tabs will show
// it to you. So every result carries `locations` — the tabs that actually render this
// thing — and a `target` that takes you to one of them with the filters already set.
//
// Kept out of the component so the judgement calls — what counts as a match, what
// ranks above what, and which tabs genuinely surface each kind of thing — are
// testable and arguable rather than buried in JSX.

// ─── Field access ─────────────────────────────────────────────────────────────
// Rows arrive as raw export objects whose headers vary by export (a Jira CSV, a
// column-letter fallback, an alternate custom-field label). The dashboard already
// reads each field through a fallback chain; search reads the SAME chains, because a
// search that misses rows the Capacity tab can see is worse than no search at all.
export const FIELD_ALIASES = {
  key:        ['Issue key', 'Key'],
  summary:    ['Summary'],
  assignee:   ['Assignee', 'D'],
  sprint:     ['Sprint', 'G', 'Custom field (Sprint)', 'Sprints', 'Sprint Name'],
  project:    ['Project', 'B'],
  status:     ['Status'],
  type:       ['Issue Type'],
  priority:   ['Priority'],
  epic:       ['Epic Name'],
  labels:     ['Labels'],
  reporter:   ['Reporter'],
  components: ['Components'],
};

export function fieldOf(item, name) {
  for (const alias of FIELD_ALIASES[name] || []) {
    const v = item?.[alias];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return '';
}

// Multi-sprint issues carry a comma-separated list. A ticket in two sprints really is
// in both places, so it gets a location for each.
export function sprintsOf(item) {
  const raw = fieldOf(item, 'sprint');
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// ─── Normalisation ────────────────────────────────────────────────────────────
// Case- and accent-insensitive. The accent stripping is not decoration: this dataset
// carries Greek names and summaries, and nobody types the tonos when they are hunting
// for a ticket. "Μιχάλης" has to be findable by typing "μιχαλης".
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const isWordChar = ch => ch != null && /[\p{L}\p{N}]/u.test(ch);

// Exact beats prefix beats word-start beats mid-word. Returns 0 for no match, so a
// caller can treat the score as a boolean too.
export function scoreMatch(haystackNorm, queryNorm) {
  if (!haystackNorm || !queryNorm) return 0;
  if (haystackNorm === queryNorm) return 100;
  const i = haystackNorm.indexOf(queryNorm);
  if (i < 0) return 0;
  if (i === 0) return 70;
  return isWordChar(haystackNorm[i - 1]) ? 30 : 50;
}

// ─── Which tabs show which dimension ──────────────────────────────────────────
// A plain statement about how SprintDashboard is wired: each tab is driven by one or
// more of these dimensions. If a tab's data source changes, change it here too — this
// table is the thing that makes "where is it" an answer rather than a guess.
export const TAB_SOURCES = {
  overview:   { label: 'Overview',      dims: ['sprint'] },
  assignees:  { label: 'Assignees',     dims: ['person'] },
  risks:      { label: 'Risk Register', dims: ['sprint', 'person'] },
  capacity:   { label: 'Capacity',      dims: ['person', 'sprint'] },
  health:     { label: 'Health',        dims: ['sprint'] },
  time:       { label: 'Time Tracking', dims: ['person'] },
  team:       { label: 'Team',          dims: ['person'] },
  sprints:    { label: 'Sprints',       dims: ['sprint'] },
  projects:   { label: 'Projects',      dims: ['project'] },
  timeline:   { label: 'Timeline',      dims: ['sprint', 'project'] },
  data:       { label: 'Raw Data',      dims: ['ticket', 'sprint', 'person', 'project'] },
  allocation: { label: 'Allocation',    dims: ['person', 'sprint'] },
};

// Listed in the order above, which is the order the tabs appear on screen — so the
// "found in" chips read left-to-right the way the tab bar does.
function tabsShowing(dim) {
  return Object.entries(TAB_SOURCES)
    .filter(([, t]) => t.dims.includes(dim))
    .map(([key, t]) => ({ tab: key, label: t.label }));
}

// ─── Index ────────────────────────────────────────────────────────────────────
// Built once per dataset, not per keystroke: normalising ten fields across a few
// thousand rows on every character typed is the difference between instant and laggy.
// The index stores pre-normalised haystacks, so searching is substring work only.
//
// `extraViews` lets the caller register tabs that hold no dataset rows (the CSR tabs,
// for instance) so typing "csr" still takes you there.
export function buildSearchIndex(data, extraViews = []) {
  const rows = Array.isArray(data) ? data : [];

  const tickets = [];
  const people = new Map();
  const sprints = new Map();
  const projects = new Map();
  const statuses = new Map();

  const bump = (map, name, ticket) => {
    if (!name) return;
    let e = map.get(name);
    if (!e) {
      e = { name, count: 0, sprints: new Set(), people: new Set(), projects: new Set() };
      map.set(name, e);
    }
    e.count++;
    ticket.sprints.forEach(s => e.sprints.add(s));
    if (ticket.assignee) e.people.add(ticket.assignee);
    if (ticket.project) e.projects.add(ticket.project);
  };

  rows.forEach((item, idx) => {
    const t = {
      idx,
      key:      fieldOf(item, 'key'),
      summary:  fieldOf(item, 'summary'),
      assignee: fieldOf(item, 'assignee'),
      project:  fieldOf(item, 'project'),
      status:   fieldOf(item, 'status'),
      type:     fieldOf(item, 'type'),
      epic:     fieldOf(item, 'epic'),
      labels:   fieldOf(item, 'labels'),
      reporter: fieldOf(item, 'reporter'),
      sprints:  sprintsOf(item),
    };
    t.n = {
      key: norm(t.key), summary: norm(t.summary), assignee: norm(t.assignee),
      project: norm(t.project), status: norm(t.status), type: norm(t.type),
      epic: norm(t.epic), labels: norm(t.labels), reporter: norm(t.reporter),
      sprint: norm(t.sprints.join(' ')),
    };
    tickets.push(t);

    bump(people, t.assignee, t);
    t.sprints.forEach(s => bump(sprints, s, t));
    bump(projects, t.project, t);
    bump(statuses, t.status, t);
  });

  const finish = map => Array.from(map.values()).map(e => ({ ...e, n: norm(e.name) }));

  const views = [
    ...Object.entries(TAB_SOURCES).map(([tab, t]) => ({ tab, label: t.label })),
    ...extraViews,
  ].map(v => ({ ...v, n: norm(v.label) }));

  return {
    tickets,
    people:   finish(people),
    sprints:  finish(sprints),
    projects: finish(projects),
    statuses: finish(statuses),
    views,
  };
}

// ─── Search ───────────────────────────────────────────────────────────────────
// Field weights. A ticket key is the one thing people type when they already know
// exactly what they want, so an exact key match must outrank everything else; a hit
// in a summary is the weakest signal because summaries are long and match by accident.
const TICKET_FIELDS = [
  ['key', 3.0], ['summary', 1.0], ['assignee', 1.6], ['epic', 1.3],
  ['project', 1.2], ['sprint', 1.2], ['status', 0.9], ['type', 0.9],
  ['labels', 0.9], ['reporter', 1.1],
];

// Entity weights, on the same scale as the ticket field weights above, because the
// groups are ordered against each other by their best score. Each entity outweighs
// the ticket field that carries the same string: type a person's name and you want
// the person — who tells you every tab they appear on — not the first of their forty
// tickets. Only an exact ticket key (3.0) outranks them, because typing a key means
// you already know exactly what you want.
const ENTITY_WEIGHTS = {
  view:    2.2,   // a tab name is unambiguous: you are asking to go there
  person:  2.0,   // > assignee 1.6
  sprint:  2.0,   // > sprint 1.2
  project: 2.0,   // > project 1.2
  status:  1.0,   // barely above the ticket status field: a status is a weak intent
};

const KIND_ORDER = { view: 0, person: 1, sprint: 2, project: 3, status: 4, ticket: 5 };

// One character matches almost everything, which is noise rather than an answer.
export const MIN_QUERY = 2;

export function searchDashboard(index, query, { perGroup = 6 } = {}) {
  const q = norm(query);
  if (!index || q.length < MIN_QUERY) {
    return { query: q, groups: [], total: 0, ticketMatches: 0, matchedKeys: [] };
  }

  const groups = [];
  const push = (kind, title, items) => { if (items.length) groups.push({ kind, title, items }); };

  // Ties break on how much work sits behind the entity — the sprint with 80 tickets
  // is the one you meant before the sprint with 3.
  const rank = (list, kind) => list
    .map(e => ({ e, score: scoreMatch(e.n, q) * ENTITY_WEIGHTS[kind] }))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score || (b.e.count || 0) - (a.e.count || 0));

  // Views — typing a tab name should simply take you there.
  push('view', 'Go to', rank(index.views, 'view')
    .slice(0, perGroup)
    .map(({ e: v, score }) => ({
      kind: 'view', id: `view:${v.tab}`, title: v.label, subtitle: 'Dashboard tab',
      score, locations: [{ tab: v.tab, label: v.label }],
      target: { tab: v.tab, filters: {} },
    })));

  // People — the real answer here is "which tabs is this person on", so the
  // locations matter at least as much as the match itself.
  push('person', 'People', rank(index.people, 'person')
    .slice(0, perGroup)
    .map(({ e: p, score }) => ({
      kind: 'person', id: `person:${p.name}`, title: p.name,
      subtitle: `${p.count} ticket${p.count === 1 ? '' : 's'} across ${p.sprints.size} sprint${p.sprints.size === 1 ? '' : 's'}`,
      score, locations: tabsShowing('person'),
      target: { tab: 'assignees', filters: { assignee: p.name } },
    })));

  push('sprint', 'Sprints', rank(index.sprints, 'sprint')
    .slice(0, perGroup)
    .map(({ e: s, score }) => ({
      kind: 'sprint', id: `sprint:${s.name}`, title: s.name,
      subtitle: `${s.count} ticket${s.count === 1 ? '' : 's'} · ${s.people.size} ${s.people.size === 1 ? 'person' : 'people'}`,
      score, locations: tabsShowing('sprint'),
      target: { tab: 'sprints', filters: { sprint: s.name } },
    })));

  push('project', 'Projects', rank(index.projects, 'project')
    .slice(0, perGroup)
    .map(({ e: p, score }) => ({
      kind: 'project', id: `project:${p.name}`, title: p.name,
      subtitle: `${p.count} ticket${p.count === 1 ? '' : 's'} · ${p.sprints.size} sprint${p.sprints.size === 1 ? '' : 's'}`,
      score, locations: tabsShowing('project'),
      target: { tab: 'projects', filters: { project: p.name } },
    })));

  push('status', 'Statuses', rank(index.statuses, 'status')
    .slice(0, Math.min(perGroup, 3))
    .map(({ e: s, score }) => ({
      kind: 'status', id: `status:${s.name}`, title: s.name,
      subtitle: `${s.count} ticket${s.count === 1 ? '' : 's'} in this status`,
      score, locations: [{ tab: 'data', label: 'Raw Data' }],
      target: { tab: 'data', filters: {} },
    })));

  // Tickets — each result states where the ticket sits (sprint / person / project /
  // status). That line is what makes this a "where is it" answer and not a filter.
  const ticketHits = [];
  for (const t of index.tickets) {
    let best = 0, via = '';
    for (const [f, w] of TICKET_FIELDS) {
      const s = scoreMatch(t.n[f], q) * w;
      if (s > best) { best = s; via = f; }
    }
    if (best > 0) ticketHits.push({ t, score: best, via });
  }
  ticketHits.sort((a, b) => b.score - a.score || a.t.idx - b.t.idx);

  push('ticket', `Tickets${ticketHits.length > perGroup ? ` (${ticketHits.length})` : ''}`,
    ticketHits.slice(0, perGroup).map(({ t, score, via }) => ({
      kind: 'ticket', id: `ticket:${t.key || t.idx}`,
      title: t.key || '(no key)', subtitle: t.summary || '—',
      score, matchedField: via,
      // A ticket's location is literal: these are the coordinates that place it.
      coords: [
        t.sprints.length ? t.sprints.join(' + ') : 'Backlog',
        t.assignee || 'Unassigned',
        t.project || '—',
        t.status || '—',
      ],
      locations: tabsShowing('ticket'),
      // Every filter is cleared on the way out. Raw Data is handed the match list
      // instead (see matchedKeys), so the rows you land on are the tickets that
      // matched and nothing else. Narrowing to the ticket's own sprint and assignee
      // was the earlier approach: it kept the ticket inside Raw Data's 200-row cap,
      // but it back-filled the table with that person's other tickets, which read as
      // search results without being any. A leftover filter would also hide matches
      // outside it, and "show me every instance" has to mean every instance.
      target: {
        tab: 'data',
        filters: { sprint: 'all', assignee: 'all', project: 'all' },
        highlightKey: t.key,
      },
    })));

  // Best match first, whatever kind it is — typing a ticket key should not make you
  // scroll past three people to reach the ticket.
  groups.sort((a, b) => {
    const topA = a.items[0].score, topB = b.items[0].score;
    if (topB !== topA) return topB - topA;
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });

  return {
    query: q,
    groups,
    total: groups.reduce((n, g) => n + g.items.length, 0),
    ticketMatches: ticketHits.length,
    // EVERY matching ticket, not just the handful the dropdown has room for. This is
    // what Raw Data filters to after a jump, so the table shows the same set the
    // dropdown counted. Keyless rows are dropped: the table matches rows by key, so
    // a row without one could never be identified anyway.
    matchedKeys: ticketHits.map(h => h.t.key).filter(Boolean),
  };
}

// Flattened, in display order — the component walks this with the arrow keys.
export function flatten(groups) {
  return groups.flatMap(g => g.items);
}
