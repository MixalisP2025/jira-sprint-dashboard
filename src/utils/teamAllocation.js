// Availability resolver for the Team Contribution panel.
//
// The panel previously divided every contributor's story points by the full working-day
// count of the window, which made the throughput chart read largely as "who was present
// longest". This module resolves, per person per sprint:
//   · presence  — were they on the team at all that sprint?
//   · allocation — what fraction of their time was on the project in scope?
// and reports the BASIS for both, so the panel can label every derived figure and
// suppress the ones that rest on an unverified assumption.

import { workingDaysInclusive } from './workingDays';

export const ALLOC_BASIS = {
  configured:  { key: 'configured',  short: 'configured allocation',        label: 'allocation from the Allocation tab (configured)',    trusted: true },
  spShare:     { key: 'spShare',     short: 'inferred (completed-SP share)', label: 'allocation inferred from completed-SP share',        trusted: true },
  eligibility: { key: 'eligibility', short: 'inferred (eligibility)',        label: 'allocation inferred from Allocation-tab eligibility', trusted: true },
  portfolio:   { key: 'portfolio',   short: 'whole portfolio (100%)',        label: 'whole portfolio in scope — allocation is 100% by definition', trusted: true },
  assumed:     { key: 'assumed',     short: 'assumed full-time',             label: 'assumed full-time — not verified',                   trusted: false },
};

export const PRESENCE_BASIS = {
  worklog:    'presence from logged work',
  completion: 'presence from completed tickets only',
  assumed:    'presence assumed — no signal in the window',
};

const inWindow = (d, w) => d >= w.start && d <= w.end;

/**
 * @param windowSprints  [{ name, start, end }] — the completed sprints in scope
 * @param names          contributor names to resolve
 * @param worklogByKey   Map<issueKey, [{ author, started, seconds }]> | null
 * @param doneEvents     [{ name, date }] — one per completed pointed ticket, at the
 *                       assignee-at-completion and its resolution date
 * @param allocationPctOf   fn(name) -> number|null   fraction of time on the project in scope
 * @param allocationBasisOf fn(name) -> 'spShare'|'eligibility'|'portfolio'|null
 * @param configured     { [name]: fraction 0..1 } explicit per-person allocation overrides
 */
