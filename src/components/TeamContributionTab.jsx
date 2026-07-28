import React, { useMemo, useState, useEffect } from 'react';
import {
  BarChart, Bar, ScatterChart, Scatter, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine, Cell, ErrorBar, Legend,
} from 'recharts';
import { Users, AlertTriangle, Microscope } from 'lucide-react';
import { jiraService } from '../utils/jiraService';
import { loadEligibilityFromDB, pingDB } from '../utils/dbSync';

// ─── Accessors ────────────────────────────────────────────────────────────────
const getStatus   = t => t['Status'] || '';
const getSP       = t => parseFloat(t['Story Points']) || parseFloat(t['Story points']) || parseFloat(t['Custom field (Story Points)']) || 0;
const getSprint   = t => t['Sprint'] || t['G'] || '';
const getAssignee = t => t['Assignee'] || t['D'] || 'Unassigned';
const getProject  = t => t['Project'] || t['B'] || 'Unknown';
const getKey      = t => t['Key'] || t['Issue key'] || '';
const getType     = t => t['Issue Type'] || '';
const getLoggedSec = t => parseFloat(t['Time Spent']) || 0;
const getResolved = t => t['Resolved'] || t['Resolution Date'] || t._rawFields?.resolutiondate || null;
const getCreated  = t => t['Created'] || null;
const getStart    = t => t['Start date'] || t._rawFields?.customfield_10052 || null;

const ALLOWED_TYPES = ['story', 'task', 'bug'];
const SEC_PER_HOUR = 3600;
const ROUND_WORKLOG_SECS = new Set([3600, 14400, 28800]); // 1h / 4h / 8h
const normStatus = (s = '') => s.toLowerCase().trim();
const isDone = s => ['done', 'completed', 'closed', 'resolved'].includes(normStatus(s));

const f1 = n => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const f2 = n => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const pctI = n => (Number.isFinite(n) ? Math.round(n) : null);

// ─── Stats ────────────────────────────────────────────────────────────────────
function median(arr) { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function quantile(arr, q) { if (!arr.length) return NaN; const s = [...arr].sort((a, b) => a - b); const pos = (s.length - 1) * q, base = Math.floor(pos), r = pos - base; return s[base + 1] !== undefined ? s[base] + r * (s[base + 1] - s[base]) : s[base]; }
function bootstrapCI(items, statFn, resamples = 2000) {
  const n = items.length; if (n < 2) return [NaN, NaN];
  const stats = [];
  for (let r = 0; r < resamples; r++) { const s = new Array(n); for (let i = 0; i < n; i++) s[i] = items[Math.floor(Math.random() * n)]; const v = statFn(s); if (Number.isFinite(v)) stats.push(v); }
  if (!stats.length) return [NaN, NaN];
  return [quantile(stats, 0.025), quantile(stats, 0.975)];
}

// ─── Greek public holidays + working days (mirrors Sprint Health tab) ──────────
function getGreekHolidays(year) {
  const fixed = [`${year}-01-01`, `${year}-01-06`, `${year}-03-25`, `${year}-05-01`, `${year}-08-15`, `${year}-10-28`, `${year}-12-25`, `${year}-12-26`];
  const a = year % 4, b = year % 7, c = year % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, month - 1, day + 13));
  const addDays = (date, n) => { const x = new Date(date); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const movable = [addDays(easter, -48), addDays(easter, -2), easter.toISOString().slice(0, 10), addDays(easter, 1), addDays(easter, 50)];
  return new Set([...fixed, ...movable]);
}
function workingDaysBetween(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate), end = new Date(endDate);
  start.setUTCHours(0, 0, 0, 0); end.setUTCHours(0, 0, 0, 0);
  if (end <= start) return 0;
  const holidays = new Set();
  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++) getGreekHolidays(y).forEach(h => holidays.add(h));
  let count = 0; const cur = new Date(start); cur.setUTCDate(cur.getUTCDate() + 1);
  while (cur <= end) { const dow = cur.getUTCDay(); const iso = cur.toISOString().slice(0, 10); if (dow !== 0 && dow !== 6 && !holidays.has(iso)) count++; cur.setUTCDate(cur.getUTCDate() + 1); }
  return count;
}
// working days between two dates for cycle time (inclusive-ish), non-negative
function cycleWorkingDays(a, b) { if (!a || !b) return null; const wd = workingDaysBetween(a, b); return wd >= 0 ? wd : null; }

