import React, { useMemo, useState, useEffect } from 'react';
import {
  BarChart, Bar, ScatterChart, Scatter, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell, ErrorBar, Legend, LabelList,
} from 'recharts';
import { Users, AlertTriangle, Microscope, Mail, SlidersHorizontal, Bot, ChevronDown, ChevronRight } from 'lucide-react';
import { jiraService } from '../utils/jiraService';
import { loadEligibilityFromDB, pingDB } from '../utils/dbSync';
import TeamReportEmailModal from './TeamReportEmailModal';
import TeamAllocationEditor from './TeamAllocationEditor';
import ExecutiveSummaryView from './ExecutiveSummaryView';
import TeamDailyNote from './TeamDailyNote';
import TeamQueueTab from './TeamQueueTab';
import TeamMethodology from './TeamMethodology';
import { computeDailyNote, findCurrentSprint, loadBaseline, saveSnapshot, loadStallDays, saveStallDays, buildDailyNoteText } from '../utils/teamDaily';
import { workingDaysInclusive, zonedDayKey } from '../utils/workingDays';
import {
  resolveAvailability, detectServiceAccountCandidates, computePointingCoverage, ALLOC_BASIS, loadServiceAccounts,
  SERVICE_ACCOUNTS_KEY, ALLOCATION_OVERRIDES_KEY, DISMISSED_CANDIDATES_KEY, loadJson, saveJson,
  overridesForScope, withScopeOverrides,
} from '../utils/teamAllocation';
import { copyPlain } from '../utils/teamReport';
import TeamBySprintView from './TeamBySprintView';
import TeamOverview from './TeamOverview';