export function resolveAvailability({
  windowSprints = [],
  names = [],
  worklogByKey = null,
  doneEvents = [],
  allocationPctOf = () => null,
  allocationBasisOf = () => null,
  configured = {},
  ratedSprintNames = null,   // sprints whose data is fit to compute rates from; null = all
}) {
  // Inclusive: a sprint running Mon–Fri gives five available days, not four.
  const sprintDays = new Map(windowSprints.map(w => [w.name, workingDaysInclusive(w.start, w.end)]));
  const totalWindowDays = [...sprintDays.values()].reduce((a, b) => a + b, 0);
  const isRated = name => (ratedSprintNames ? ratedSprintNames.has(name) : true);

  // ── presence signals ────────────────────────────────────────────────────────
  // worklog presence: person authored >= 1 worklog whose `started` falls in the sprint
  const worklogPresence = new Map();  // name -> Set(sprintName)
  if (worklogByKey) {
    for (const entries of worklogByKey.values()) {
      for (const w of entries) {
        const d = w.started ? new Date(w.started) : null;
        if (!d || isNaN(d)) continue;
        const sprint = windowSprints.find(s => inWindow(d, s));
        if (!sprint) continue;
        if (!worklogPresence.has(w.author)) worklogPresence.set(w.author, new Set());
        worklogPresence.get(w.author).add(sprint.name);
      }
    }
  }
  // completion presence: assignee-at-done on a ticket that reached Done in the sprint.
  // Secondary only — on its own it circularly penalises anyone present but finishing nothing.
  const donePresence = new Map();
  for (const ev of doneEvents) {
    const d = ev.date ? new Date(ev.date) : null;
    if (!d || isNaN(d)) continue;
    const sprint = windowSprints.find(s => inWindow(d, s));
    if (!sprint) continue;
    if (!donePresence.has(ev.name)) donePresence.set(ev.name, new Set());
    donePresence.get(ev.name).add(sprint.name);
  }

  const haveWorklogs = !!worklogByKey && worklogPresence.size > 0;

  const out = new Map();
  for (const name of names) {
    const wlSet = worklogPresence.get(name) || new Set();
    const dnSet = donePresence.get(name) || new Set();
    const anySignal = wlSet.size > 0 || dnSet.size > 0;

    // ── allocation fraction + its basis ──
    let allocPct, basisKey;
    const cfg = configured?.[name];
    if (Number.isFinite(cfg) && cfg > 0) {
      allocPct = Math.min(cfg, 1); basisKey = 'configured';
    } else {
      const inferred = allocationPctOf(name);
      const inferredBasis = allocationBasisOf(name);
      if (Number.isFinite(inferred) && inferred > 0 && inferredBasis) {
        allocPct = Math.min(inferred, 1); basisKey = inferredBasis;
      } else {
        allocPct = 1; basisKey = 'assumed';
      }
    }

    // ── per-sprint presence + days ──
    const perSprint = windowSprints.map(w => {
      const days = sprintDays.get(w.name) || 0;
      let present, via;
      if (!haveWorklogs && !anySignal) { present = true; via = 'assumed'; }
      else if (wlSet.has(w.name))      { present = true; via = 'worklog'; }
      else if (dnSet.has(w.name))      { present = true; via = 'completion'; }
      else if (!anySignal)             { present = true; via = 'assumed'; }
      else                             { present = false; via = null; }
      const rated = isRated(w.name);
      return {
        sprint: w.name, present, via, rated, workingDays: days,
        // days only count toward the denominator when the person was there AND the
        // sprint's data is fit to compute a rate from
        availableDays: (present && rated) ? days * allocPct : 0,
        presentDays: present ? days * allocPct : 0,
      };
    });

    const presentSprints = perSprint.filter(s => s.present);
    const availableDays = perSprint.reduce((a, s) => a + s.availableDays, 0);
    const presenceInferred = anySignal;
    const presenceBasisKey = !presenceInferred ? 'assumed'
      : (presentSprints.some(s => s.via === 'worklog') ? 'worklog' : 'completion');

    // Presence resting only on completed tickets is weak — it cannot distinguish
    // "was away" from "was here and finished nothing".
    const completionOnlySprints = presentSprints.filter(s => s.via === 'completion').length;

    // A person whose allocation is a bare assumption cannot support a normalised rate.
    const trusted = ALLOC_BASIS[basisKey].trusted && presenceInferred;

    out.set(name, {
      name, allocPct, allocBasis: basisKey, presenceBasis: presenceBasisKey,
      perSprint, presentSprintNames: presentSprints.map(s => s.sprint),
      presentCount: presentSprints.length, sprintCount: windowSprints.length,
      absentCount: windowSprints.length - presentSprints.length,
      completionOnlySprints,
      availableDays,
      fullWindowDays: totalWindowDays,
      presenceInferred,
      trusted,
      basisLabel: buildBasisLabel(basisKey, presenceBasisKey, presentSprints.length, windowSprints.length),
    });
  }
  return { byName: out, totalWindowDays, sprintDays };
}

export function buildBasisLabel(allocBasisKey, presenceBasisKey, present, total) {
  const a = ALLOC_BASIS[allocBasisKey]?.label || allocBasisKey;
  const p = presenceBasisKey === 'assumed'
    ? 'present for the whole window (assumed — no worklog or completion in it)'
    : `present in ${present} of ${total} sprints (${presenceBasisKey === 'worklog' ? 'from logged work' : 'from completed tickets only'})`;
  return `${a}; ${p}`;
}

/**
 * Share of each sprint's completed work that carried a story point at all.
 * A sprint where most completed tickets were never pointed cannot support a
 * points-per-day rate: the delivery was real, the measurement of it was not. Including
 * such a sprint reports a change in pointing practice as a change in delivery.
 *
 * @param items [{ sprint, done, pointed }] — one per completed ticket in scope
 * @param sprintNames ordered sprint names in the window
 * @param threshold minimum coverage for a sprint to feed the rates (0..1)
 */