function parseSprintDates(name) {
  const m = name?.match(/(\d{2}-\d{2}-\d{2})\s+to\s+(\d{2}-\d{2}-\d{2})/);
  if (m) { const p = s => { const [d, mo, y] = s.split('-'); return new Date(`20${y}-${mo}-${d}`); }; return { start: p(m[1]), end: p(m[2]) }; }
  return null;
}
const shortSprint = name => (name || 'No Sprint').replace(/Sprint\s*/i, 'S').replace(/\s+\d{2}-\d{2}-\d{2}\s+to\s+\d{2}-\d{2}-\d{2}/, '');

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
  const [sortCol, setSortCol] = useState('name');   // default alphabetical — NOT a metric
  const [sortDir, setSortDir] = useState('asc');
  const [splitByHours, setSplitByHours] = useState(false); // section 2 toggle (contaminated)
  const [wl, setWl] = useState({ status: 'idle', byKey: null });

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
    const workingDaysInWindow = windowSprints.reduce((a, w) => a + workingDaysBetween(w.start, w.end), 0);
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

  // ── Completed pointed tickets credited to the window; and hours-bearing tickets ──
  const { completedTickets, worklogKeys } = useMemo(() => {
    const allow = new Set(ALLOWED_TYPES);
    const completedTickets = scoped.filter(t => {
      const type = getType(t).toLowerCase();
      if (type === 'epic' || !allow.has(type)) return false;
      if (!isDone(getStatus(t)) || getSP(t) <= 0) return false;
      return windowSet.has(attrSprintOf(t));
    });
    // hours: any ticket in scope with logged time updated within/after the window span
    const worklogKeys = new Set(completedTickets.map(getKey));
    if (windowStart) for (const t of scoped) {
      if (getLoggedSec(t) <= 0) continue;
      const u = t['Updated'] ? new Date(t['Updated']) : null;
      if (!u || isNaN(u) || u >= windowStart) worklogKeys.add(getKey(t));
    }
    return { completedTickets, worklogKeys: [...worklogKeys].filter(Boolean) };
  }, [scoped, windowSet, attrSprintOf, windowStart]);

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

  // Allocation: windowed completed-SP share on the project (logging-immune) → eligibility fallback → null
  const allocationPctOf = useMemo(() => {
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
    return name => {
      if (selectedProject === 'all') return 1;
      const tp = totalByName[name] || 0, pp = projByName[name] || 0;
      if (tp > 0 && pp > 0) return pp / tp;
      const elig = eligibility[name];
      if (elig && elig.length) return 1 / (elig.includes(selectedProject) ? elig.length : elig.length + 1);
      return null; // unknown
    };
  }, [tickets, selectedProject, windowStart, windowEnd, eligibility]);

  const M = useMemo(
    () => computeTeam({ completedTickets, worklog: wl.status === 'loaded' ? wl.byKey : null, allocationPctOf, windowSprints, workingDaysInWindow, windowStart, windowEnd, hoursPerDay, attrSprintOf, windowFor, splitByHours }),
    [completedTickets, wl.byKey, wl.status, allocationPctOf, windowSprints, workingDaysInWindow, windowStart, windowEnd, hoursPerDay, attrSprintOf, windowFor, splitByHours]
  );

  const scopeLabel = [`last ${windowN} completed sprints`, selectedProject !== 'all' ? selectedProject : 'all projects'].join(' · ');

  // sorting (alphabetical default; metric sort only on explicit click, no colour/rank)
  const sortedRows = useMemo(() => {
    const rows = [...M.rows];
    const val = r => {
      switch (sortCol) {
        case 'tickets': return r.tickets; case 'sp': return r.sp; case 'hours': return r.hours;
        case 'spPerDay': return r.spPerDay ?? -1; case 'medianSize': return r.medianSize ?? -1;
        case 'shareSP': return r.shareSP; case 'completeness': return r.completeness ?? -1;
        default: return null;
      }
    };
    rows.sort((a, b) => sortCol === 'name' ? a.name.localeCompare(b.name) : (sortDir === 'asc' ? (val(a) - val(b)) : (val(b) - val(a))));
    return rows;
  }, [M.rows, sortCol, sortDir]);

  const onSort = col => { if (col === sortCol && col !== 'name') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir(col === 'name' ? 'asc' : 'desc'); } };
  const SortTh = ({ col, children, align = 'right' }) => (
    <th style={align === 'left' ? thL : thR}><button onClick={() => onSort(col)} style={{ background: 'none', border: 'none', color: sortCol === col ? '#e2e8f0' : '#6b7280', cursor: 'pointer', font: 'inherit', fontWeight: 600, padding: 0 }}>{children}{sortCol === col && col !== 'name' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>
  );

  const printBar = (
    <div className="tt-no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
      <button onClick={() => window.print()} style={btnGhost}>🖨 Print / Save as PDF</button>
    </div>
  );
  const printHeader = (
    <div className="tt-print-header"><div style={{ fontSize: 18, fontWeight: 800 }}>Team Contribution</div><div style={{ fontSize: 12 }}>{scopeLabel} · generated {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div></div>
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
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }} title="Comparison only — contaminated by logging discipline">
        <input type="checkbox" checked={splitByHours} onChange={e => setSplitByHours(e.target.checked)} /> split SP by logged-hours share
      </label>
    </div>
  );
  const scopeNote = (
    <div style={{ fontSize: 11.5, color: '#6b7280', margin: '0 2px 12px' }}>
      Scope: <strong style={{ color: '#94a3b8' }}>last {windowN} completed sprints</strong> for {selectedProject !== 'all' ? <strong style={{ color: '#94a3b8' }}>{selectedProject}</strong> : 'all projects'} (ignores the sprint & assignee filters). SP credited to the <strong style={{ color: '#94a3b8' }}>assignee at completion</strong>; hours to the <strong style={{ color: '#94a3b8' }}>worklog author</strong>. Working days exclude weekends and Greek public holidays.
    </div>
  );

  // gates for empty / loading
  if (!windowSprints.length) {
    return <div className="tt-print-root">{printBar}{printHeader}{controls}{scopeNote}<Card><div style={{ textAlign: 'center', padding: '28px 12px', color: '#94a3b8' }}>No completed sprints in the current window {selectedProject !== 'all' ? `for ${selectedProject}` : ''}.</div></Card></div>;
  }

  return (
    <div className="tt-print-root">
      {printBar}
      {printHeader}
      {controls}
      {scopeNote}

      {/* Standing data-quality banners */}
      <Banner color="#f59e0b" icon={<AlertTriangle size={15} />}>
        <strong>Leave not accounted for</strong> — approved-leave data isn't available, so contributors with time off in the window will show understated throughput. Adjust for known absences before drawing conclusions.
      </Banner>
      {splitByHours && (
        <Banner color="#ef4444" icon={<AlertTriangle size={15} />}>
          <strong>Split-SP mode is on (comparison only).</strong> Story points are split between contributors by their logged-hours share, which imports logging-discipline bias into the one metric that is otherwise immune to it. Do not use this as the primary view — untick to return to whole-credit at completion.
        </Banner>
      )}
      {wl.status === 'loading' && <Banner color="#60a5fa" icon={<Microscope size={15} />}>Loading worklogs for hours attribution… ({worklogKeys.length} tickets)</Banner>}
      {wl.status === 'error' && <Banner color="#ef4444" icon={<AlertTriangle size={15} />}>Worklog load failed — hours-based columns unavailable this session. {wl.error}</Banner>}
      {M.suppressedNames.length > 0 && (
        <Banner color="#64748b" icon="ℹ">Normalised metrics suppressed for {M.suppressedNames.length} contributor(s) — {M.suppressedNames.join(', ')} — due to too few completed pointed tickets (n&lt;10) or unknown allocation. Raw volume still shown.</Banner>
      )}

      {/* Team context */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <KpiTile label="Contributors" value={M.rows.length} sub={`active in the window`} color="#a855f7" />
        <KpiTile label="SP delivered (team)" value={f1(M.team.totalSP)} sub={`${M.team.totalTickets} completed tickets`} color="#60a5fa" />
        <KpiTile label="Available person-days" value={f1(M.team.totalAllocDays)} sub={`${workingDaysInWindow} working days × allocation`} color="#38bdf8" />
        <KpiTile label="Team SP / day" value={M.team.spPerDay != null ? f2(M.team.spPerDay) : '—'} sub={`team pace across the window`} color="#22c55e" />
      </div>

      <WhatThisMeans M={M} windowN={windowN} scopeLabel={scopeLabel} />

      {/* Main table */}
      <Card>
        <CardHeader title="Contributors" subtitle="Alphabetical by default. Click a header to sort — there is deliberately no rank, score, or good/bad colouring of people." />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 1100 }}>
            <thead>
              <tr style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 9.5 }}>
                <SortTh col="name" align="left">Contributor</SortTh>
                <th style={{ ...thR, borderLeft: '2px solid rgba(255,255,255,0.06)' }} colSpan={5}>Volume (raw)</th>
                <th style={{ ...thR, borderLeft: '2px solid rgba(96,165,250,0.25)' }} colSpan={4}>Normalised (size-adjusted)</th>
                <th style={{ ...thR, borderLeft: '2px solid rgba(255,255,255,0.06)', color: '#475569' }} colSpan={5}>Data quality</th>
              </tr>
              <tr style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 9.5 }}>
                <th style={thL}></th>
                <SortTh col="tickets">Tickets</SortTh><SortTh col="sp">SP</SortTh><SortTh col="hours">Hours</SortTh><th style={thR}>Worklogs</th><th style={thR}>Sprints</th>
                <SortTh col="spPerDay">SP/avail-day (95% CI)</SortTh><SortTh col="medianSize">Med size</SortTh><th style={thR}>Size mix</th><SortTh col="shareSP">SP% / cap%</SortTh>
                <SortTh col="completeness">Log %</SortTh><th style={{ ...thR, color: '#475569' }}>Round%</th><th style={{ ...thR, color: '#475569' }}>WL/tkt</th><th style={{ ...thR, color: '#475569' }}>Shared%</th><th style={{ ...thR, color: '#475569' }}>Carry%</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map(r => {
                const normBorder = { borderLeft: '2px solid rgba(96,165,250,0.25)' };
                const norm = r.suppressed
                  ? <td colSpan={4} style={{ ...tdR, ...normBorder, color: '#6b7280', fontStyle: 'italic' }}>{r.suppressReason}</td>
                  : <>
                      <td style={{ ...tdR, ...normBorder, color: '#93c5fd', fontWeight: 600 }}>{f2(r.spPerDay)}{Number.isFinite(r.spPerDayCI[0]) && <span style={{ color: '#6b7280', fontWeight: 400 }}> [{f2(r.spPerDayCI[0])}–{f2(r.spPerDayCI[1])}]</span>}</td>
                      <td style={{ ...tdR, color: '#c4b5fd' }}>{r.medianSize != null ? f1(r.medianSize) : '—'}</td>
                      <td style={{ ...tdR }}><div style={{ display: 'flex', justifyContent: 'flex-end' }}><SizeMix mix={r.sizeMix} /></div></td>
                      <td style={{ ...tdR, color: '#94a3b8' }}>{pctI(r.shareSP * 100)}% / {r.shareCap != null ? pctI(r.shareCap * 100) + '%' : '—'}</td>
                    </>;
                return (
                  <tr key={r.name} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ ...tdL, color: '#e2e8f0', fontWeight: 500, whiteSpace: 'nowrap' }}>
                      {r.name}
                      {r.sharedHigh && <span title="A large share of these points came from tickets multiple people worked on" style={{ marginLeft: 5, color: '#fbbf24' }}>◐</span>}
                      {r.allocUnknown && <span title="Allocation unknown — normalised metrics suppressed" style={{ marginLeft: 5, color: '#f97316' }}>⚠</span>}
                    </td>
                    <td style={{ ...tdR, borderLeft: '2px solid rgba(255,255,255,0.06)', color: '#e2e8f0' }}>{r.tickets}</td>
                    <td style={{ ...tdR, color: '#e2e8f0' }}>{f1(r.sp)}</td>
                    <td style={{ ...tdR, color: '#86efac' }}>{r.hours != null ? f1(r.hours) + 'h' : '—'}</td>
                    <td style={{ ...tdR, color: '#94a3b8' }}>{r.worklogCount ?? '—'}</td>
                    <td style={{ ...tdR, color: '#94a3b8' }}>{r.sprintsActive}</td>
                    {norm}
                    <td style={{ ...tdR, borderLeft: '2px solid rgba(255,255,255,0.06)', color: '#64748b' }} title={r.completeness > 1.2 ? 'Logged more than their allocated capacity — their allocation (from completed-SP share) is understated' : ''}>{r.completeness != null ? (r.completeness > 1.2 ? '>100%⚠' : pctI(r.completeness * 100) + '%') : '—'}</td>
                    <td style={{ ...tdR, color: '#64748b' }}>{r.roundShare != null ? pctI(r.roundShare * 100) + '%' : '—'}</td>
                    <td style={{ ...tdR, color: '#64748b' }}>{r.worklogsPerTicket != null ? f1(r.worklogsPerTicket) : '—'}</td>
                    <td style={{ ...tdR, color: '#64748b' }}>{r.sharedShare != null ? pctI(r.sharedShare * 100) + '%' : '—'}</td>
                    <td style={{ ...tdR, color: '#64748b' }}>{r.carryoverRate != null ? pctI(r.carryoverRate * 100) + '%' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 10, lineHeight: 1.6 }}>
          ◐ = ≥40% of credited SP came from multi-author tickets · ⚠ = allocation unknown (normalised suppressed). SP/avail-day is size-adjusted and immune to logging discipline; the bracket is a 95% bootstrap CI — where two people's brackets overlap, the difference is not distinguishable from noise. Hours and the muted data-quality columns describe logging habits, not effort.
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
        <CardHeader title="Size mix by contributor" subtitle="What proportion of each person's completed tickets were small / medium / large (by story points)." right={<div style={{ display: 'flex', gap: 12, fontSize: 11 }}>{['Small', 'Medium', 'Large'].map(k => <span key={k} style={{ color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 9, height: 9, borderRadius: 2, background: SIZE_COLORS[k] }} />{k}</span>)}</div>} />
        <ResponsiveContainer width="100%" height={Math.max(160, M.sizeMixData.length * 32)}>
          <BarChart data={M.sizeMixData} layout="vertical" stackOffset="expand" margin={{ top: 4, right: 20, left: 10, bottom: 0 }}>
            <XAxis type="number" tickFormatter={v => `${Math.round(v * 100)}%`} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: '#e2e8f0', fontSize: 11 }} axisLine={false} tickLine={false} width={130} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [v + ' tickets', n]} />
            <Bar dataKey="Small" stackId="a" fill={SIZE_COLORS.Small} /><Bar dataKey="Medium" stackId="a" fill={SIZE_COLORS.Medium} /><Bar dataKey="Large" stackId="a" fill={SIZE_COLORS.Large} radius={[0, 3, 3, 0]} />
          </BarChart>
        </ResponsiveContainer>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8 }}>Buckets: Small ≤ {f1(M.team.sizeCut[0])} SP · Medium ≤ {f1(M.team.sizeCut[1])} SP · Large &gt; {f1(M.team.sizeCut[1])} SP (team terciles).</div>
      </Card>

      {/* Chart 3: throughput over time */}
      <Card>
        <CardHeader title="Throughput over time — SP per available day by sprint" subtitle="One line per contributor, last 8 sprints. A person's own trend is more informative than comparisons between people." />
        {M.trend.data.length < 2 ? <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>Needs ≥2 completed sprints of history.</div> : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={M.trend.data} margin={{ top: 8, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [v != null ? f2(v) + ' SP/day' : '—', n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {M.trend.names.map((nm, i) => <Line key={nm} dataKey={nm} stroke={LINE_COLORS[i % LINE_COLORS.length]} strokeWidth={1.8} dot={{ r: 2 }} connectNulls />)}
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Chart 4: difficulty cross-check */}
      <Card>
        <CardHeader title="Difficulty cross-check" subtitle="x = SP per available day · y = cycle-time per SP (working days). Describes the work, not the person. Reopen/blocked rates need Jira change history (not fetched)." />
        {M.scatter.length < 2 ? <div style={{ padding: 24, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>Not enough contributors clear the n≥10 gate.</div> : (
          <ResponsiveContainer width="100%" height={340}>
            <ScatterChart margin={{ top: 10, right: 20, left: 6, bottom: 20 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.05)" />
              <XAxis type="number" dataKey="x" name="SP/day" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} label={{ value: 'SP per available day →', position: 'insideBottom', offset: -8, fill: '#6b7280', fontSize: 11 }} />
              <YAxis type="number" dataKey="y" name="cycle/SP" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} label={{ value: 'cycle-time per SP (days) →', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }} />
              {M.team.spPerDayMedian != null && <ReferenceLine x={M.team.spPerDayMedian} stroke="rgba(148,163,184,0.4)" strokeDasharray="4 3" />}
              {M.team.cyclePerSPMedian != null && <ReferenceLine y={M.team.cyclePerSPMedian} stroke="rgba(148,163,184,0.4)" strokeDasharray="4 3" />}
              <Tooltip content={<ScatterTip />} cursor={{ strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.2)' }} />
              <Scatter data={M.scatter} fill="#60a5fa" fillOpacity={0.8} />
            </ScatterChart>
          </ResponsiveContainer>
        )}
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, lineHeight: 1.6 }}>
          Quadrants (relative to team medians): <strong>low SP/day + high cycle/SP</strong> → work harder than its points suggest · <strong>low SP/day + low cycle/SP</strong> → lower volume that ran smoothly (check allocation/assignment) · <strong>high SP/day + high cycle/SP</strong> → carrying volume through friction · <strong>high SP/day + low cycle/SP</strong> → high volume, ran smoothly. Cycle time is Start→Done (or Created→Done) working days — an approximation of first-in-progress→Done.
        </div>
      </Card>

      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.7, padding: '14px 16px', background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 10 }}>
        <strong style={{ color: '#cbd5e1' }}>These figures describe delivered work, not individual capability.</strong> Throughput depends heavily on what work each person was assigned, how much of it was unpointed or support, and time not captured in Jira. Sample sizes here are small enough that most differences between people are within the margin of error. Use this to start conversations, not to conclude them.
      </div>
    </div>
  );
}