import {
  getStatus, getSP, getSprint, getAssignee, getProject, getKey, getType, getLoggedSec,
  getResolved, getCreated, ALLOWED_TYPES, isDone, isTodoName,
  f1, f2, pctI, parseSprintDates, shortSprint, deriveChangelog, computeTeam,
} from '../utils/teamEngine';

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return <div className="tt-print-card" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 22px', marginBottom: 16, ...style }}>{children}</div>;
}
function CardHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
      <div><div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>{title}</div>{subtitle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{subtitle}</div>}</div>
      {right}
    </div>
  );
}
function Banner({ color, icon, children }) {
  return <div className="tt-print-banner" style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 14px', background: `${color}12`, border: `1px solid ${color}40`, borderRadius: 10, marginBottom: 14, fontSize: 12.5, color: '#e2e8f0', lineHeight: 1.55 }}><span style={{ color, flexShrink: 0, marginTop: 1 }}>{icon}</span><div>{children}</div></div>;
}
function KpiTile({ label, value, sub, color = '#60a5fa' }) {
  return <div style={{ flex: '1 1 170px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '15px 17px' }}><div style={{ color: '#6b7280', fontSize: 12, marginBottom: 7 }}>{label}</div><div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>{sub && <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}</div>;
}
const TOOLTIP_STYLE = { contentStyle: { background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }, labelStyle: { color: '#e2e8f0' }, itemStyle: { color: '#94a3b8' } };
const btnGhost = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#94a3b8' };
const thL = { textAlign: 'left', padding: '7px 9px', fontWeight: 600, whiteSpace: 'nowrap' };
const thR = { textAlign: 'right', padding: '7px 9px', fontWeight: 600, whiteSpace: 'nowrap' };
const tdL = { textAlign: 'left', padding: '8px 9px' };
const tdR = { textAlign: 'right', padding: '8px 9px', fontVariantNumeric: 'tabular-nums' };
const SIZE_COLORS = { Small: '#60a5fa', Medium: '#a855f7', Large: '#f59e0b' };
// Pinned Contributor column — opaque backgrounds so scrolling metric columns pass underneath.
const STICKY_HEAD = { position: 'sticky', left: 0, zIndex: 3, background: '#111a2c' };
const STICKY_CELL = { position: 'sticky', left: 0, zIndex: 2, background: '#111a2c', boxShadow: '1px 0 0 rgba(255,255,255,0.06)' };

// Inline size-mix stacked bar
function SizeMix({ mix }) {
  const total = mix.Small + mix.Medium + mix.Large || 1;
  return (
    <div style={{ display: 'flex', height: 12, width: 120, borderRadius: 3, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }} title={`Small ${mix.Small} · Medium ${mix.Medium} · Large ${mix.Large}`}>
      {['Small', 'Medium', 'Large'].map(k => mix[k] > 0 ? <div key={k} style={{ width: `${(mix[k] / total) * 100}%`, background: SIZE_COLORS[k] }} /> : null)}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function TeamContributionTab({ tickets = [], selectedProject = 'all' }) {
  const today = useMemo(() => new Date(), []);
  const [windowN, setWindowN] = useState(() => { const v = parseInt(localStorage.getItem('tt_windowN'), 10); return [3, 6, 12].includes(v) ? v : 6; });
  const [hoursPerDay, setHoursPerDay] = useState(() => { const v = parseFloat(localStorage.getItem('tt_hoursPerDay')); return Number.isFinite(v) && v > 0 ? v : 8; });
  // Minimum share of completed tickets that must carry a story point for a sprint's rate
  // to mean anything. Below this the sprint is excluded from every rate calculation.
  // 0 is a real choice ("Off — include every sprint"), so it must survive a reload.
  const [coverageMin, setCoverageMin] = useState(() => { const v = parseFloat(localStorage.getItem('tt_coverageMin')); return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.7; });
  const [sortCol, setSortCol] = useState('name');   // default alphabetical — NOT a metric
  const [sortDir, setSortDir] = useState('asc');
  const [splitByHours, setSplitByHours] = useState(false); // section 2 toggle (contaminated)
  const [wl, setWl] = useState({ status: 'idle', byKey: null });
  const [cl, setCl] = useState({ status: 'idle', byKey: null });
  const [showEmail, setShowEmail] = useState(false);
  const [showAlloc, setShowAlloc] = useState(false);
  // Opens on the plain-English overview; the dense panels stay one click away.
  const [view, setView] = useState('overview'); // overview | daily | analyst | sprint | queue | exec | method
  const [showAllCols, setShowAllCols] = useState(false);
  const [stallDays, setStallDays] = useState(() => loadStallDays());
  const [notesOpen, setNotesOpen] = useState(false);

  // Excluded service/bot accounts and explicit per-person allocation, both persisted.
  const [serviceAccounts, setServiceAccounts] = useState(() => loadServiceAccounts());
  // Allocation is per project scope — see overridesForScope.
  const [allocOverridesStored, setAllocOverridesStored] = useState(() => loadJson(ALLOCATION_OVERRIDES_KEY, {}));
  const allocOverrides = useMemo(() => overridesForScope(allocOverridesStored, selectedProject), [allocOverridesStored, selectedProject]);
  const [dismissedCandidates, setDismissedCandidates] = useState(() => loadJson(DISMISSED_CANDIDATES_KEY, []));
  const persistServiceAccounts = v => { setServiceAccounts(v); saveJson(SERVICE_ACCOUNTS_KEY, v); };
  const persistAllocOverrides = v => {
    const next = withScopeOverrides(allocOverridesStored, selectedProject, v);
    setAllocOverridesStored(next); saveJson(ALLOCATION_OVERRIDES_KEY, next);
  };
  const persistDismissed = v => { setDismissedCandidates(v); saveJson(DISMISSED_CANDIDATES_KEY, v); };

  const [eligibility, setEligibility] = useState(() => { try { const raw = localStorage.getItem('assigneeEligibility'); return raw ? JSON.parse(raw) : {}; } catch { return {}; } });
  useEffect(() => { let cancelled = false; (async () => { try { if (await pingDB()) { const db = await loadEligibilityFromDB(); if (db && Object.keys(db).length && !cancelled) setEligibility(db); } } catch { /* offline */ } })(); return () => { cancelled = true; }; }, []);

  const setWindow = n => { setWindowN(n); localStorage.setItem('tt_windowN', String(n)); };

  // Project-scope only (ignore sprint + assignee filters — this is a team view)
  const scoped = useMemo(() => (selectedProject === 'all' ? tickets : tickets.filter(t => getProject(t) === selectedProject)), [tickets, selectedProject]);

  // ── Window (last N completed sprints) from sprint metadata ──
  const windowInfo = useMemo(() => {
    const winMap = new Map();
    for (const t of scoped) {
      const raw = t._rawFields || {}; const arr = raw.customfield_10010 || raw.sprint;
      const consider = (nm, sp) => {
        if (!nm || winMap.has(nm)) return;
        let start = null, end = null, state = null;
        if (sp && typeof sp === 'object') { state = sp.state ? String(sp.state).toLowerCase() : null; if (sp.startDate) start = new Date(sp.startDate); if (sp.endDate) end = new Date(sp.endDate); if ((!end || isNaN(end)) && sp.completeDate) end = new Date(sp.completeDate); }
        if (!start || !end || isNaN(start) || isNaN(end)) { const d = parseSprintDates(nm); if (d) { if (!start || isNaN(start)) start = d.start; if (!end || isNaN(end)) end = d.end; } }
        if (start && end && !isNaN(start) && !isNaN(end)) winMap.set(nm, { name: nm, start, end, state });
      };
      if (Array.isArray(arr)) arr.forEach(sp => consider(typeof sp === 'string' ? sp : sp?.name, sp)); else consider(getSprint(t), null);
    }
    const windows = [...winMap.values()];
    const isCompleted = w => (w.state ? w.state === 'closed' : w.end < today);
    const completed = windows.filter(isCompleted).sort((a, b) => a.start - b.start);
    const windowSprints = completed.slice(-windowN);
    const windowSet = new Set(windowSprints.map(w => w.name));
    const windowStart = windowSprints.length ? windowSprints.reduce((m, w) => w.start < m ? w.start : m, windowSprints[0].start) : null;
    const windowEnd = windowSprints.length ? windowSprints.reduce((m, w) => w.end > m ? w.end : m, windowSprints[0].end) : null;
    // Inclusive — a sprint's first day is a working day. Using the elapsed-days helper here
    // silently dropped one day per sprint and inflated every rate by ~10%.
    const workingDaysInWindow = windowSprints.reduce((a, w) => a + workingDaysInclusive(w.start, w.end), 0);
    const windowFor = date => { const d = new Date(date); if (isNaN(d)) return null; const w = windows.find(x => d >= x.start && d <= x.end); return w ? w.name : null; };
    return { windows, completed, windowSprints, windowSet, windowStart, windowEnd, workingDaysInWindow, isCompleted, windowFor };
  }, [scoped, windowN, today]);

  const { windowSprints, windowSet, windowStart, windowEnd, workingDaysInWindow, isCompleted, completed, windowFor } = windowInfo;

  // Resolution-date attribution to a completed window sprint
  const attrSprintOf = useMemo(() => t => {
    const rd = getResolved(t); const d = rd ? new Date(rd) : null;
    if (d && !isNaN(d)) {
      const c = windowInfo.windows.find(w => d >= w.start && d <= w.end);
      if (c) return isCompleted(c) ? c.name : null;
      let best = null; for (const w of completed) if (w.end <= d && (!best || w.end > best.end)) best = w;
      return best ? best.name : null;
    }
    const nm = getSprint(t); const w = windowInfo.windows.find(x => x.name === nm);
    return w && isCompleted(w) ? nm : null;
  }, [windowInfo, isCompleted, completed]);

  // ── Pointing coverage: what share of completed work carried a story point at all ──
  // A sprint where most completed tickets were never pointed cannot produce an honest
  // points-per-day rate — the delivery is real, the measurement is not.
  const coverage = useMemo(() => {
    const allow = new Set(ALLOWED_TYPES);
    const items = [];
    for (const t of scoped) {
      const type = getType(t).toLowerCase();
      if (type === 'epic' || !allow.has(type)) continue;
      if (!isDone(getStatus(t))) continue;
      items.push({ sprint: attrSprintOf(t), pointed: getSP(t) > 0 });
    }
    return computePointingCoverage(items, windowSprints.map(w => w.name), coverageMin, shortSprint);
  }, [scoped, windowSprints, attrSprintOf, coverageMin]);

  // ── Completed pointed tickets credited to the window; and hours-bearing tickets ──
  const { completedTickets, worklogKeys } = useMemo(() => {
    const allow = new Set(ALLOWED_TYPES);
    const completedTickets = scoped.filter(t => {
      const type = getType(t).toLowerCase();
      if (type === 'epic' || !allow.has(type)) return false;
      if (!isDone(getStatus(t)) || getSP(t) <= 0) return false;
      const s = attrSprintOf(t);
      // excluded sprints leave the rate calculations entirely, on both sides
      return windowSet.has(s) && coverage.ratedNames.has(s);
    });
    // hours: any ticket in scope with logged time updated within/after the window span
    const worklogKeys = new Set(completedTickets.map(getKey));
    if (windowStart) for (const t of scoped) {
      if (getLoggedSec(t) <= 0) continue;
      const u = t['Updated'] ? new Date(t['Updated']) : null;
      if (!u || isNaN(u) || u >= windowStart) worklogKeys.add(getKey(t));
    }
    return { completedTickets, worklogKeys: [...worklogKeys].filter(Boolean) };
  }, [scoped, windowSet, attrSprintOf, windowStart, coverage.ratedNames]);

  // Auto-load worklogs (hours attribution is core to this panel)
  const worklogKeyStr = worklogKeys.join(',');
  useEffect(() => {
    if (!worklogKeys.length) { setWl({ status: 'idle', byKey: null }); return; }
    let cancelled = false;
    setWl(s => ({ ...s, status: 'loading' }));
    (async () => {
      try {
        const res = await jiraService.getWorklogs(worklogKeys);
        if (cancelled) return;
        const byKey = new Map();
        for (const w of res.worklogs) { if (!byKey.has(w.issueKey)) byKey.set(w.issueKey, []); byKey.get(w.issueKey).push(w); }
        setWl({ status: 'loaded', byKey, errorsCount: res.errors?.length || 0 });
      } catch (e) { if (!cancelled) setWl({ status: 'error', byKey: null, error: e.message }); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worklogKeyStr]);

  // Auto-load change history for the completed tickets (exact assignee-at-done, cycle, reopen, blocked)
  const completedKeyStr = completedTickets.map(getKey).join(',');
  useEffect(() => {
    const keys = completedTickets.map(getKey).filter(Boolean);
    if (!keys.length) { setCl({ status: 'idle', byKey: null }); return; }
    let cancelled = false;
    setCl(s => ({ ...s, status: 'loading' }));
    (async () => {
      try {
        const res = await jiraService.getChangelogs(keys);
        if (cancelled) return;
        const byKey = new Map();
        for (const c of res.changelogs) byKey.set(c.key, c);
        setCl({ status: 'loaded', byKey, errorsCount: res.errors?.length || 0 });
      } catch (e) { if (!cancelled) setCl({ status: 'error', byKey: null, error: e.message }); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedKeyStr]);

  // Allocation fraction: windowed completed-SP share on the project (logging-immune)
  // → eligibility fallback → unknown. The explicit per-person override takes precedence
  // over both and is applied inside resolveAvailability.
  const { allocationPctOf, allocationBasisOf } = useMemo(() => {
    const allow = new Set(ALLOWED_TYPES);
    const totalByName = {}, projByName = {};
    if (selectedProject !== 'all' && windowStart && windowEnd) {
      for (const t of tickets) {
        if (!isDone(getStatus(t))) continue; const sp = getSP(t); if (sp <= 0) continue;
        const type = getType(t).toLowerCase(); if (type === 'epic' || !allow.has(type)) continue;
        const rd = getResolved(t); const d = rd ? new Date(rd) : null; if (!d || isNaN(d) || d < windowStart || d > windowEnd) continue;
        const name = getAssignee(t); totalByName[name] = (totalByName[name] || 0) + sp;
        if (getProject(t) === selectedProject) projByName[name] = (projByName[name] || 0) + sp;
      }
    }
    const basisOf = name => {
      if (selectedProject === 'all') return 'portfolio';
      const tp = totalByName[name] || 0, pp = projByName[name] || 0;
      if (tp > 0 && pp > 0) return 'spShare';
      const elig = eligibility[name];
      if (elig && elig.length) return 'eligibility';
      return null;
    };
    const pctOf = name => {
      if (selectedProject === 'all') return 1;
      const tp = totalByName[name] || 0, pp = projByName[name] || 0;
      if (tp > 0 && pp > 0) return pp / tp;
      const elig = eligibility[name];
      if (elig && elig.length) return 1 / (elig.includes(selectedProject) ? elig.length : elig.length + 1);
      return null;
    };
    return { allocationPctOf: pctOf, allocationBasisOf: basisOf };
  }, [tickets, selectedProject, windowStart, windowEnd, eligibility]);

  // ── Daily note: the sprint in flight, and its own worklogs + change history ──
  // Kept entirely separate from the window machinery above — this is today's operational
  // read, not a trailing measurement.
  const currentSprint = useMemo(() => findCurrentSprint(windowInfo.windows, today), [windowInfo.windows, today]);
  const sprintTickets = useMemo(() => {
    if (!currentSprint) return [];
    return scoped.filter(t => {
      const raw = t._rawFields || {}; const arr = raw.customfield_10010 || raw.sprint;
      if (Array.isArray(arr)) return arr.some(sp => (typeof sp === 'string' ? sp : sp?.name) === currentSprint.name);
      return getSprint(t) === currentSprint.name;
    });
  }, [scoped, currentSprint]);

  const [daily, setDaily] = useState({ status: 'idle', wl: null, cl: null });
  const sprintKeyStr = sprintTickets.map(getKey).filter(Boolean).join(',');
  useEffect(() => {
    const keys = sprintKeyStr ? sprintKeyStr.split(',') : [];
    if (!keys.length) { setDaily({ status: 'idle', wl: null, cl: null }); return; }
    let cancelled = false;
    setDaily(d => ({ ...d, status: 'loading' }));
    (async () => {
      try {
        const [wlRes, clRes] = await Promise.all([jiraService.getWorklogs(keys), jiraService.getChangelogs(keys)]);
        if (cancelled) return;
        const wlMap = new Map();
        for (const w of wlRes.worklogs) { if (!wlMap.has(w.issueKey)) wlMap.set(w.issueKey, []); wlMap.get(w.issueKey).push(w); }
        const clMap = new Map();
        for (const c of clRes.changelogs) clMap.set(c.key, c);
        setDaily({ status: 'loaded', wl: wlMap, cl: clMap });
      } catch (e) { if (!cancelled) setDaily({ status: 'error', wl: null, cl: null, error: e.message }); }
    })();
    return () => { cancelled = true; };
     
  }, [sprintKeyStr]);

  // The baseline is an earlier day's figures for this project scope, so it stays the same
  // however many times the note recomputes today (e.g. when activity data finishes loading).
  const dailyNote = useMemo(() => computeDailyNote({
    sprintTickets, allScoped: scoped, sprint: currentSprint,
    worklog: daily.wl, changelog: daily.cl, today,
    prev: loadBaseline(selectedProject, zonedDayKey(today)), deriveChangelog, stallDays,
  }), [sprintTickets, scoped, currentSprint, daily.wl, daily.cl, today, stallDays, selectedProject]);

  // Record today's figures, so tomorrow's note can report the movement.
  useEffect(() => { if (dailyNote.snapshot) saveSnapshot(selectedProject, dailyNote.snapshot); }, [dailyNote.snapshot, selectedProject]);

  // Every name that appears in the window, before any exclusion — needed so the
  // service-account detector can see candidates that would otherwise be filtered out.
  const allNames = useMemo(() => {
    const s = new Set();
    for (const t of completedTickets) s.add(getAssignee(t));
    if (cl.status === 'loaded' && cl.byKey) {
      for (const t of completedTickets) {
        const c = cl.byKey.get(getKey(t));
        if (c) s.add(deriveChangelog(c, getAssignee(t), getCreated(t)).assigneeAtDone);
      }
    }
    if (wl.status === 'loaded' && wl.byKey && windowStart && windowEnd) {
      for (const entries of wl.byKey.values()) {
        for (const w of entries) {
          const d = w.started ? new Date(w.started) : null;
          if (d && !isNaN(d) && d >= windowStart && d <= windowEnd) s.add(w.author);
        }
      }
    }
    // people carrying work that is still in flight — they have no completions yet but
    // still occupy capacity and must appear in the allocation editor
    for (const t of scoped) {
      const st = getStatus(t);
      if (!isDone(st) && !isTodoName(st)) s.add(getAssignee(t));
    }
    s.delete(undefined); s.delete(null); s.delete('');
    return [...s];
  }, [completedTickets, scoped, cl.byKey, cl.status, wl.byKey, wl.status, windowStart, windowEnd]);

  const excludedSet = useMemo(() => new Set(serviceAccounts), [serviceAccounts]);
  const activeNames = useMemo(() => allNames.filter(n => !excludedSet.has(n)), [allNames, excludedSet]);

  // Presence + allocation, resolved per person per sprint.
  const availability = useMemo(() => resolveAvailability({
    windowSprints,
    names: activeNames,
    worklogByKey: wl.status === 'loaded' ? wl.byKey : null,
    doneEvents: completedTickets.map(t => {
      const c = cl.status === 'loaded' && cl.byKey ? cl.byKey.get(getKey(t)) : null;
      const name = c ? deriveChangelog(c, getAssignee(t), getCreated(t)).assigneeAtDone : getAssignee(t);
      return { name, date: getResolved(t) };
    }),
    allocationPctOf, allocationBasisOf,
    configured: allocOverrides,
    ratedSprintNames: coverage.ratedNames,
  }), [windowSprints, activeNames, wl.byKey, wl.status, cl.byKey, cl.status, completedTickets, allocationPctOf, allocationBasisOf, allocOverrides, coverage.ratedNames]);

  const M = useMemo(
    () => computeTeam({ completedTickets, scoped, worklog: wl.status === 'loaded' ? wl.byKey : null, changelog: cl.status === 'loaded' ? cl.byKey : null, availability, excludedSet, windowSprints, workingDaysInWindow, windowStart, windowEnd, hoursPerDay, attrSprintOf, windowFor, splitByHours, today, coverage }),
    [completedTickets, scoped, wl.byKey, wl.status, cl.byKey, cl.status, availability, excludedSet, windowSprints, workingDaysInWindow, windowStart, windowEnd, hoursPerDay, attrSprintOf, windowFor, splitByHours, today, coverage]
  );

  // Service/bot account candidates: nothing completed, no points, over the whole window.
  const serviceCandidates = useMemo(
    () => detectServiceAccountCandidates(M.rows, [...serviceAccounts, ...dismissedCandidates]),
    [M.rows, serviceAccounts, dismissedCandidates]
  );

  const scopeLabel = [`last ${windowN} completed sprints`, selectedProject !== 'all' ? selectedProject : 'all projects'].join(' · ');
  const projectLabel = selectedProject !== 'all' ? selectedProject : 'All projects';

  // Allocation basis for the whole panel — stated on every printed/emailed artifact.
  const allocBasisSummary = useMemo(() => {
    const parts = Object.entries(M.basisCounts || {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${ALLOC_BASIS[k]?.short || k}`);
    return parts.join(' · ') || 'no contributors';
  }, [M.basisCounts]);

  const emailMeta = useMemo(() => ({
    subject: `Team Contribution — ${projectLabel} — last ${windowSprints.length || windowN} sprints (to ${windowEnd ? windowEnd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'})`,
    scopeLabel, projectLabel, windowN,
    sprintCount: windowSprints.length,
    sprintNames: windowSprints.map(w => shortSprint(w.name)),
    workingDaysInWindow,
    allocBasisSummary,
    generatedAt: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  }), [projectLabel, scopeLabel, windowN, windowSprints, windowEnd, workingDaysInWindow, allocBasisSummary]);

  // sorting (alphabetical default; metric sort only on explicit click, no colour/rank)
  const sortedRows = useMemo(() => {
    const rows = [...M.rows];
    const val = r => {
      switch (sortCol) {
        case 'tickets': return r.tickets; case 'sp': return r.sp; case 'hours': return r.hours;
        case 'spPerDay': return r.spPerDay ?? -1; case 'medianSize': return r.medianSize ?? -1;
        case 'shareSP': return r.shareSP; case 'completeness': return r.completeness ?? -1;
        case 'unpointedShare': return r.unpointedShare ?? -1; case 'openWip': return r.openWip ?? -1;
        default: return null;
      }
    };
    rows.sort((a, b) => sortCol === 'name' ? a.name.localeCompare(b.name) : (sortDir === 'asc' ? (val(a) - val(b)) : (val(b) - val(a))));
    return rows;
  }, [M.rows, sortCol, sortDir]);

  const onSort = col => { if (col === sortCol && col !== 'name') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir(col === 'name' ? 'asc' : 'desc'); } };
  const SortTh = ({ col, children, align = 'right', sticky = false }) => (
    <th style={{ ...(align === 'left' ? thL : thR), ...(sticky ? STICKY_HEAD : {}) }}><button onClick={() => onSort(col)} style={{ background: 'none', border: 'none', color: sortCol === col ? '#e2e8f0' : '#6b7280', cursor: 'pointer', font: 'inherit', fontWeight: 600, padding: 0 }}>{children}{sortCol === col && col !== 'name' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>
  );

  // Every caveat that used to be its own banner, collapsed behind one line. The
  // service-account decision buttons live inside the expander so the action survives.
  const dataNotes = useMemo(() => {
    const n = [];
    if (serviceCandidates.length > 0) n.push({
      short: `${serviceCandidates.length} possible service account(s)`, color: '#a855f7',
      body: (
        <>
          <strong>{serviceCandidates.length} account(s) completed nothing and carry no points</strong> — {serviceCandidates.map(c => `${c.name}${c.hours ? ` (${f1(c.hours)}h logged)` : ''}`).join(', ')}. Each currently adds a full person's worth of days to the capacity denominator.
          <div style={{ marginTop: 7, display: 'flex', gap: 7, flexWrap: 'wrap' }}>
            {serviceCandidates.map(c => (
              <button key={c.name} onClick={() => persistServiceAccounts([...serviceAccounts, c.name])} style={{ ...btnGhost, padding: '4px 10px', fontSize: 11.5, color: '#e9d5ff', borderColor: 'rgba(168,85,247,0.5)' }}>Exclude {c.name}</button>
            ))}
            <button onClick={() => persistDismissed([...dismissedCandidates, ...serviceCandidates.map(c => c.name)])} style={{ ...btnGhost, padding: '4px 10px', fontSize: 11.5 }}>They're all real people — keep</button>
          </div>
        </>
      ),
    });
    if (serviceAccounts.length > 0) n.push({
      short: 'service accounts excluded', color: '#64748b',
      body: <>Excluded as service accounts: <strong>{serviceAccounts.join(', ')}</strong> — out of the contributor list, the count and the capacity denominator. Manage under <em>Allocation &amp; accounts</em>.</>,
    });
    if (M.coverage?.excluded.length > 0) n.push({
      short: `${M.coverage.excluded.length} sprint(s) below pointing threshold`, color: '#ef4444',
      body: <><strong>{M.coverage.excluded.map(e => e.label).join(', ')} excluded from every rate</strong> — {M.coverage.excluded.map(e => `${pctI(e.coverage * 100)}% of ${e.all} completed tickets pointed`).join('; ')}. Delivery there was real; the measurement was not. Threshold {pctI(M.coverage.threshold * 100)}%.</>,
    });
    if (M.coverage?.lowButIncluded.length > 0) n.push({
      short: 'partial pointing coverage', color: '#f59e0b',
      body: <>{M.coverage.lowButIncluded.map(e => `${e.label} at ${pctI(e.coverage * 100)}%`).join(', ')} — included, but their rates understate delivery by whatever the unpointed remainder was worth.</>,
    });
    n.push({
      short: 'leave not accounted for', color: '#f59e0b',
      body: <><strong>Leave is not in this data.</strong> Presence is inferred per sprint from logged work and completed tickets, which catches whole sprints away but not shorter absences.</>,
    });
    if (M.assumedNames.length > 0) n.push({
      short: `${M.assumedNames.length} without verified allocation`, color: '#f97316',
      body: <><strong>{M.assumedNames.join(', ')}</strong> have no verified allocation — suppressed <em>and</em> out of the capacity denominator, so the figures describe the {M.assessableCount} assessable contributor(s) only.</>,
    });
    if (M.weakPresence.length > 0) n.push({
      short: 'presence inferred from completions only', color: '#fbbf24',
      body: <>For <strong>{M.weakPresence.join(', ')}</strong>, "absent" and "present but logged nothing" are not distinguishable — their available-day counts are the weakest in the table.</>,
    });
    if (M.suppressedNames.length > 0) n.push({
      short: `${M.suppressedNames.length} suppressed`, color: '#64748b',
      body: <>No rate shown for {M.suppressedNames.join(', ')} — under 10 completed pointed tickets or no establishable allocation. Raw volume still shown.</>,
    });
    if (splitByHours) n.push({
      short: 'split-SP mode on', color: '#ef4444',
      body: <><strong>Split-SP mode is on (comparison only).</strong> Points are split by logged-hours share, which imports logging bias into the one metric otherwise immune to it.</>,
    });
    if (wl.status === 'loading') n.push({ short: 'loading worklogs', color: '#60a5fa', body: <>Loading worklogs for hours attribution ({worklogKeys.length} tickets).</> });
    if (wl.status === 'error') n.push({ short: 'worklog load failed', color: '#ef4444', body: <>Worklog load failed — hours columns unavailable this session. {wl.error}</> });
    if (cl.status === 'loading') n.push({ short: 'loading change history', color: '#60a5fa', body: <>Loading change history ({completedTickets.length} tickets).</> });
    if (cl.status === 'error') n.push({ short: 'change history failed', color: '#f59e0b', body: <>Change-history load failed — using current assignee and Start→Done cycle time. {cl.error}</> });
    return n;
     
  }, [serviceCandidates, serviceAccounts, dismissedCandidates, M, splitByHours, wl.status, wl.error, cl.status, cl.error, worklogKeys.length, completedTickets.length]);

  const canEmail = windowSprints.length > 0 && M.rows.length > 0;
  const viewToggle = (
    <div className="tt-no-print" style={{ display: 'inline-flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 9, padding: 3, marginRight: 'auto' }}>
      {[['overview', 'Overview'], ['daily', 'Daily note'], ['analyst', 'Analyst panel'], ['sprint', 'By sprint'], ['queue', 'Queue'], ['exec', 'Executive summary'], ['method', 'Methodology']].map(([k, lbl]) => (
        <button key={k} onClick={() => setView(k)} style={{ background: view === k ? 'rgba(96,165,250,0.22)' : 'transparent', border: 'none', color: view === k ? '#dbeafe' : '#94a3b8', borderRadius: 7, padding: '6px 13px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{lbl}</button>
      ))}
    </div>
  );
  const printBar = (
    <div className="tt-no-print" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      {viewToggle}
      <button
        onClick={() => setShowAlloc(true)}
        title="Set each person's allocation to this project and exclude service accounts"
        style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: 6 }}
      >
        <SlidersHorizontal size={13} /> Allocation &amp; accounts
      </button>
      <button
        onClick={() => setShowEmail(true)}
        disabled={!canEmail}
        title={canEmail ? 'Build a narrative report with a synopsis and per-person standing, ready to send' : 'No contributors in the current window'}
        style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: 6, background: canEmail ? 'rgba(37,99,235,0.18)' : 'rgba(255,255,255,0.04)', borderColor: canEmail ? 'rgba(96,165,250,0.5)' : 'rgba(255,255,255,0.1)', color: canEmail ? '#bfdbfe' : '#475569', cursor: canEmail ? 'pointer' : 'not-allowed' }}
      >
        <Mail size={13} /> Email report
      </button>
      <button onClick={() => window.print()} style={btnGhost}>🖨 Print / Save as PDF</button>
    </div>
  );
  const printHeader = (
    <div className="tt-print-header">
      <div style={{ fontSize: 18, fontWeight: 800 }}>Team Contribution</div>
      <div style={{ fontSize: 12 }}>{scopeLabel} · generated {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
      <div style={{ fontSize: 11 }}>Allocation basis: {allocBasisSummary}</div>
    </div>
  );
  const controls = (
    <div className="tt-no-print" style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 18px', marginBottom: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>👥 Team scope</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#94a3b8' }}>Window
        <select value={windowN} onChange={e => setWindow(parseInt(e.target.value, 10))} style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}>
          <option value={3}>Last 3 completed sprints</option><option value={6}>Last 6 completed sprints</option><option value={12}>Last 12 completed sprints</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
        <input type="number" min="0.5" step="0.5" value={hoursPerDay} onChange={e => { const n = parseFloat(e.target.value); if (Number.isFinite(n) && n > 0) { setHoursPerDay(n); localStorage.setItem('tt_hoursPerDay', String(n)); } }} style={{ width: 52, background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#e2e8f0', padding: '5px 8px', fontSize: 13 }} /> h/day
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }} title="A sprint where fewer than this share of completed tickets carried a story point is dropped from every rate — its delivery was real but its measurement is not.">
        Min pointing coverage
        <select value={coverageMin} onChange={e => { const v = parseFloat(e.target.value); setCoverageMin(v); localStorage.setItem('tt_coverageMin', String(v)); }} style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}>
          <option value={0}>Off — include every sprint</option><option value={0.5}>50%</option><option value={0.7}>70% (default)</option><option value={0.9}>90%</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }} title="Comparison only — contaminated by logging discipline">
        <input type="checkbox" checked={splitByHours} onChange={e => setSplitByHours(e.target.checked)} /> split SP by logged-hours share
      </label>
    </div>
  );
  const scopeNote = (
    <div style={{ fontSize: 11.5, color: '#6b7280', margin: '0 2px 12px' }}>
      Scope: <strong style={{ color: '#94a3b8' }}>last {windowN} completed sprints</strong> for {selectedProject !== 'all' ? <strong style={{ color: '#94a3b8' }}>{selectedProject}</strong> : 'all projects'} (ignores the sprint & assignee filters). SP credited to the <strong style={{ color: '#94a3b8' }}>assignee at completion</strong>{M.changelogLoaded ? ' (from change history)' : ''}; hours to the <strong style={{ color: '#94a3b8' }}>worklog author</strong>. Working days exclude weekends and Greek public holidays.
    </div>
  );

  const allocModal = showAlloc && (
    <TeamAllocationEditor
      rows={M.rows}
      allNames={allNames}
      windowSprints={windowSprints}
      overrides={allocOverrides}
      serviceAccounts={serviceAccounts}
      onSaveOverrides={persistAllocOverrides}
      onSaveServiceAccounts={persistServiceAccounts}
      onClose={() => setShowAlloc(false)}
    />
  );

  const subNav = (extra = null) => (
    <div className="tt-no-print" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      {viewToggle}
      {extra}
      <button onClick={() => setShowAlloc(true)} style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: 6 }}><SlidersHorizontal size={13} /> Allocation &amp; accounts</button>
    </div>
  );

  // The daily note is about the sprint in flight, so it must not wait for a sprint to close —
  // it sits ahead of the completed-sprints gate below. Its email is the note itself, not the
  // per-person contribution report.
  const emailDailyNote = async () => {
    const text = buildDailyNoteText(dailyNote, projectLabel);
    await copyPlain(text);
    const subject = `Daily note — ${currentSprint ? shortSprint(currentSprint.name) : 'no sprint running'} — ${projectLabel} — ${dailyNote.todayKey}`;
    let to = '';
    try { to = localStorage.getItem('tt_email_to') || ''; } catch { /* private mode */ }
    // mailto bodies are length-limited; the full note is already on the clipboard
    const body = text.length > 1800 ? `${text.slice(0, 1800)}\n…\n\n[The full note is on your clipboard — paste it over this text.]` : text;
    window.location.href = `mailto:${encodeURIComponent(to.trim())}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`.replace(/%2C/g, ',');
  };

  if (view === 'daily') {
    return (
      <>
        {subNav()}
        <TeamDailyNote
          note={dailyNote}
          projectLabel={projectLabel}
          loading={daily.status === 'loading'}
          error={daily.status === 'error' ? daily.error : null}
          stallDays={stallDays}
          onStallDaysChange={v => { setStallDays(v); saveStallDays(v); }}
          onEmail={emailDailyNote}
        />
        {allocModal}
      </>
    );
  }

  // gates for empty / loading
  if (!windowSprints.length) {
    return <div className="tt-print-root">{printBar}{printHeader}{controls}{subNav()}{scopeNote}<Card><div style={{ textAlign: 'center', padding: '28px 12px', color: '#94a3b8' }}>No completed sprints in the current window {selectedProject !== 'all' ? `for ${selectedProject}` : ''}. The Daily note still covers the sprint in flight.</div></Card>{allocModal}</div>;
  }

  if (view === 'overview') {
    return (
      <>
        {subNav(
          <button onClick={() => window.print()} className="tt-no-print" style={btnGhost}>🖨 Print / Save as PDF</button>
        )}
        <TeamOverview
          M={M}
          windowN={windowN}
          projectLabel={projectLabel}
          scopeLabel={scopeLabel}
          onView={setView}
        />
        {allocModal}
      </>
    );
  }

  if (view === 'queue') {
    return (
      <>
        {subNav()}
        <TeamQueueTab scoped={scoped} today={today} projectLabel={projectLabel} projectKey={selectedProject} staleThreshold={M.queue.staleThreshold} />
        {allocModal}
      </>
    );
  }

  if (view === 'method') {
    return (
      <>
        {subNav()}
        <TeamMethodology M={M} meta={{ scopeLabel, generatedAt: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) }} />
        {allocModal}
      </>
    );
  }

  if (view === 'sprint') {
    return (
      <>
        {subNav()}
        <TeamBySprintView M={M} scopeLabel={scopeLabel} allocBasisSummary={allocBasisSummary} />
        {allocModal}
      </>
    );
  }

  if (view === 'exec') {
    return (
      <>
        {subNav()}
        <ExecutiveSummaryView
          M={M}
          windowN={windowN}
          onWindowChange={setWindow}
          meta={{
            projectLabel, scopeLabel, windowN,
            sprintCount: windowSprints.length,
            sprintNames: windowSprints.map(w => shortSprint(w.name)),
            workingDaysInWindow, hoursPerDay,
            allocBasisSummary,
            windowStart, windowEnd,
            generatedAt: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
          }}
        />
        {allocModal}
      </>
    );
  }

  return (
    <div className="tt-print-root">
      {printBar}
      {printHeader}
      {controls}
      {scopeNote}

      {/* What this panel claims — stated before the numbers, not after them */}
      <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.65, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 10, padding: '11px 14px', marginBottom: 12 }}>
        <strong style={{ color: '#dbeafe' }}>This shows what was delivered and what is stuck. It is not a performance measure</strong> — <button onClick={() => setView('method')} className="tt-no-print" style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#93c5fd', textDecoration: 'underline', cursor: 'pointer' }}>see Methodology for why</button>.
      </div>

      {/* One collapsed line instead of a stack of warnings */}
      {dataNotes.length > 0 && (
        <div className="tt-print-card" style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, marginBottom: 14, background: 'rgba(255,255,255,0.02)' }}>
          <button
            onClick={() => setNotesOpen(o => !o)}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: '10px 14px', cursor: 'pointer', color: '#cbd5e1', font: 'inherit', fontSize: 12.5, textAlign: 'left' }}
          >
            {notesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <strong style={{ color: '#e2e8f0' }}>Data notes ({dataNotes.length})</strong>
            <span style={{ color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>— {dataNotes.map(n => n.short).join(', ')}</span>
          </button>
          {notesOpen && (
            <div style={{ padding: '2px 14px 12px', display: 'grid', gap: 9 }}>
              {dataNotes.map(n => (
                <div key={n.short} style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.6, borderLeft: `3px solid ${n.color}`, paddingLeft: 11 }}>{n.body}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Four headline figures. The rest moved into the table header and Methodology. */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <KpiTile label="SP / day — assessable" value={M.team.spPerDay != null ? f2(M.team.spPerDay) : '—'} sub={`${f1(M.team.assessableSP)} SP ÷ ${f1(M.team.totalAllocDays)} days, both assessable-only`} color="#22c55e" />
        <KpiTile label={`Stale queue (>${M.queue.staleThreshold} working days)`} value={M.queue.stale} sub={`of ${M.queue.open} open · the working list is on the Queue tab`} color={M.queue.stale > 0 ? '#ef4444' : '#22c55e'} />
        <KpiTile label="Tickets open in an in-progress state" value={M.team.openWipMedian != null ? f1(M.team.openWipMedian) : '—'} sub={`median per assessable person per sprint · ${M.queue.active} of ${M.queue.open} touched in ${M.queue.activeWindow} working days`} color="#c084fc" />
        <KpiTile label="Logged vs available hours — assessable" value={M.team.loggingCompleteness != null ? pctI(M.team.loggingCompleteness * 100) + '%' : '—'} sub={`${f1(M.team.loggedHours)}h of ${f1(M.team.capacityHours)}h · all shown ${M.team.loggingCompletenessAll != null ? pctI(M.team.loggingCompletenessAll * 100) + '%' : '—'}`} color="#94a3b8" />
      </div>

      {/* Unpointed work — the only measurement of output the organisation does not record */}
      {M.unpointedMedian != null && (
        <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.65, background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 10, padding: '13px 16px', marginBottom: 14 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#7dd3fc', marginBottom: 5 }}>
            {M.team.unpointedHoursShare != null ? pctI(M.team.unpointedHoursShare * 100) : pctI(M.unpointedMedian * 100)}% of logged hours went to work carrying no story points
          </div>
          This is the only measurement anywhere in the dashboard of work the organisation is doing and not recording as deliverable — support, reviews, incidents, BAU and mentoring are real output that a points-based view cannot see. Treat it as a scoping question, not a data-quality problem: the work happened either way.
          {M.mostlyInvisible.length > 0 && (
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(56,189,248,0.22)' }}>
              For <strong style={{ color: '#e2e8f0' }}>{M.mostlyInvisible.join(', ')}</strong>, most of their work is invisible to this panel — over 60% of their logged hours sit outside their completed pointed tickets. The correct reading of a low throughput figure for them is <em>this panel cannot see what they did</em>, not that they delivered little.
            </div>
          )}
        </div>
      )}

      {/* Queue age — what the WIP number is actually made of */}
      <Card>
        <CardHeader
          title="The in-progress queue right now"
          subtitle={`Tickets currently sitting in an in-progress status, for assessable contributors. Age is working days since ${M.queue.ageBasis}. Unassigned work is counted separately below — it is a queue, not a person.`}
        />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <KpiTile label="Open in an in-progress state" value={M.queue.open} sub={`${M.queue.active} touched in the last ${M.queue.activeWindow} working days`} color="#c084fc" />
          <KpiTile label="Not touched recently" value={M.queue.open - M.queue.active} sub={`no worklog or update in ${M.queue.activeWindow}+ working days`} color="#f59e0b" />
          <KpiTile label="Typical age" value={M.queue.medianAge != null ? f1(M.queue.medianAge) + ' d' : '—'} sub={`slowest tenth sit ${M.queue.p90Age != null ? f1(M.queue.p90Age) + '+ days' : '—'}`} color="#fb923c" />
          <KpiTile label={`Older than ${M.queue.staleThreshold} days`} value={`${M.queue.stale}${M.queue.open > 0 ? ` (${pctI((M.queue.stale / M.queue.open) * 100)}%)` : ''}`} sub={M.queue.oldest ? `oldest: ${M.queue.oldest.key} at ${f1(M.queue.oldest.age)} working days (${M.queue.oldest.status})` : 'no aged items'} color={M.queue.stale > 0 ? '#ef4444' : '#22c55e'} />
        </div>
        {M.queue.allShown.open !== M.queue.open && (
          <div style={{ marginTop: 10, fontSize: 11.5, color: '#6b7280' }}>
            Counting every contributor shown in the table, not just the assessable ones: <strong style={{ color: '#94a3b8' }}>{M.queue.allShown.open} open</strong>, {M.queue.allShown.stale} of them older than {M.queue.staleThreshold} working days. The cards above use the assessable population so they reconcile with the throughput figures.
          </div>
        )}
        {M.unassignedBacklog.open > 0 && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.6, background: 'rgba(56,189,248,0.07)', border: '1px solid rgba(56,189,248,0.28)', borderRadius: 10, padding: '11px 14px' }}>
            <strong style={{ color: '#7dd3fc' }}>Unassigned backlog: {M.unassignedBacklog.open} tickets in an in-progress state with nobody on them</strong>
            {M.unassignedBacklog.sp > 0 && <> ({f1(M.unassignedBacklog.sp)} SP)</>}
            {M.unassignedBacklog.medianAge != null && <>, typical age {f1(M.unassignedBacklog.medianAge)} working days</>}
            {M.unassignedBacklog.stale > 0 && <>, {M.unassignedBacklog.stale} of them older than {M.queue.staleThreshold} days</>}
            {M.unassignedBacklog.oldest && <>. Oldest: {M.unassignedBacklog.oldest.key} at {f1(M.unassignedBacklog.oldest.age)} days</>}.
            {' '}A queue this size is a finding in its own right, but it is not a contributor — it is excluded from every per-person figure and from the team capacity.
          </div>
        )}
        {M.queue.unknownAge > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280' }}>{M.queue.unknownAge} in-progress ticket(s) have neither a start nor a creation date, so they carry no age and are left out of the age figures above.</div>
        )}
      </Card>

      {M.flow && M.flow.verdict !== 'ok' && (
        <Banner color={M.flow.verdict === 'flow' ? '#f59e0b' : '#ef4444'} icon={<AlertTriangle size={15} />}>
          <strong>Work sits: a typical completed ticket takes {f1(M.flow.cycleDaysMedian)} working days for {f1(M.team.medianTicketSize)} story points.</strong>{' '}
          {M.flow.verdict === 'flow'
            ? <>Each person has {f1(M.flow.openWipMedian)} tickets open in an in-progress state, so this reads as a <strong>flow problem</strong> — too much started and left open. The lever is a limit on open work, not more effort.</>
            : <>Each person has only {f1(M.flow.openWipMedian)} tickets open in an in-progress state, so this is not congestion — it reads as a <strong>blocking or dependency problem</strong>: items wait on something external. The lever is finding what they wait on.</>}
          {' '}This is a process finding about how work moves, not about any individual.
        </Banner>
      )}
      {M.quietNames.length > 0 && (
        <Banner color="#38bdf8" icon="ℹ">
          <strong>Present throughout but little pointed output: {M.quietNames.join(', ')}.</strong> They were on the team for the whole window and are logging time, yet completed pointed tickets in only a minority of sprints. Check whether their work is being captured as tickets at all — support, operational and BAU work often is not, and a throughput panel cannot see any of it.
        </Banner>
      )}

      <WhatThisMeans M={M} windowN={windowN} scopeLabel={scopeLabel} />

      {/* Main table */}
      <Card>
        <CardHeader
          title="Contributors"
          subtitle="Alphabetical by default. Click a header to sort — there is deliberately no rank, score, or good/bad colouring of people."
          right={
            <div className="tt-no-print" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7 }}>
              <button onClick={() => setShowAllCols(v => !v)} style={{ ...btnGhost, fontSize: 11.5 }}>
                {showAllCols ? 'Show fewer columns' : 'Show all columns'}
              </button>
              <div style={{ fontSize: 10.5, color: '#6b7280', textAlign: 'right', lineHeight: 1.6 }}>
                {M.rows.length} shown · {M.assessableCount} assessable · {M.suppressedCount} suppressed<br />
                {f1(M.team.assessableSP)} SP over {f1(M.team.totalAllocDays)} available person-days<br />
                typical ticket {M.team.medianTicketSize != null ? f1(M.team.medianTicketSize) : '—'} SP, {M.team.cycleDaysMedian != null ? f1(M.team.cycleDaysMedian) + ' d' : '—'} to Done
              </div>
            </div>
          }
        />
        {/* The only horizontal scroll region on the page. The Contributor column is pinned
            so names stay readable while the metric columns scroll under them. */}
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: showAllCols ? 1100 : 640 }}>
            <thead>
              <tr style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 9.5 }}>
                <th style={{ ...thL, ...STICKY_HEAD }}></th>
                <SortTh col="tickets">Tickets</SortTh><SortTh col="sp">SP</SortTh><SortTh col="hours">Hours</SortTh>
                <SortTh col="unpointedShare">Unpointed%</SortTh><SortTh col="openWip">Open in-prog</SortTh>
                {showAllCols && <>
                  <th style={{ ...thR, borderLeft: '2px solid rgba(255,255,255,0.06)' }} title="Sprints the person was present for, out of the window">Present</th>
                  <th style={thR} title="Fraction of their time on this project">Alloc%</th>
                  <th style={thR} title="Working days × presence × allocation">Avail-days</th>
                  <th style={thR}>Worklogs</th><th style={thR}>Sprints</th>
                  <SortTh col="spPerDay">SP/avail-day</SortTh><SortTh col="medianSize">Med size</SortTh><th style={thR}>Size mix</th><SortTh col="shareSP">SP% / cap%</SortTh>
                  <SortTh col="completeness">Log %</SortTh><th style={{ ...thR, color: '#475569' }}>Round%</th><th style={{ ...thR, color: '#475569' }}>WL/tkt</th><th style={{ ...thR, color: '#475569' }}>Shared%</th><th style={{ ...thR, color: '#475569' }}>Carry%</th><th style={{ ...thR, color: '#475569' }}>Reopen%</th><th style={{ ...thR, color: '#475569' }}>Blocked%</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => (
                <tr key={r.name} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ ...tdL, ...STICKY_CELL, color: '#e2e8f0', fontWeight: 500, whiteSpace: 'nowrap' }}>
                    {r.name}
                    {r.sharedHigh && <span title="A large share of these points came from tickets multiple people worked on" style={{ marginLeft: 5, color: '#fbbf24' }}>◐</span>}
                    {r.allocUnknown && <span title="Allocation unverified — normalised metrics suppressed and excluded from the team denominator" style={{ marginLeft: 5, color: '#f97316' }}>⚠</span>}
                    {r.presenceBasis === 'completion' && r.absentCount > 0 && <span title="Presence inferred from completed tickets only — cannot tell 'away' from 'here but finished nothing'" style={{ marginLeft: 5, color: '#fbbf24' }}>◇</span>}
                    {r.unpointedShare >= 0.6 && <span title="Most of this person's logged work sits outside their completed pointed tickets — this panel cannot see it" style={{ marginLeft: 5, color: '#7dd3fc' }}>◒</span>}
                    {showAllCols && <div style={{ fontSize: 9.5, color: '#64748b', fontWeight: 400 }} title={r.basisLabel}>{r.allocBasisShort}</div>}
                  </td>
                  <td style={{ ...tdR, color: '#e2e8f0' }}>{r.tickets}</td>
                  <td style={{ ...tdR, color: '#e2e8f0' }}>{f1(r.sp)}</td>
                  <td style={{ ...tdR, color: '#86efac' }}>{r.hours != null ? f1(r.hours) + 'h' : '—'}</td>
                  <td style={{ ...tdR, color: r.unpointedShare >= 0.6 ? '#7dd3fc' : '#64748b', fontWeight: r.unpointedShare >= 0.6 ? 600 : 400 }} title={r.unpointedShare != null ? `${f1(r.otherHours)}h of ${f1(r.hours)}h logged went to work outside their completed pointed tickets${r.hoursPerSP != null ? ` · ${f1(r.hoursPerSP)}h per delivered SP` : ''}` : 'Needs worklogs'}>{r.unpointedShare != null ? pctI(r.unpointedShare * 100) + '%' : '—'}</td>
                  <td style={{ ...tdR, color: r.staleNow > 0 ? '#fca5a5' : '#64748b' }} title={`Average number of tickets sitting in an in-progress status per sprint — not a count of things worked on at once. Right now: ${r.openNow} open, ${r.activeNow} touched in the last 5 working days, ${r.staleNow} older than 20.`}>{r.openWip != null ? f1(r.openWip) : '—'}{r.staleNow > 0 && <span style={{ color: '#f87171' }}> ({r.staleNow}⧗)</span>}</td>
                  {showAllCols && <>
                    <td style={{ ...tdR, borderLeft: '2px solid rgba(255,255,255,0.06)', color: r.absentCount > 0 ? '#fbbf24' : '#94a3b8' }} title={r.basisLabel}>{r.presentCount != null ? `${r.presentCount}/${windowSprints.length}` : '—'}</td>
                    <td style={{ ...tdR, color: '#94a3b8' }}>{r.allocPct != null ? pctI(r.allocPct * 100) + '%' : '—'}</td>
                    <td style={{ ...tdR, color: '#cbd5e1' }}>{r._allocDays != null ? f1(r._allocDays) : '—'}</td>
                    <td style={{ ...tdR, color: '#94a3b8' }}>{r.worklogCount ?? '—'}</td>
                    <td style={{ ...tdR, color: '#94a3b8' }}>{r.sprintsActive}</td>
                    {r.suppressed
                      ? <td colSpan={4} style={{ ...tdR, color: '#6b7280', fontStyle: 'italic' }}>{r.suppressReason}</td>
                      : <>
                          {/* no interval printed here — the whiskers on the chart below make the
                              same comparison without asking anyone to do arithmetic in a cell */}
                          <td style={{ ...tdR, color: '#93c5fd', fontWeight: 600 }}>{f2(r.spPerDay)}</td>
                          <td style={{ ...tdR, color: '#c4b5fd' }}>{r.medianSize != null ? f1(r.medianSize) : '—'}</td>
                          <td style={{ ...tdR }}><div style={{ display: 'flex', justifyContent: 'flex-end' }}><SizeMix mix={r.sizeMix} /></div></td>
                          <td style={{ ...tdR, color: '#94a3b8' }}>{pctI(r.shareSP * 100)}% / {r.shareCap != null ? pctI(r.shareCap * 100) + '%' : '—'}</td>
                        </>}
                    <td style={{ ...tdR, color: '#64748b' }} title={r.completeness > 1.2 ? 'Logged more than their allocated capacity — their allocation is understated' : ''}>{r.completeness != null ? (r.completeness > 1.2 ? '>100%⚠' : pctI(r.completeness * 100) + '%') : '—'}</td>
                    <td style={{ ...tdR, color: '#64748b' }}>{r.roundShare != null ? pctI(r.roundShare * 100) + '%' : '—'}</td>
                    <td style={{ ...tdR, color: '#64748b' }}>{r.worklogsPerTicket != null ? f1(r.worklogsPerTicket) : '—'}</td>
                    <td style={{ ...tdR, color: '#64748b' }}>{r.sharedShare != null ? pctI(r.sharedShare * 100) + '%' : '—'}</td>
                    <td style={{ ...tdR, color: '#64748b' }}>{r.carryoverRate != null ? pctI(r.carryoverRate * 100) + '%' : '—'}</td>
                    <td style={{ ...tdR, color: r.reopenRate > 0 ? '#fca5a5' : '#64748b' }}>{r.reopenRate != null ? pctI(r.reopenRate * 100) + '%' : '—'}</td>
                    <td style={{ ...tdR, color: r.blockedShare > 0 ? '#fcd34d' : '#64748b' }}>{r.blockedShare != null ? pctI(r.blockedShare * 100) + '%' : '—'}</td>
                  </>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 10, lineHeight: 1.6 }}>
          ◐ = ≥40% of credited SP came from multi-author tickets · ⚠ = allocation unverified · ◇ = presence from completed tickets only · ◒ = most of their logged work is outside pointed tickets · ⧗ = open longer than {M.queue.staleThreshold} working days.
          {' '}<strong style={{ color: '#94a3b8' }}>Open in-prog</strong> is the average number of tickets sitting in an in-progress status, not a count of work done in parallel. <strong style={{ color: '#94a3b8' }}>Unpointed%</strong> is the share of logged hours spent outside the person's own completed pointed tickets.
          {' '}Confidence intervals are on the chart below rather than in these cells; the derivation of every figure is on <button onClick={() => setView('method')} className="tt-no-print" style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#93c5fd', textDecoration: 'underline', cursor: 'pointer' }}>Methodology</button>.
        </div>
      </Card>

      {/* Chart 1: SP per available day with CI whiskers */}
      <Card>
        <CardHeader title="SP per available day — with 95% confidence intervals" subtitle="Alphabetical. Dashed line = team median. Overlapping intervals mean the difference is within the margin of error." />
        {M.barData.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>No contributors clear the n≥10 gate yet.</div> : (
          <ResponsiveContainer width="100%" height={Math.max(180, M.barData.length * 34)}>
            <BarChart data={M.barData} layout="vertical" margin={{ top: 4, right: 40, left: 10, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#e2e8f0', fontSize: 11 }} axisLine={false} tickLine={false} width={130} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v) => [f2(v) + ' SP/day', 'SP per available day']} />
              {M.team.spPerDayMedian != null && <ReferenceLine x={M.team.spPerDayMedian} stroke="#94a3b8" strokeDasharray="4 3" label={{ value: `team median ${f2(M.team.spPerDayMedian)}`, fill: '#94a3b8', fontSize: 10, position: 'top' }} />}
              <Bar dataKey="spPerDay" fill="#60a5fa" fillOpacity={0.8} radius={[0, 3, 3, 0]} maxBarSize={18}>
                <ErrorBar dataKey="err" width={4} strokeWidth={1.5} stroke="#cbd5e1" direction="x" />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Chart 2: Size mix */}
      <Card>
        <CardHeader title="Size mix by contributor" subtitle="What proportion of each person's completed tickets were small / medium / large (by story points). Contributors with no completed tickets in the window are omitted." right={<div style={{ display: 'flex', gap: 12, fontSize: 11 }}>{['Small', 'Medium', 'Large'].map(k => <span key={k} style={{ color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: SIZE_COLORS[k] }} />{k}</span>)}</div>} />
        {M.sizeMixData.length === 0 ? <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>No completed tickets in the window.</div> : (
        <ResponsiveContainer width="100%" height={Math.max(160, M.sizeMixData.length * 32)}>
          <BarChart data={M.sizeMixData} layout="vertical" stackOffset="expand" margin={{ top: 4, right: 20, left: 10, bottom: 0 }}>
            <XAxis type="number" tickFormatter={v => `${Math.round(v * 100)}%`} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: '#e2e8f0', fontSize: 11 }} axisLine={false} tickLine={false} width={130} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [v + ' tickets', n]} />
            <Bar dataKey="Small" stackId="a" fill={SIZE_COLORS.Small} /><Bar dataKey="Medium" stackId="a" fill={SIZE_COLORS.Medium} /><Bar dataKey="Large" stackId="a" fill={SIZE_COLORS.Large} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
        )}
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8 }}>Buckets: Small ≤ {f1(M.team.sizeCut[0])} SP · Medium ≤ {f1(M.team.sizeCut[1])} SP · Large &gt; {f1(M.team.sizeCut[1])} SP (team terciles).</div>
      </Card>

      {/* Chart 3: throughput over time */}
      <Card>
        <CardHeader title="Throughput over time — SP per available day by sprint" subtitle="One line per contributor, last 8 sprints. A break in a line means the person was not on the team that sprint; a point at zero means they were here and completed no pointed work. A person's own trend is more informative than comparisons between people." />
        {M.trend.data.length < 2 ? <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>Needs ≥2 completed sprints of history.</div> : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={M.trend.data} margin={{ top: 8, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<TrendTip names={M.trend.names} />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {/* no connectNulls — an absent sprint must read as a break, not as a straight line through it */}
              {M.trend.names.map((nm, i) => <Line key={nm} dataKey={nm} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={1.8} dot={{ r: 2 }} />)}
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Chart 4: difficulty cross-check */}
      <Card>
        <CardHeader title="Difficulty cross-check" subtitle={`x = SP per available day · y = cycle-time per SP (working days). Describes the work, not the person.${M.changelogLoaded ? ' Reopen/blocked rates in the table are from Jira change history.' : ' Reopen/blocked rates need change history (loading or unavailable).'}`} />
        {M.scatter.length < 2 ? <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>Not enough contributors clear the n≥10 gate.</div> : (
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ top: 10, right: 20, left: 6, bottom: 20 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" dataKey="x" name="SP/day" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} label={{ value: 'SP per available day →', position: 'insideBottom', offset: -8, fill: '#6b7280', fontSize: 11 }} />
              <YAxis type="number" dataKey="y" name="cycle/SP" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} label={{ value: 'cycle-time per SP (days) →', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }} />
              {M.team.spPerDayMedian != null && <ReferenceLine x={M.team.spPerDayMedian} stroke="rgba(148,163,184,0.4)" strokeDasharray="4 3" />}
              {M.team.cyclePerSPMedian != null && <ReferenceLine y={M.team.cyclePerSPMedian} stroke="rgba(148,163,184,0.4)" strokeDasharray="4 3" />}
              <Tooltip content={<ScatterTip />} cursor={{ strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.2)' }} />
              <Scatter data={M.scatter} fill="#60a5fa" fillOpacity={0.85}>
                <LabelList dataKey="name" position="right" offset={7} style={{ fill: '#cbd5e1', fontSize: 10.5 }} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, lineHeight: 1.6 }}>
          Quadrants (relative to team medians): <strong>low SP/day + high cycle/SP</strong> → work harder than its points suggest · <strong>low SP/day + low cycle/SP</strong> → lower volume that ran smoothly (check allocation/assignment) · <strong>high SP/day + high cycle/SP</strong> → carrying volume through friction · <strong>high SP/day + low cycle/SP</strong> → high volume, ran smoothly. Cycle time is {M.changelogLoaded ? 'first-in-progress→Done working days (from change history)' : 'Start→Done working days (approx.)'}.
        </div>
      </Card>

      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.7, padding: '14px 16px', background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 10 }}>
        {/* The framing statement now leads the panel rather than closing it — this line
            only holds the pointer to where the reasoning lives. */}
        Why throughput cannot rank people here, how each rate is derived, and every check that gates these numbers: <button onClick={() => setView('method')} className="tt-no-print" style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#93c5fd', textDecoration: 'underline', cursor: 'pointer' }}>Methodology</button>.
      </div>

      {showEmail && <TeamReportEmailModal M={M} meta={emailMeta} onClose={() => setShowEmail(false)} />}
      {allocModal}
    </div>
  );
}