export function computePointingCoverage(items = [], sprintNames = [], threshold = 0.7, labelOf = s => s) {
  const tally = new Map(sprintNames.map(n => [n, { all: 0, pointed: 0 }]));
  for (const it of items) {
    const bucket = it.sprint && tally.get(it.sprint);
    if (!bucket) continue;
    bucket.all += 1;
    if (it.pointed) bucket.pointed += 1;
  }
  const bySprint = {};
  for (const [name, v] of tally) bySprint[name] = { ...v, coverage: v.all > 0 ? v.pointed / v.all : null };
  const ratedNames = new Set(sprintNames.filter(n => {
    const c = bySprint[n]?.coverage;
    return c != null && c >= threshold;
  }));
  const excluded = sprintNames.filter(n => !ratedNames.has(n)).map(n => ({ name: n, label: labelOf(n), ...bySprint[n] }));
  const lowButIncluded = sprintNames
    .filter(n => ratedNames.has(n) && bySprint[n].coverage < 0.9)
    .map(n => ({ name: n, label: labelOf(n), ...bySprint[n] }));
  return { bySprint, ratedNames, excluded, lowButIncluded, threshold };
}

/**
 * Accounts that completed nothing and carry no points over the window are very likely
 * service accounts or bots. Surfaced for confirmation — never dropped silently.
 */
export function detectServiceAccountCandidates(rows, confirmed = []) {
  const already = new Set(confirmed);
  return rows
    .filter(r => !already.has(r.name) && r.tickets === 0 && (r.sp || 0) === 0)
    .map(r => ({ name: r.name, hours: r.hours ?? null, worklogCount: r.worklogCount ?? 0, sprintsActive: r.sprintsActive ?? 0 }));
}

export const SERVICE_ACCOUNTS_KEY = 'tt_serviceAccounts';
export const ALLOCATION_OVERRIDES_KEY = 'tt_allocationOverrides';
export const DISMISSED_CANDIDATES_KEY = 'tt_serviceAccountDismissed';
const SERVICE_ACCOUNTS_SEEDED_KEY = 'tt_serviceAccountsSeeded';

// Not people. "Unassigned" in particular is a queue, and counting it as a contributor
// gives it a full person's capacity and dumps the whole unassigned backlog into the
// team's work-in-progress distribution.
export const DEFAULT_SERVICE_ACCOUNTS = ['Unassigned'];

/**
 * Load the exclusion list, folding in the built-in defaults exactly once so an existing
 * saved list picks them up without overriding a deliberate decision to un-exclude later.
 */
export function loadServiceAccounts() {
  const saved = loadJson(SERVICE_ACCOUNTS_KEY, null);
  if (saved == null) {
    // Mark as seeded here too, or removing "Unassigned" later saves [] and the next load
    // folds the default straight back in.
    saveJson(SERVICE_ACCOUNTS_KEY, DEFAULT_SERVICE_ACCOUNTS);
    try { localStorage.setItem(SERVICE_ACCOUNTS_SEEDED_KEY, '1'); } catch { /* private mode */ }
    return [...DEFAULT_SERVICE_ACCOUNTS];
  }
  let seeded = false;
  try { seeded = localStorage.getItem(SERVICE_ACCOUNTS_SEEDED_KEY) === '1'; } catch { /* private mode */ }
  if (seeded) return saved;
  const merged = [...new Set([...saved, ...DEFAULT_SERVICE_ACCOUNTS])];
  saveJson(SERVICE_ACCOUNTS_KEY, merged);
  try { localStorage.setItem(SERVICE_ACCOUNTS_SEEDED_KEY, '1'); } catch { /* private mode */ }
  return merged;
}

/**
 * Allocation overrides are stored per project scope: { [scope]: { [name]: fraction } },
 * where scope is a project key or 'all'. Someone at 50% on one project is not at 50% on
 * another, nor on the whole portfolio. The old flat { [name]: fraction } format applied
 * one value everywhere; its entries are ignored rather than guessed onto a project.
 */
export function overridesForScope(stored, scope) {
  const v = stored && typeof stored === 'object' ? stored[scope] : null;
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}
export function withScopeOverrides(stored, scope, overrides) {
  const next = {};
  for (const [k, v] of Object.entries(stored && typeof stored === 'object' ? stored : {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) next[k] = v;   // drop legacy flat entries
  }
  next[scope] = overrides || {};
  return next;
}

export function loadJson(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
  catch { return fallback; }
}
export function saveJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}