const LINE_COLORS = ['#60a5fa', '#a855f7', '#22c55e', '#f59e0b', '#f87171', '#38bdf8', '#c084fc', '#84cc16', '#fb923c', '#e879f9', '#2dd4bf', '#facc15'];

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
  if (M.team.spPerDay != null) lines.push(`Team pace: ${f1(M.team.totalSP)} SP delivered across ${f1(M.team.totalAllocDays)} available person-days — about ${f2(M.team.spPerDay)} SP per person-day.`);
  // capacity-vs-delivery framing, no ranking
  const framed = M.rows.filter(r => !r.suppressed && r.shareCap != null)
    .map(r => ({ r, gap: r.shareSP - r.shareCap }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 3);
  framed.forEach(({ r, gap }) => {
    if (Math.abs(gap) < 0.05) return;
    lines.push(`${r.name} holds ${pctI(r.shareCap * 100)}% of team capacity and delivered ${pctI(r.shareSP * 100)}% of points — ${gap > 0 ? 'above' : 'below'} their capacity share (much of the difference can be assignment, support work, or leave, not pace).`);
  });
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
function computeTeam({ completedTickets, worklog, allocationPctOf, windowSprints, workingDaysInWindow, windowStart, windowEnd, hoursPerDay, attrSprintOf, windowFor, splitByHours }) {
  const worklogsOf = key => (worklog && worklog.get(key)) || [];
  // authors set per ticket (for shared-work + medianContributors)
  const authorsOf = key => { const s = new Set(); for (const w of worklogsOf(key)) s.add(w.author); return s; };

  const people = {};
  const ensure = name => (people[name] ||= { name, tickets: 0, sp: 0, ticketSPs: [], sizeMix: { Small: 0, Medium: 0, Large: 0 }, sprints: new Set(), sharedSP: 0, carryTickets: 0, cyclePerSP: [], contributorsPerTicket: [], sec: 0, worklogCount: 0, roundCount: 0, logTickets: new Set() });

  // team size terciles from all completed ticket SPs
  const allSP = completedTickets.map(getSP);
  const sizeCut = [quantile(allSP, 1 / 3), quantile(allSP, 2 / 3)];
  const sizeBucket = sp => (sp <= sizeCut[0] ? 'Small' : sp <= sizeCut[1] ? 'Medium' : 'Large');

  for (const t of completedTickets) {
    const sp = getSP(t); const key = getKey(t);
    const authors = authorsOf(key);
    const sprint = attrSprintOf(t);
    // carryover + cycle are per-ticket, credited to whoever gets the ticket
    let carry = false;
    if (worklog) { const wins = new Set(); for (const w of worklogsOf(key)) { const win = w.started ? windowFor(w.started) : null; if (win) wins.add(win); } carry = wins.size > 1; }
    else { const raw = t._rawFields || {}; const sf = raw.customfield_10010 || raw.sprint; carry = Array.isArray(sf) && sf.length > 1; }
    const cyc = cycleWorkingDays(getStart(t) || getCreated(t), getResolved(t));

    // credit map: {name: spCredited}. Default whole to assignee; split mode → by logged-hours share.
    let credit;
    if (splitByHours && worklog && worklogsOf(key).length) {
      const bySec = {}; let tot = 0;
      for (const w of worklogsOf(key)) { bySec[w.author] = (bySec[w.author] || 0) + (w.seconds || 0); tot += w.seconds || 0; }
      credit = tot > 0 ? Object.fromEntries(Object.entries(bySec).map(([nm, s]) => [nm, sp * (s / tot)])) : { [getAssignee(t)]: sp };
    } else {
      credit = { [getAssignee(t)]: sp };
    }

    for (const [name, creditSP] of Object.entries(credit)) {
      const p = ensure(name);
      p.tickets += 1; p.sp += creditSP; p.ticketSPs.push(creditSP); p.sizeMix[sizeBucket(sp)] += 1;
      if (sprint) p.sprints.add(sprint);
      if (authors.size > 1) p.sharedSP += creditSP;
      p.contributorsPerTicket.push(authors.size || 1);
      if (carry) p.carryTickets += 1;
      if (cyc != null && sp > 0) p.cyclePerSP.push(cyc / sp);
    }
  }

  // ── hours by worklog author (any ticket, started in window) ──
  if (worklog) {
    for (const [key, wls] of worklog.entries()) {
      for (const w of wls) {
        const d = w.started ? new Date(w.started) : null;
        if (windowStart && windowEnd && (!d || isNaN(d) || d < windowStart || d > windowEnd)) continue;
        const p = ensure(w.author);
        p.sec += w.seconds || 0; p.worklogCount += 1; if (ROUND_WORKLOG_SECS.has(w.seconds)) p.roundCount += 1; p.logTickets.add(key);
      }
    }
  }

  // team totals for shares
  const names = Object.keys(people);
  let teamAllocDays = 0;
  const allocOf = {};
  for (const nm of names) { const a = allocationPctOf(nm); allocOf[nm] = a; if (a != null) teamAllocDays += workingDaysInWindow * a; }
  const totalSP = completedTickets.reduce((a, t) => a + getSP(t), 0);
  const totalTickets = completedTickets.length;

  const rows = names.map(nm => {
    const p = people[nm];
    const alloc = allocOf[nm];
    const allocUnknown = alloc == null;
    const allocDays = alloc != null ? workingDaysInWindow * alloc : null;
    const hours = worklog ? p.sec / SEC_PER_HOUR : null;
    const capacityHours = allocDays != null ? allocDays * hoursPerDay : null;
    const enoughN = p.tickets >= 10;
    const suppressed = !enoughN || allocUnknown;
    const spPerDay = (!suppressed && allocDays > 0) ? p.sp / allocDays : null;
    const spPerDayCI = (!suppressed && allocDays > 0 && p.ticketSPs.length >= 2)
      ? bootstrapCI(p.ticketSPs, s => s.reduce((a, b) => a + b, 0) / allocDays) : [NaN, NaN];
    const sharedShare = p.sp > 0 ? p.sharedSP / p.sp : null;
    return {
      name: nm,
      tickets: p.tickets, sp: p.sp, hours, worklogCount: worklog ? p.worklogCount : null, sprintsActive: p.sprints.size,
      spPerDay, spPerDayCI, medianSize: p.ticketSPs.length ? median(p.ticketSPs) : null, sizeMix: p.sizeMix,
      shareSP: totalSP > 0 ? p.sp / totalSP : 0,
      shareCap: (allocDays != null && teamAllocDays > 0) ? allocDays / teamAllocDays : null,
      completeness: (worklog && capacityHours > 0) ? (p.sec / SEC_PER_HOUR) / capacityHours : null,
      roundShare: (worklog && p.worklogCount > 0) ? p.roundCount / p.worklogCount : null,
      worklogsPerTicket: (worklog && p.logTickets.size > 0) ? p.worklogCount / p.logTickets.size : null,
      sharedShare, sharedHigh: sharedShare != null && sharedShare >= 0.40,
      carryoverRate: p.tickets > 0 ? p.carryTickets / p.tickets : null,
      cyclePerSP: p.cyclePerSP.length ? median(p.cyclePerSP) : null,
      medianContributors: p.contributorsPerTicket.length ? median(p.contributorsPerTicket) : null,
      suppressed, allocUnknown, suppressReason: allocUnknown ? 'allocation unknown' : `n=${p.tickets} of 10`,
      _allocDays: allocDays,
    };
  });

  // team-level normalised aggregates
  const normRows = rows.filter(r => !r.suppressed && r.spPerDay != null);
  const spPerDayMedian = normRows.length ? median(normRows.map(r => r.spPerDay)) : null;
  const cyclePerSPMedian = normRows.length ? median(normRows.filter(r => r.cyclePerSP != null).map(r => r.cyclePerSP)) : null;
  const spPerDay = teamAllocDays > 0 ? totalSP / teamAllocDays : null;

  const suppressedNames = rows.filter(r => r.suppressed).map(r => r.name);

  // chart data (normalised rows only, alphabetical)
  const barData = normRows.slice().sort((a, b) => a.name.localeCompare(b.name)).map(r => ({
    name: r.name, spPerDay: f2(r.spPerDay),
    err: [Number.isFinite(r.spPerDayCI[0]) ? f2(r.spPerDay) - f2(r.spPerDayCI[0]) : 0, Number.isFinite(r.spPerDayCI[1]) ? f2(r.spPerDayCI[1]) - f2(r.spPerDay) : 0],
  }));
  const sizeMixData = rows.slice().sort((a, b) => a.name.localeCompare(b.name)).map(r => ({ name: r.name, ...r.sizeMix }));
  const scatter = normRows.filter(r => r.cyclePerSP != null).map(r => ({ name: r.name, x: f2(r.spPerDay), y: f1(r.cyclePerSP), n: r.tickets }));

  // throughput over time: SP/available-day by sprint per (normalised) person, last 8 sprints
  const trendSprints = windowSprints.slice(-8);
  const trendNames = normRows.map(r => r.name);
  const spBySprintPerson = {}; // sprint -> name -> sp
  for (const t of completedTickets) { const s = attrSprintOf(t); const nm = getAssignee(t); if (!s) continue; (spBySprintPerson[s] ||= {}); spBySprintPerson[s][nm] = (spBySprintPerson[s][nm] || 0) + getSP(t); }
  const trendData = trendSprints.map(w => {
    const row = { label: shortSprint(w.name) };
    const wd = workingDaysBetween(w.start, w.end);
    for (const nm of trendNames) {
      const alloc = allocOf[nm]; const days = (alloc != null) ? wd * alloc : null;
      const sp = spBySprintPerson[w.name]?.[nm] || 0;
      row[nm] = (days && days > 0) ? f2(sp / days) : null;
    }
    return row;
  });

  // divergence: normalised people whose cycle/SP notably exceeds team median while SP/day below
  const divergence = normRows.filter(r => r.cyclePerSP != null && cyclePerSPMedian != null && r.cyclePerSP > cyclePerSPMedian * 1.3 && spPerDayMedian != null && r.spPerDay < spPerDayMedian)
    .sort((a, b) => b.cyclePerSP - a.cyclePerSP).slice(0, 3)
    .map(r => ({ name: r.name, cyclePerSP: r.cyclePerSP }));

  const comps = rows.filter(r => r.completeness != null).map(r => r.completeness);
  const completenessSpread = comps.length >= 2 ? [Math.min(...comps), Math.max(...comps)] : null;

  return {
    rows, suppressedNames,
    team: { totalSP, totalTickets, totalAllocDays: teamAllocDays, spPerDay, spPerDayMedian, cyclePerSPMedian, sizeCut },
    barData, sizeMixData, scatter, divergence, completenessSpread,
    trend: { data: trendData, names: trendNames },
  };
}