const LINE_COLORS = ['#60a5fa', '#a855f7', '#22c55e', '#f59e0b', '#f87171', '#38bdf8', '#c084fc', '#84cc16', '#fb923c', '#e879f9', '#2dd4bf', '#facc15'];

// "not present" and "present, delivered nothing" are different facts and must never be
// collapsed into the same 0 on the chart or in the tooltip.
function TrendTip({ active, payload, label, names = [] }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload || {};
  const absent = row._absent || {};
  const colorOf = nm => { const i = names.indexOf(nm); return LINE_COLORS[(i < 0 ? 0 : i) % LINE_COLORS.length]; };
  const present = names.filter(nm => !absent[nm]);
  const away = names.filter(nm => absent[nm]);
  return (
    <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '9px 12px', fontSize: 12, maxWidth: 320 }}>
      <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 5 }}>{label}</div>
      {present.map(nm => (
        <div key={nm} style={{ color: colorOf(nm), display: 'flex', justifyContent: 'space-between', gap: 14 }}>
          <span>{nm}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{row[nm] != null ? `${f2(row[nm])} SP/day` : '0 SP/day'}</span>
        </div>
      ))}
      {away.length > 0 && (
        <div style={{ marginTop: 6, paddingTop: 5, borderTop: '1px solid rgba(255,255,255,0.1)', color: '#64748b', fontSize: 11, lineHeight: 1.5 }}>
          Not on the team this sprint: {away.join(', ')}
        </div>
      )}
    </div>
  );
}

function ScatterTip({ payload }) {
  if (!payload || !payload.length) return null; const p = payload[0].payload; if (!p?.name) return null;
  return <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '9px 12px', fontSize: 12 }}>
    <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{p.name}</div>
    <div style={{ color: '#94a3b8' }}>{f2(p.x)} SP/day · {f1(p.y)} d/SP cycle · n={p.n}</div>
  </div>;
}

function WhatThisMeans({ M, scopeLabel }) {
  const lines = [];
  lines.push(`Window: ${scopeLabel}. ${M.rows.length} contributor(s) active${M.suppressedNames.length ? `; ${M.suppressedNames.length} have normalised metrics suppressed (${M.suppressedNames.join(', ')})` : ''}.`);
  if (M.team.spPerDay != null) lines.push(`Team pace: ${f1(M.team.assessableSP)} SP delivered across ${f1(M.team.totalAllocDays)} available person-days — about ${f2(M.team.spPerDay)} SP per person-day. Both figures cover the ${M.assessableCount} assessable contributor(s) only${M.team.excludedSP > 0 ? `; a further ${f1(M.team.excludedSP)} SP was delivered by people who cannot be normalised` : ''}.`);
  if (M.presenceAdjusted.length) lines.push(`Presence varies: ${M.presenceAdjusted.map(p => `${p.name} ${p.present} of ${p.of}`).join(', ')} sprint(s). Their available days are counted only for the sprints they were present, so throughput is no longer a proxy for who was here longest.`);
  if (M.team.cycleDaysMedian != null) lines.push(`Flow: a typical ticket is ${f1(M.team.medianTicketSize)} SP and takes ${f1(M.team.cycleDaysMedian)} working days from first activity to Done (${f1(M.team.cyclePerSPMedian)} days per point), with ${M.team.wipMedian != null ? f1(M.team.wipMedian) : '—'} tickets in flight per person at a time. This is a property of the process, not of individuals.`);
  if (M.quietNames.length) lines.push(`${M.quietNames.join(', ')} ${M.quietNames.length > 1 ? 'were' : 'was'} present for the whole window and logging time, but completed pointed tickets in only a minority of sprints — check whether that work is being captured as tickets at all.`);
  if (M.littlesLaw?.breached) lines.push(`The queue holds ${f1(M.littlesLaw.observedWip)} open tickets per person against the ${f1(M.littlesLaw.impliedWip)} that the completion rate accounts for — roughly ${M.littlesLaw.stalledEstimate} tickets open but not moving. Cycle time only measures tickets that finished, so treat it as a best case.`);
  if (M.hoursPerSPSpread) lines.push(`Hours per delivered point range ${f1(M.hoursPerSPSpread[0])}–${f1(M.hoursPerSPSpread[1])}h between people — a ${f1(M.hoursPerSPSpread[1] / Math.max(M.hoursPerSPSpread[0], 0.01))}× spread. That is mostly the mix of pointed versus unpointed work each person carries, not a difference in speed.`);
  // Per-person capacity-share callouts used to live here. They carried a hedge longer than
  // the claim ("much of the difference can be assignment, support work, or leave"), which
  // means the sentence was not carrying information — the SP%/cap% column and the CI chart
  // say the same thing without pretending to interpret it.
  // difficulty divergence
  M.divergence.forEach(d => lines.push(`${d.name}'s tickets took longer per point than the team median (${f1(d.cyclePerSP)} vs ${f1(M.team.cyclePerSPMedian)} days/SP), which their point totals do not reflect.`));
  // logging caveat
  if (M.completenessSpread) { const [lo, hi] = M.completenessSpread; lines.push(`Logging completeness ranges ${pctI(lo * 100)}–${pctI(Math.min(hi, 1) * 100)}%${hi > 1.2 ? ' (some exceed 100% — their allocation is understated by the completed-SP measure)' : ''} between people — differences in logged hours mostly reflect logging habits, not effort.`); }

  return (
    <Card>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 8 }}>📊 What this means</div>
      <div style={{ display: 'grid', gap: 7 }}>{lines.map((l, i) => <div key={i} style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6 }}>{l}</div>)}</div>
    </Card>
  );
}

// ─── Engine ───────────────────────────────────────────────────────────────────
