import React, { useMemo, useState, useEffect } from 'react';
import {
  ScatterChart, Scatter, ComposedChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { Gauge, Layers, Activity, Target, AlertTriangle, Microscope, Users } from 'lucide-react';
import { jiraService } from '../utils/jiraService';
import { loadEligibilityFromDB, pingDB } from '../utils/dbSync';

// ─── Jira field accessors ─────────────────────────────────────────────────────
const getStatus   = t => t['Status'] || '';
const getSP       = t => parseFloat(t['Story Points']) || parseFloat(t['Story points']) || parseFloat(t['Custom field (Story Points)']) || 0;
const getSprint   = t => t['Sprint'] || t['G'] || '';
const getAssignee = t => t['Assignee'] || t['D'] || 'Unassigned';
const getProject  = t => t['Project'] || t['B'] || 'Unknown';
const getKey      = t => t['Key'] || t['Issue key'] || '';
const getSummary  = t => t['Summary'] || '';
const getType     = t => t['Issue Type'] || '';
const getLoggedSec = t => parseFloat(t['Time Spent']) || 0;
const getResolved = t => t['Resolved'] || t['Resolution Date'] || t._rawFields?.resolutiondate || null;

const SEC_PER_HOUR = 3600;
const toHours = sec => (sec || 0) / SEC_PER_HOUR;

// SP → day conversion is a *capacity-planning assumption*, not truth.
const DEFAULT_SP_PER_DAY = 2;
const DEFAULT_HOURS_PER_DAY = 8;

// Issue types pointed on the same scale (Spikes/Research deliberately excluded).
const ALLOWED_TYPES = ['story', 'task', 'bug'];

// ─── Status helpers ───────────────────────────────────────────────────────────
const normStatus = (s = '') => s.toLowerCase().trim();
const isDone = s => ['done', 'completed', 'closed', 'resolved'].includes(normStatus(s));

// ─── Number formatting ────────────────────────────────────────────────────────
const f1 = n => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const f2 = n => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const pctI = n => (Number.isFinite(n) ? Math.round(n) : null);
const ciTxt = (ci, unit = '') => (ci && Number.isFinite(ci[0]) && Number.isFinite(ci[1]) ? `95% CI ${f1(ci[0])}${unit}–${f1(ci[1])}${unit}` : '');

// ─── Statistics ───────────────────────────────────────────────────────────────
function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(arr, q) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
}
function meanOf(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN; }
function stdevSample(arr) {
  if (arr.length < 2) return NaN;
  const m = meanOf(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}
// Average ranks (1-based) with tie handling
function ranks(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}
function pearson(x, y) {
  const n = x.length;
  if (n < 2) return NaN;
  const mx = meanOf(x), my = meanOf(y);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; num += a * b; dx += a * a; dy += b * b; }
  const d = Math.sqrt(dx * dy);
  return d === 0 ? NaN : num / d;
}
function spearman(x, y) { return pearson(ranks(x), ranks(y)); }
// Percentile bootstrap CI. items: array; statFn: (resampledItems) => number
function bootstrapCI(items, statFn, resamples = 2000) {
  const n = items.length;
  if (n < 2) return [NaN, NaN];
  const stats = [];
  for (let r = 0; r < resamples; r++) {
    const s = new Array(n);
    for (let i = 0; i < n; i++) s[i] = items[Math.floor(Math.random() * n)];
    const v = statFn(s);
    if (Number.isFinite(v)) stats.push(v);
  }
  if (!stats.length) return [NaN, NaN];
  return [quantile(stats, 0.025), quantile(stats, 0.975)];
}
// Stable per-key jitter for the scatter (so points don't jump between renders)
function keyJitter(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 1000) / 1000 - 0.5) * 0.5;
}
// Business (Mon–Fri) days between two dates, inclusive of both ends.
function businessDays(start, end) {
  if (!start || !end) return 0;
  const a = new Date(start), b = new Date(end);
  a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0);
  if (b < a) return 0;
  let count = 0;
  const cur = new Date(a);
  while (cur <= b) { const d = cur.getDay(); if (d !== 0 && d !== 6) count++; cur.setDate(cur.getDate() + 1); }
  return count;
}
// Standard normal CDF (Abramowitz & Stegun 7.1.26)
function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}
// Mann–Kendall trend test on an ordered series → {S, z, p, trending, direction}
function mannKendall(values) {
  const nn = values.length;
  if (nn < 4) return { S: 0, z: 0, p: 1, trending: false, direction: 0 };
  let S = 0;
  for (let i = 0; i < nn - 1; i++) for (let j = i + 1; j < nn; j++) S += Math.sign(values[j] - values[i]);
  const varS = nn * (nn - 1) * (2 * nn + 5) / 18;
  const z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  return { S, z, p, trending: p < 0.10, direction: Math.sign(S) };
}
// Guess whether the SP field is a relative scale or day-denominated ideal-days
function detectScaleType(spValues) {
  return spValues.some(v => v > 0 && v < 1) ? 'ideal_days' : 'relative';
}
const ROUND_WORKLOG_SECS = new Set([3600, 14400, 28800]); // 1h / 4h / 8h (=1d default)

// ─── Sprint date parsing ──────────────────────────────────────────────────────
function parseSprintDates(name) {
  const m = name?.match(/(\d{2}-\d{2}-\d{2})\s+to\s+(\d{2}-\d{2}-\d{2})/);
  if (m) {
    const parse = s => { const [d, mo, y] = s.split('-'); return new Date(`20${y}-${mo}-${d}`); };
    return { start: parse(m[1]), end: parse(m[2]) };
  }
  return null;
}
function sprintState(name, today) {
  const dates = parseSprintDates(name);
  if (!dates) return 'unknown';
  if (today < dates.start) return 'future';
  if (today > dates.end) return 'past';
  return 'active';
}
function shortSprintLabel(name) {
  return (name || 'No Sprint')
    .replace(/Sprint\s*/i, 'S')
    .replace(/\s+\d{2}-\d{2}-\d{2}\s+to\s+\d{2}-\d{2}-\d{2}/, '');
}

// ─── Shared UI ────────────────────────────────────────────────────────────────
function Card({ children, style = {} }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 22px', marginBottom: 16, ...style }}>
      {children}
    </div>
  );
}
function CardHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16, flexWrap: 'wrap' }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}
function Banner({ color, icon, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 14px', background: `${color}12`, border: `1px solid ${color}40`, borderRadius: 10, marginBottom: 14, fontSize: 12.5, color: '#e2e8f0', lineHeight: 1.55 }}>
      <span style={{ color, flexShrink: 0, marginTop: 1 }}>{icon}</span>
      <div>{children}</div>
    </div>
  );
}
const TOOLTIP_STYLE = {
  contentStyle: { background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#e2e8f0' },
  itemStyle: { color: '#94a3b8' },
};
function KpiTile({ icon: Icon, label, value, sub, color = '#60a5fa' }) {
  return (
    <div style={{ flex: '1 1 170px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '15px 17px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 12, marginBottom: 7 }}>
        {Icon && <Icon size={14} style={{ color }} />}{label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 4, lineHeight: 1.5 }}>{sub}</div>}
    </div>
  );
}

const btnPrimary = { background: '#3b82f6', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#fff' };
const btnGhost = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '7px 13px', cursor: 'pointer', fontSize: 12, color: '#94a3b8' };

const thL = { textAlign: 'left', padding: '8px 10px', fontWeight: 600 };
const thR = { textAlign: 'right', padding: '8px 10px', fontWeight: 600 };
const tdL = { textAlign: 'left', padding: '9px 10px' };
const tdR = { textAlign: 'right', padding: '9px 10px', fontVariantNumeric: 'tabular-nums' };

// ─── Main component ───────────────────────────────────────────────────────────
export default function TimeTrackingTab({ tickets = [], selectedAssignee = 'all', selectedProject = 'all' }) {
  const today = useMemo(() => new Date(), []);
  const isDev = !!(import.meta.env && import.meta.env.DEV);

  // Capacity-planning assumption (persisted). NOT treated as truth — only overlaid for the gap.
  const [spPerDay, setSpPerDay] = useState(() => {
    const v = parseFloat(localStorage.getItem('tt_spPerDay'));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_SP_PER_DAY;
  });
  const [hoursPerDay, setHoursPerDay] = useState(() => {
    const v = parseFloat(localStorage.getItem('tt_hoursPerDay'));
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_HOURS_PER_DAY;
  });
  const [typeMode, setTypeMode] = useState('pool'); // 'pool' | 'story' | 'task' | 'bug'
  const [windowN, setWindowN] = useState(() => {
    const v = parseInt(localStorage.getItem('tt_windowN'), 10);
    return [3, 6, 12].includes(v) ? v : 6;
  });
  const [preview, setPreview] = useState(false); // dev-only: render metrics below threshold
  // Scale semantics (B): 'relative' (Fibonacci etc.) vs 'ideal_days' (SP is day-denominated)
  const [scaleType, setScaleType] = useState(() => localStorage.getItem('tt_scaleType') || 'auto');
  const [hoursPerIdealDay, setHoursPerIdealDay] = useState(() => {
    const v = parseFloat(localStorage.getItem('tt_hoursPerIdealDay'));
    return Number.isFinite(v) && v > 0 ? v : 8;
  });
  const [missFloorH, setMissFloorH] = useState(2);   // E: absolute-error floor for the misses list
  const [missSort, setMissSort] = useState('abs');   // 'abs' | 'ratio'
  const upd = (setter, keyName) => v => { const n = parseFloat(v); if (Number.isFinite(n) && n > 0) { setter(n); localStorage.setItem(keyName, String(n)); } };
  const setWindow = n => { setWindowN(n); localStorage.setItem('tt_windowN', String(n)); };
  const setScale = v => { setScaleType(v); localStorage.setItem('tt_scaleType', v); };

  // Worklog-level data (fetched on demand). status: idle | loading | loaded | error
  const [wl, setWl] = useState({ status: 'idle', byKey: null, error: null, errorsCount: 0, truncated: false });

  // Allocation from the Allocation tab (eligibility map: { assignee: [projectKeys] }).
  // Seeded from localStorage (written by AllocationTab), refined from the DB when reachable.
  const [eligibility, setEligibility] = useState(() => {
    try { const raw = localStorage.getItem('assigneeEligibility'); return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (await pingDB()) {
          const db = await loadEligibilityFromDB();
          if (db && Object.keys(db).length && !cancelled) setEligibility(db);
        }
      } catch { /* offline — localStorage seed stands */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const planningHoursPerSP = hoursPerDay / spPerDay;
  const worklog = wl.status === 'loaded' ? { byKey: wl.byKey } : null;

  // Apply assignee/project filters here (the global SPRINT filter is deliberately ignored)
  const scoped = useMemo(() => tickets.filter(t => {
    if (selectedAssignee !== 'all' && getAssignee(t) !== selectedAssignee) return false;
    if (selectedProject !== 'all' && getProject(t) !== selectedProject) return false;
    return true;
  }), [tickets, selectedAssignee, selectedProject]);

  const cfg = { spPerDay, hoursPerDay, planningHoursPerSP, scaleType, hoursPerIdealDay, eligibility, selectedProject };
  const M = useMemo(
    () => computeMetrics(scoped, today, typeMode, cfg, worklog, windowN, preview && isDev),
    // worklog derived from wl.byKey/wl.status; cfg is a fresh object each render so its primitives are listed instead
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scoped, today, typeMode, spPerDay, hoursPerDay, scaleType, hoursPerIdealDay, eligibility, selectedProject, wl.byKey, wl.status, windowN, preview, isDev]
  );
  const effScaleType = M.scaleType; // resolved (auto → detected)

  async function loadWorklogs() {
    try {
      setWl(s => ({ ...s, status: 'loading', error: null }));
      const keys = M.sampleKeys || [];
      const res = await jiraService.getWorklogs(keys);
      const byKey = new Map();
      for (const w of res.worklogs) {
        if (!byKey.has(w.issueKey)) byKey.set(w.issueKey, []);
        byKey.get(w.issueKey).push(w);
      }
      setWl({ status: 'loaded', byKey, error: null, errorsCount: res.errors?.length || 0, truncated: !!res.truncatedKeyList });
    } catch (e) {
      setWl(s => ({ ...s, status: 'error', error: e.message || String(e) }));
    }
  }

  const scopeLabel = [
    `last ${windowN} completed sprints`,
    selectedProject !== 'all' ? selectedProject : null,
    selectedAssignee !== 'all' ? selectedAssignee : null,
  ].filter(Boolean).join(' · ');

  const typeLabel = typeMode === 'pool' ? 'Story + Task + Bug' : typeMode[0].toUpperCase() + typeMode.slice(1);
  const allocLabel = M.allocationAssumed
    ? 'assumes full allocation — verify'
    : `allocation from Allocation tab (~${M.effectiveFTE} FTE of ${M.numContributors})${M.allocationPartial ? ', some defaulted to 100%' : ''}`;

  // ── Shared control bar ──
  const controls = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 18px', marginBottom: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>⚙ Estimation scope</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#94a3b8' }}>
        Window
        <select value={windowN} onChange={e => setWindow(parseInt(e.target.value, 10))}
          style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}>
          <option value={3}>Last 3 completed sprints</option>
          <option value={6}>Last 6 completed sprints</option>
          <option value={12}>Last 12 completed sprints</option>
        </select>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#94a3b8' }}>
        Issue types
        <select value={typeMode} onChange={e => setTypeMode(e.target.value)}
          style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}>
          <option value="pool">Story + Task + Bug (pooled)</option>
          <option value="story">Story only</option>
          <option value="task">Task only</option>
          <option value="bug">Bug only</option>
        </select>
      </label>
      {isDev && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#fbbf24' }} title="Dev only — renders metrics below n=30 with a NOT RELIABLE badge">
          <input type="checkbox" checked={preview} onChange={e => setPreview(e.target.checked)} />
          Preview &lt;30 (dev)
        </label>
      )}
      <span style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.12)' }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>Capacity assumption</span>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
        <input type="number" min="0.1" step="0.5" value={spPerDay} onChange={e => upd(setSpPerDay, 'tt_spPerDay')(e.target.value)}
          style={{ width: 56, background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#e2e8f0', padding: '5px 8px', fontSize: 13 }} />
        SP/day
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
        <input type="number" min="0.5" step="0.5" value={hoursPerDay} onChange={e => upd(setHoursPerDay, 'tt_hoursPerDay')(e.target.value)}
          style={{ width: 56, background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#e2e8f0', padding: '5px 8px', fontSize: 13 }} />
        h/day
      </label>
      <span style={{ fontSize: 12, color: '#e2e8f0' }}>= <strong>{f1(planningHoursPerSP)} h/SP</strong> planning constant</span>
      <span style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.12)' }} />
      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }} title="Confirm how the SP field is denominated — do not leave on a wrong guess">
        Scale
        <select value={scaleType} onChange={e => setScale(e.target.value)}
          style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}>
          <option value="auto">Auto — detected: {M.detectedScale === 'ideal_days' ? 'ideal-days' : 'relative'}</option>
          <option value="relative">Relative (Fibonacci)</option>
          <option value="ideal_days">Ideal-days</option>
        </select>
      </label>
      {effScaleType === 'ideal_days' && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
          <input type="number" min="0.5" step="0.5" value={hoursPerIdealDay} onChange={e => upd(setHoursPerIdealDay, 'tt_hoursPerIdealDay')(e.target.value)}
            style={{ width: 56, background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#e2e8f0', padding: '5px 8px', fontSize: 13 }} />
          h/ideal-day
        </label>
      )}
    </div>
  );

  // B3/B4 — contradiction between the capacity constant and a day-denominated scale
  const scaleContradiction = effScaleType === 'ideal_days' && Math.abs(planningHoursPerSP - hoursPerIdealDay) / hoursPerIdealDay > 0.15 && (
    <Banner color="#f97316" icon={<AlertTriangle size={15} />}>
      <strong>Config contradiction.</strong> The SP field is set to <em>ideal-days</em> (1 SP ≈ {f1(hoursPerIdealDay)}h of ideal work), but the capacity constant is <strong>{f1(planningHoursPerSP)} h/SP</strong> ({f1(spPerDay)} SP/day × {f1(hoursPerDay)} h/day). One SP can't be both a full day and {f1(planningHoursPerSP)}h. Confirm the scale with the team that set it before trusting either number.
    </Banner>
  );

  const scopeNote = (
    <div style={{ fontSize: 11.5, color: '#6b7280', margin: '0 2px 14px' }}>
      Scope: <strong style={{ color: '#94a3b8' }}>last {windowN} completed sprints</strong> (ignores the sprint filter), tickets attributed by <strong style={{ color: '#94a3b8' }}>resolution date</strong>, {effScaleType === 'ideal_days' ? 'ideal-days scale' : 'relative scale'}. {M.worklogMode ? <>Tickets filtered by <strong style={{ color: '#94a3b8' }}>assignee</strong>; hours attributed by <strong style={{ color: '#94a3b8' }}>worklog author</strong>.</> : 'Ticket-level hours (assignee).'} Estimation quality is a trailing property of practice, measured across sprints, not within one.
    </div>
  );

  // ── Worklog-level load bar ──
  const worklogBar = M.n > 0 && (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: wl.status === 'loaded' ? 'rgba(34,197,94,0.06)' : 'rgba(96,165,250,0.06)', border: `1px solid ${wl.status === 'loaded' ? 'rgba(34,197,94,0.28)' : 'rgba(96,165,250,0.28)'}`, borderRadius: 12, padding: '12px 18px', marginBottom: 16 }}>
      <Microscope size={18} style={{ color: wl.status === 'loaded' ? '#22c55e' : '#60a5fa', flexShrink: 0 }} />
      {wl.status === 'loaded' ? (
        <>
          <span style={{ fontSize: 12.5, color: '#e2e8f0' }}>
            <strong>Worklog-level mode.</strong> {M.totalWorklogs} worklogs · {M.worklogCoverage}% of sampled tickets covered · attributed by author &amp; date.
            {M.roundNumberBias !== null && <> Round numbers: <strong style={{ color: M.roundNumberBias > 50 ? '#fca5a5' : '#86efac' }}>{M.roundNumberBias}%</strong>.</>}
            {wl.errorsCount > 0 && <span style={{ color: '#fcd34d' }}> {wl.errorsCount} ticket(s) failed to load.</span>}
          </span>
          <button onClick={loadWorklogs} style={btnGhost}>↻ Refresh</button>
        </>
      ) : wl.status === 'loading' ? (
        <span style={{ fontSize: 12.5, color: '#93c5fd' }}>Fetching individual worklogs for {M.sampleKeys.length} tickets… this can take a few seconds.</span>
      ) : (
        <>
          <span style={{ fontSize: 12.5, color: '#cbd5e1' }}>
            Upgrade to <strong>worklog-level</strong> attribution: author &amp; per-date sprint windows, true carryover, and round-number bias. Fetches individual worklogs for {M.sampleKeys.length} sampled tickets.
          </span>
          <button onClick={loadWorklogs} style={btnPrimary}>🔬 Load worklog-level data</button>
          {wl.status === 'error' && <span style={{ fontSize: 12, color: '#fca5a5' }}>Failed: {wl.error}</span>}
        </>
      )}
    </div>
  );

  // ── Data-quality banners (mode-aware) ──
  const banners = (
    <>
      {M.n > 0 && M.worklogMode && M.roundNumberBias > 50 && (
        <Banner color="#f59e0b" icon={<AlertTriangle size={15} />}>
          <strong>{M.roundNumberBias}% of worklogs are round numbers (1h/4h/8h/1d).</strong> Logged time is being estimated at entry, not measured. Treat every hours figure here as coarse — precision beyond ~half a day is illusory.
        </Banner>
      )}
      {M.n > 0 && M.carryoverRate > 25 && (
        <Banner color="#f59e0b" icon={<AlertTriangle size={15} />}>
          <strong>{M.carryoverRate}% of sampled tickets span more than one sprint.</strong> {M.worklogMode
            ? 'Each ticket is credited to the sprint where most of its worklog time landed. Drift/backtest handle carryover from the actual worklog dates.'
            : 'Sprint attribution uses each ticket’s current sprint field, so carryover work is credited to its latest sprint. Load worklog-level data for date-accurate attribution.'}
        </Banner>
      )}
      {M.n > 0 && M.worklogMode && M.worklogsPerTicket !== null && M.worklogsPerTicket < 2 && (
        <Banner color="#f59e0b" icon={<AlertTriangle size={15} />}>
          <strong>Only {f1(M.worklogsPerTicket)} worklogs per ticket.</strong> With so few timestamps, sprint-window attribution by <em>worklog.started</em> has little to work with and carryover splitting is crude — most tickets resolve to a single date.
        </Banner>
      )}
      {M.n > 0 && !M.worklogMode && (
        <Banner color="#64748b" icon="ℹ">
          Ticket-level mode: worklogs attributed by each ticket’s <strong>assignee and sprint field</strong>, and round-number bias isn’t checked. Load worklog-level data above for author/date attribution.
        </Banner>
      )}
    </>
  );

  // ── Accumulation countdown (replaces the old "panel disabled" dead-end) ──
  if (M.accumulating) {
    return (
      <div>
        {controls}
        {scopeNote}
        {worklogBar}
        {banners}
        {scaleContradiction}
        <AccumulationView M={M} windowN={windowN} typeLabel={typeLabel} isDev={isDev} preview={preview} setPreview={setPreview} />
      </div>
    );
  }

  // ── Coverage gate (not an error — a data-quality stop) ──
  if (M.coverageGate) {
    return (
      <div>
        {controls}
        {scopeNote}
        {worklogBar}
        {banners}
        {scaleContradiction}
        <Card style={{ border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(245,158,11,0.05)' }}>
          <CardHeader title="Story Point Estimation Quality" subtitle={`${scopeLabel} · ${typeLabel}`} />
          <div style={{ textAlign: 'center', padding: '24px 12px' }}>
            <AlertTriangle size={26} style={{ color: '#f59e0b', marginBottom: 10 }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>Log coverage too low to measure ({M.logCoverage}%)</div>
            <div style={{ fontSize: 13, color: '#94a3b8', maxWidth: 580, margin: '0 auto', lineHeight: 1.6 }}>{M.coverageGate.detail}</div>
            <div style={{ display: 'flex', gap: 22, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
              <MiniStat label="Completed pointed tickets" value={M.eligibleN} />
              <MiniStat label="With logged time (n)" value={M.n} />
              <MiniStat label="Coverage / target" value={`${M.logCoverage}% / 70%`} />
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const discColor = M.discrimination >= 0.7 ? '#22c55e' : M.discrimination >= 0.4 ? '#f59e0b' : '#ef4444';
  const spreadColor = M.spreadFactor < 1.5 ? '#22c55e' : M.spreadFactor <= 2.0 ? '#f59e0b' : '#ef4444';

  return (
    <div>
      {controls}
      {scopeNote}
      {worklogBar}
      {banners}
        {scaleContradiction}

      {M.notReliable && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 10, padding: '10px 14px', marginBottom: 14 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: '#fff', background: '#dc2626', padding: '3px 8px', borderRadius: 5 }}>NOT RELIABLE — n={M.n}</span>
          <span style={{ fontSize: 12, color: '#fca5a5' }}>Dev preview: below the n≥30 / 70%-coverage threshold. Charts render for build/testing only; do not quote these numbers.</span>
        </div>
      )}

      {/* A1 — logging completeness suppression banner */}
      {M.suppressAbsolute && (
        <Banner color="#ef4444" icon={<AlertTriangle size={15} />}>
          <strong>Worklogs capture only {pctI(M.loggingCompleteness * 100)}% of working time ({allocLabel}).</strong> Absolute-hour conclusions are suppressed: no h/SP capacity recommendation, and MdAPE is not an accuracy claim. Use <strong>throughput</strong> (below) for capacity planning. The rank-based findings — discrimination, monotonicity, bucket overlap — are unaffected by uniform under-logging and remain valid.
        </Banner>
      )}

      {/* Headline metrics */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <KpiTile icon={Layers} label="Sample" value={`n=${M.n}`} sub={`completed, pointed, time-logged · ${M.logCoverage}% coverage`} color="#a855f7" />
        <KpiTile icon={Activity} label="Logging completeness" value={M.loggingCompleteness !== null ? `${pctI(M.loggingCompleteness * 100)}%` : '—'} sub={allocLabel} color={M.suppressAbsolute ? '#ef4444' : '#22c55e'} />
        <KpiTile icon={Gauge} label="Throughput" value={M.deliveredSPPerPersonDay ? `${f2(M.deliveredSPPerPersonDay)} SP/pd` : '—'} sub={M.throughputMultiple ? `assumption ${f1(M.throughputMultiple)}× observed · implies ${f1(M.impliedCapacityHoursPerSP)} h/SP` : 'completed SP per person-day'} color="#38bdf8" />
        <KpiTile icon={Gauge} label="Median h / SP" value={`${f1(M.medianHoursPerSP)}h`} sub={M.suppressAbsolute ? `recorded, not effort · IQR ${f1(M.iqr[0])}–${f1(M.iqr[1])}` : `IQR ${f1(M.iqr[0])}–${f1(M.iqr[1])}h · ${ciTxt(M.medianCI, 'h')}`} color="#60a5fa" />
        <KpiTile icon={Activity} label="Spread factor" value={`×${f1(M.spreadFactor)}`} sub={`typical ticket within this factor · ${ciTxt(M.spreadCI)}`} color={spreadColor} />
        <KpiTile icon={Target} label="Discrimination" value={f2(M.discrimination) ?? '—'} sub={`SP↔hours rank corr · ${ciTxt(M.discriminationCI)}`} color={discColor} />
        <KpiTile icon={Gauge} label="Hit rate (±50%)" value={`${pctI(M.hitRate)}%`} sub={`within ±50% of predicted · ${ciTxt(M.hitRateCI)}`} color="#22c55e" />
        <KpiTile icon={Activity} label="MdAPE (ticket-level)" value={`${pctI(M.mdape)}%`} sub={M.suppressAbsolute ? 'not an accuracy claim (under-logged)' : `in-sample · ${ciTxt(M.mdapeCI)}`} color="#f59e0b" />
        {M.estimateRatio && (
          <KpiTile icon={Target} label="Estimate ratio" value={`×${f1(M.estimateRatio.median)}`} sub={`logged ÷ (SP × ${f1(M.hoursPerIdealDay)}h ideal-day) · spread ×${f1(M.estimateRatio.spread)}`} color="#c084fc" />
        )}
      </div>

      <WhatThisMeans M={M} typeLabel={typeLabel} />

      {/* A2. Throughput — the capacity metric (logging-immune) */}
      {M.throughputRows.length > 0 && (
        <Card>
          <CardHeader
            title="Throughput — completed SP per person-day"
            subtitle={`Logging-immune capacity signal (completed points ÷ allocation-weighted person-days · ${allocLabel}). Blue line = your ${f1(M.spPerDay)} SP/day assumption.`}
            right={
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#6b7280', fontSize: 12 }}>Observed</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#38bdf8' }}>{f2(M.deliveredSPPerPersonDay)} SP/pd</div>
                {M.throughputMultiple && <div style={{ fontSize: 11, color: M.throughputMultiple > 1.3 ? '#fca5a5' : '#94a3b8' }}>assumption {f1(M.throughputMultiple)}× observed</div>}
              </div>
            }
          />
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={M.throughputRows} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [`${f2(v)} SP/pd`, n]} labelFormatter={l => l} />
              <ReferenceLine y={M.spPerDay} stroke="#3b82f6" strokeDasharray="5 3" label={{ value: `assumption ${f1(M.spPerDay)}`, fill: '#60a5fa', fontSize: 10, position: 'right' }} />
              <Bar dataKey="deliveredSPPerPersonDay" name="delivered SP/person-day" radius={[3, 3, 0, 0]} maxBarSize={40} fill="#38bdf8" fillOpacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
          <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 10 }}>
            This is the number the Capacity tab should consume — it needs only completed points and calendar days, so it survives incomplete worklogs. Implied capacity ≈ {f1(M.impliedCapacityHoursPerSP)} h/SP.
          </div>
        </Card>
      )}

      {/* A. Calibration scatter */}
      <Card>
        <CardHeader
          title="Calibration — logged hours vs story points"
          subtitle={`${scopeLabel} · log–log · ray = ${f1(M.medianHoursPerSP)} h/SP median, band = ±50% · ${M.worklogMode ? 'tickets filtered by assignee, hours attributed by worklog author' : 'ticket-level hours'}`}
          right={
            <div style={{ display: 'flex', gap: 14, fontSize: 11, alignItems: 'center' }}>
              {[['#22c55e', 'Within ±50%'], ['#f87171', 'Miss']].map(([c, l]) => (
                <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#9ca3af' }}>
                  <span style={{ width: 9, height: 9, borderRadius: '50%', background: c, display: 'inline-block' }} />{l}
                </span>
              ))}
            </div>
          }
        />
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.05)" />
            <XAxis type="number" dataKey="x" name="SP" scale="log" domain={M.scatter.xDomain} ticks={M.scatter.spValues} allowDataOverflow
              tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false}
              label={{ value: 'Story points (log)', position: 'insideBottom', offset: -4, fill: '#6b7280', fontSize: 11 }} />
            <YAxis type="number" dataKey="y" name="Hours" scale="log" domain={M.scatter.yDomain} allowDataOverflow
              tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false}
              label={{ value: 'Logged hours (log)', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }} />
            <Tooltip content={<ScatterTip />} cursor={{ strokeDasharray: '3 3', stroke: 'rgba(255,255,255,0.2)' }} />
            <Scatter data={M.scatter.bandHi} line={{ stroke: 'rgba(148,163,184,0.35)', strokeDasharray: '4 3' }} shape={() => <g />} isAnimationActive={false} legendType="none" />
            <Scatter data={M.scatter.bandLo} line={{ stroke: 'rgba(148,163,184,0.35)', strokeDasharray: '4 3' }} shape={() => <g />} isAnimationActive={false} legendType="none" />
            <Scatter data={M.scatter.ray} line={{ stroke: '#60a5fa', strokeWidth: 1.5 }} shape={() => <g />} isAnimationActive={false} legendType="none" />
            <Scatter data={M.scatter.hits} fill="#22c55e" fillOpacity={0.72} isAnimationActive={false} />
            <Scatter data={M.scatter.misses} fill="#f87171" fillOpacity={0.8} isAnimationActive={false} />
          </ScatterChart>
        </ResponsiveContainer>
      </Card>

      {/* Per-bucket table */}
      <BucketTable M={M} />

      {/* Contributors (worklog-level author attribution) */}
      {M.worklogMode && M.contributors.length > 0 && (
        <Card>
          <CardHeader title="Logged hours by contributor" subtitle="From worklog authors — corrects the multi-person misattribution of assignee-based views" right={<Users size={16} style={{ color: '#60a5fa' }} />} />
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 420 }}>
              <thead>
                <tr style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>
                  <th style={thL}>Contributor</th><th style={thR}>Hours logged</th><th style={thR}>Worklogs</th><th style={thR}>Share</th>
                </tr>
              </thead>
              <tbody>
                {M.contributors.map((c, i) => (
                  <tr key={c.name + i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ ...tdL, color: '#e2e8f0' }}>{c.name}</td>
                    <td style={{ ...tdR, color: '#86efac', fontWeight: 600 }}>{f1(c.hours)}h</td>
                    <td style={{ ...tdR, color: '#94a3b8' }}>{c.count}</td>
                    <td style={{ ...tdR, color: '#94a3b8' }}>{c.share}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* B. Calibration drift */}
      <Card>
        <CardHeader
          title="Calibration drift — median h/SP by sprint"
          subtitle={`${M.drift.length} of last 8 completed sprints${M.driftExcluded > 0 ? ` (${M.driftExcluded} excluded: n<5)` : ''}. Blue dashed line = capacity planning constant.`}
        />
        {M.driftTrend.trending && M.drift.length >= 3 && (
          <Banner color="#f59e0b" icon={<AlertTriangle size={15} />}>
            <strong>Rate is trending, not stationary</strong> (Mann–Kendall p={f2(M.driftTrend.p)}). A trailing {M.windowN}-sprint median systematically {M.driftTrend.direction < 0 ? 'over' : 'under'}-predicts. Use a shorter window or exponential weighting (α≈0.5).
            {M.windowN > 3 && <> <button onClick={() => setWindow(3)} style={{ ...btnGhost, marginLeft: 8, padding: '3px 10px' }}>Switch to 3-sprint window</button></>}
          </Banner>
        )}
        {M.drift.length < 3 ? (
          <Disabled msg={`Needs ≥3 completed sprints with ≥5 sampled tickets each (have ${M.drift.length}).`} />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={M.drift} margin={{ top: 8, right: 16, left: -14, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false}
                label={{ value: 'h / SP', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 11 }} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [`${f1(v)}h`, n === 'median' ? 'median h/SP' : n === 'p25' ? 'p25' : 'p75']} />
              <ReferenceLine y={M.planningHoursPerSP} stroke="#3b82f6" strokeDasharray="5 3"
                label={{ value: `planning ${f1(M.planningHoursPerSP)}`, fill: '#60a5fa', fontSize: 10, position: 'right' }} />
              <Line dataKey="p75" stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" dot={false} name="p75" opacity={0.6} />
              <Line dataKey="p25" stroke="#f59e0b" strokeWidth={1} strokeDasharray="3 3" dot={false} name="p25" opacity={0.6} />
              <Line dataKey="median" stroke="#22c55e" strokeWidth={2.5} dot={{ r: 3, fill: '#22c55e' }} name="median" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* C. Misses list (E — abs-error floor, sort toggle, placeholder flag) */}
      {(() => {
        const floored = M.missesAll.filter(o => o.absErr >= missFloorH);
        const sorted = [...floored].sort((a, b) => missSort === 'abs' ? b.absErr - a.absErr : Math.abs(b.logRatio) - Math.abs(a.logRatio));
        const top = sorted.slice(0, 10);
        const dropped = M.missesAll.length - floored.length;
        return (
          <Card>
            <CardHeader
              title="Biggest estimation misses"
              subtitle={`Top 10 by ${missSort === 'abs' ? 'absolute hours missed' : '|log-ratio|'} · excluding misses under ${missFloorH}h absolute error (${dropped} hidden)`}
              right={
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 11 }}>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {['abs', 'ratio'].map(s => (
                      <button key={s} onClick={() => setMissSort(s)} style={{ ...(missSort === s ? btnPrimary : btnGhost), padding: '4px 9px', fontSize: 11 }}>{s === 'abs' ? 'By hours' : 'By ratio'}</button>
                    ))}
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#94a3b8' }}>
                    floor
                    <input type="number" min="0" step="0.5" value={missFloorH} onChange={e => setMissFloorH(Math.max(0, parseFloat(e.target.value) || 0))}
                      style={{ width: 46, background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#e2e8f0', padding: '4px 6px', fontSize: 12 }} />h
                  </label>
                </div>
              }
            />
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 }}>
                <thead>
                  <tr style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>
                    <th style={thL}>Key</th><th style={thL}>Summary</th><th style={thL}>Assignee</th>
                    <th style={thR}>SP</th><th style={thR}>Logged</th><th style={thR}>Predicted</th><th style={thR}>Abs err</th><th style={thR}>Ratio</th>
                  </tr>
                </thead>
                <tbody>
                  {top.length === 0 ? (
                    <tr><td colSpan={8} style={{ ...tdL, color: '#6b7280', padding: '16px 10px' }}>No misses above the {missFloorH}h floor.</td></tr>
                  ) : top.map((o, i) => (
                    <tr key={o.key + i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ ...tdL, color: '#60a5fa', fontWeight: 500, whiteSpace: 'nowrap' }}>{o.key}</td>
                      <td style={{ ...tdL, color: '#e2e8f0', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.summary}>
                        {o.placeholder && <span title="Whole logged time is one round-number worklog — probably a placeholder, not a measurement" style={{ marginRight: 5 }}>⚠️</span>}{o.summary}
                      </td>
                      <td style={{ ...tdL, color: '#94a3b8', whiteSpace: 'nowrap' }}>{o.assignee}</td>
                      <td style={{ ...tdR, color: '#c4b5fd' }}>{o.sp}</td>
                      <td style={{ ...tdR, color: '#86efac', fontWeight: 600 }}>{f1(o.logged)}h</td>
                      <td style={{ ...tdR, color: '#94a3b8' }}>{f1(o.predicted)}h</td>
                      <td style={{ ...tdR, color: '#e2e8f0', fontWeight: 600 }}>{f1(o.absErr)}h</td>
                      <td style={{ ...tdR, color: o.logRatio > 0 ? '#fca5a5' : '#93c5fd', fontWeight: 600 }}>{o.logRatio > 0 ? '×' : '÷'}{f1(Math.exp(Math.abs(o.logRatio)))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {top.some(o => o.placeholder) && (
              <div style={{ fontSize: 11.5, color: '#fcd34d', marginTop: 10 }}>⚠️ = entire logged time is a single round-number worklog (1h/4h/8h) — likely a placeholder, not a measurement; don't let it drive the retro.</div>
            )}
          </Card>
        );
      })()}

      {/* Section 5. Out-of-sample backtest (D — dual base, sign consistency, n≥4 gate) */}
      <Card>
        <CardHeader
          title="Out-of-sample forecast test"
          subtitle="Each sprint predicted from PRIOR sprints' rate only. Committed base includes carryover; completed base is estimation error only."
          right={M.backtest.rows.length > 0 && (
            <div style={{ textAlign: 'right' }}>
              {M.backtest.enoughForHeadline ? (
                M.backtest.signConsistency === 1 ? (
                  <>
                    <div style={{ color: '#6b7280', fontSize: 12 }}>Systematic bias (sprint-level)</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#ef4444' }}>{M.backtest.systematicDir < 0 ? 'Over' : 'Under'}-predicting</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>median {pctI(M.backtest.medianError)}% · all {M.backtest.rows.length} same sign</div>
                  </>
                ) : (
                  <>
                    <div style={{ color: '#6b7280', fontSize: 12 }}>Backtest MdAPE (sprint-level)</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: M.backtest.mdape > 40 ? '#ef4444' : M.backtest.mdape > 20 ? '#f59e0b' : '#22c55e' }}>{pctI(M.backtest.mdape)}%</div>
                    <div style={{ fontSize: 11, color: '#94a3b8' }}>sign consistency {pctI(M.backtest.signConsistency * 100)}%</div>
                  </>
                )
              ) : (
                <>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#f59e0b' }}>{M.backtest.rows.length} of 4</div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>sprints needed for a headline</div>
                </>
              )}
            </div>
          )}
        />
        {M.backtest.rows.length === 0 ? (
          <Disabled msg="Needs ≥4 completed sprints (each forecast uses ≥3 prior sprints). Widen the window." />
        ) : (
          <>
            {!M.backtest.enoughForHeadline && (
              <Banner color="#f59e0b" icon={<AlertTriangle size={15} />}>
                Only {M.backtest.rows.length} evaluated sprint(s) — below the n≥4 gate. The table is shown, but no MdAPE headline: the median of {M.backtest.rows.length} same-signed error(s) is a bias estimate, not a dispersion. Widen the window for more history.
              </Banner>
            )}
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={M.backtest.rows} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip {...TOOLTIP_STYLE} formatter={v => [`${v >= 0 ? '+' : ''}${pctI(v)}%`, 'error (committed base)']} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
                <Bar dataKey="errorPct" radius={[3, 3, 0, 0]} maxBarSize={40}>
                  {M.backtest.rows.map((r, i) => (
                    <Cell key={i} fill={Math.abs(r.errorPct) > 25 ? '#ef4444' : '#22c55e'} opacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
                <thead>
                  <tr style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>
                    <th style={thL}>Sprint</th><th style={thR}>Prior rate</th><th style={thR}>Committed SP</th><th style={thR}>Completed SP</th>
                    <th style={thR}>Actual h</th><th style={thR} title="Forecast from committed SP — includes carryover effects">Err (committed)</th><th style={thR} title="Forecast from completed SP — estimation error only">Err (completed)</th>
                  </tr>
                </thead>
                <tbody>
                  {M.backtest.rows.map((r, i) => (
                    <tr key={r.sprint + i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ ...tdL, color: '#e2e8f0', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.sprint}>{r.sprint}</td>
                      <td style={{ ...tdR, color: '#94a3b8' }}>{f1(r.rate)}</td>
                      <td style={{ ...tdR, color: '#c4b5fd' }}>{f1(r.committedSP)}</td>
                      <td style={{ ...tdR, color: '#c4b5fd' }}>{f1(r.completedSP)}</td>
                      <td style={{ ...tdR, color: '#86efac', fontWeight: 600 }}>{f1(r.actual)}h</td>
                      <td style={{ ...tdR, color: r.errorPct !== null && Math.abs(r.errorPct) > 25 ? '#fca5a5' : '#94a3b8', fontWeight: 600 }}>{r.errorPct === null ? '—' : `${r.errorPct >= 0 ? '+' : ''}${pctI(r.errorPct)}%`}</td>
                      <td style={{ ...tdR, color: r.errorCompletedPct !== null && Math.abs(r.errorCompletedPct) > 25 ? '#fca5a5' : '#86efac', fontWeight: 600 }}>{r.errorCompletedPct === null ? '—' : `${r.errorCompletedPct >= 0 ? '+' : ''}${pctI(r.errorCompletedPct)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 10 }}>
              Sprint-level backtest error is expected to be lower than the {pctI(M.mdape)}% ticket-level in-sample MdAPE — ticket errors partially cancel on aggregation. Don't read the two as the same measure.
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────
function MiniStat({ label, value }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: '#e2e8f0' }}>{value}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{label}</div>
    </div>
  );
}
function Disabled({ msg }) {
  return <div style={{ padding: '28px 0', textAlign: 'center', color: '#6b7280', fontSize: 13 }}>{msg}</div>;
}

// Accumulation countdown — the sample maturing toward n=30, framed as progress not error
function AccumulationView({ M, windowN, typeLabel, isDev, preview, setPreview }) {
  const a = M.accumulating;
  const pct = Math.min(100, Math.round((M.n / 30) * 100));
  return (
    <Card style={{ border: '1px solid rgba(96,165,250,0.28)', background: 'rgba(96,165,250,0.05)' }}>
      <CardHeader
        title="Story Point Estimation Quality — accumulating"
        subtitle={`${typeLabel} · last ${windowN} completed sprints`}
        right={<div style={{ textAlign: 'right' }}><div style={{ fontSize: 22, fontWeight: 800, color: '#60a5fa' }}>{M.n}<span style={{ color: '#6b7280', fontSize: 14 }}> / 30</span></div><div style={{ fontSize: 11, color: '#6b7280' }}>sample tickets</div></div>}
      />

      {/* Progress bar */}
      <div style={{ height: 12, background: 'rgba(255,255,255,0.06)', borderRadius: 7, overflow: 'hidden', marginBottom: 10 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg,#3b82f6,#60a5fa)', transition: 'width 0.4s' }} />
      </div>
      <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.6, marginBottom: 16 }}>
        {a.perSprintEligible > 0 ? (
          <>At ~<strong>{f1(a.perSprintEligible)}</strong> eligible {typeLabel} tickets per completed sprint{a.coverage < 100 ? ` (~${f1(a.perSprintSample)} with logged time)` : ''}, you need roughly <strong>{a.sprintsNeeded}</strong> more completed sprint{a.sprintsNeeded === 1 ? '' : 's'} to reach a reliable n=30.</>
        ) : (
          <>No completed sprints with eligible tickets are in the current window yet.</>
        )}
      </div>

      {/* Contributing sprints */}
      {a.contributing.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Contributing — {a.contributing.length} completed sprint(s) in window</div>
          {a.contributing.map((s, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: '#94a3b8', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <span style={{ color: '#22c55e' }}>✓ {s.name}</span>
              <span>{s.sample} logged / {s.eligible} eligible</span>
            </div>
          ))}
        </div>
      )}

      {/* Excluded in-flight sprints */}
      {a.excluded.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Excluded — in progress</div>
          {a.excluded.map((s, i) => (
            <div key={i} style={{ fontSize: 12.5, color: '#fcd34d', padding: '3px 0' }}>
              ⏳ {s.name} excluded — still in progress{s.endLabel ? ` (ends ${s.endLabel})` : ''} · {s.eligible} eligible ticket(s) held back
            </div>
          ))}
        </div>
      )}

      {isDev && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16, fontSize: 12, color: '#fbbf24', cursor: 'pointer' }}>
          <input type="checkbox" checked={preview} onChange={e => setPreview(e.target.checked)} />
          Dev: preview metrics below threshold (renders with a NOT RELIABLE badge)
        </label>
      )}
    </Card>
  );
}
function ScatterTip({ payload }) {
  if (!payload || !payload.length) return null;
  const p = payload[0].payload;
  if (!p || !p.key) return null;
  return (
    <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '9px 12px', fontSize: 12, maxWidth: 280 }}>
      <div style={{ color: '#60a5fa', fontWeight: 600 }}>{p.key}</div>
      <div style={{ color: '#e2e8f0', margin: '3px 0', whiteSpace: 'normal' }}>{p.summary}</div>
      <div style={{ color: '#94a3b8' }}>{p.assignee} · {p.sp} SP · {f1(p.y)}h logged</div>
    </div>
  );
}

function BucketTable({ M }) {
  return (
    <Card>
      <CardHeader title="Per-story-point breakdown" subtitle="Do equal estimates take equal time, and do larger estimates reliably take longer?" />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 }}>
          <thead>
            <tr style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>
              <th style={thL}>SP</th><th style={thR}>n</th><th style={thR}>Median h</th><th style={thR}>IQR h</th>
              <th style={thR}>Median h/SP</th><th style={thR}>Spread</th><th style={thR}>Min–Max h</th>
            </tr>
          </thead>
          <tbody>
            {M.buckets.map(b => (
              <tr key={b.sp} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', opacity: b.enough ? 1 : 0.5 }}>
                <td style={{ ...tdL, color: '#c4b5fd', fontWeight: 700 }}>{b.sp}</td>
                <td style={{ ...tdR, color: '#94a3b8' }}>{b.n}</td>
                {b.enough ? (
                  <>
                    <td style={{ ...tdR, color: '#86efac', fontWeight: 600 }}>{f1(b.medianHours)}h</td>
                    <td style={{ ...tdR, color: '#94a3b8' }}>{f1(b.iqr[0])}–{f1(b.iqr[1])}h</td>
                    <td style={{ ...tdR, color: '#e2e8f0' }}>{f1(b.medianHoursPerSP)}h</td>
                    <td style={{ ...tdR, color: b.spreadFactor > 2 ? '#fca5a5' : b.spreadFactor < 1.5 ? '#86efac' : '#fcd34d' }}>×{f1(b.spreadFactor)}</td>
                    <td style={{ ...tdR, color: '#94a3b8' }}>{f1(b.minH)}–{f1(b.maxH)}h</td>
                  </>
                ) : (
                  <td colSpan={5} style={{ ...tdR, color: '#6b7280', fontStyle: 'italic' }}>n&lt;5 — too few to summarise</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* C3 — effective scale coverage */}
      {M.bucketCoverage && M.bucketCoverage.qualifying > 0 && (
        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 14, lineHeight: 1.6 }}>
          Discrimination is measured across <strong style={{ color: '#e2e8f0' }}>{M.bucketCoverage.qualifying} qualifying bucket{M.bucketCoverage.qualifying === 1 ? '' : 's'}</strong> (n≥5) spanning {M.bucketCoverage.spanLo}–{M.bucketCoverage.spanHi} SP, holding {M.bucketCoverage.ticketsInQualifying} of {M.n} tickets.
          {M.bucketCoverage.lowN.length > 0 && <> The {M.bucketCoverage.lowN.map(b => `${b.sp} (n=${b.n})`).join(' / ')} bucket{M.bucketCoverage.lowN.length === 1 ? '' : 's'} contribute to the correlation but not to per-bucket statistics — {M.bucketCoverage.lowNTickets} ticket{M.bucketCoverage.lowNTickets === 1 ? '' : 's'} carrying the top of the range invisibly.</>}
        </div>
      )}

      {/* Monotonicity (hours + rate) + overlap checks */}
      <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Monotonicity — median hours (do larger estimates take longer?)</div>
        {M.monotonic.length === 0 ? (
          <div style={{ fontSize: 12, color: '#6b7280' }}>Not enough adjacent buckets (n≥5) to check.</div>
        ) : M.monotonic.map((m, i) => (
          <div key={i} style={{ fontSize: 12.5, color: m.pass ? '#86efac' : '#fca5a5' }}>
            {m.pass ? '✓' : '✗'} {m.from} → {m.to}: {m.pass ? 'PASS' : `FAIL — ${m.detail}`}
          </div>
        ))}
        {M.monotonicRate && M.monotonicRate.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 8 }}>Monotonicity — median h/SP (a non-monotonic rate is what breaks forecasting)</div>
            {M.monotonicRate.map((m, i) => (
              <div key={i} style={{ fontSize: 12.5, color: m.pass ? '#86efac' : '#fca5a5' }}>
                {m.pass ? '✓' : '✗'} {m.from} → {m.to}: {m.pass ? 'PASS' : 'FAIL'} — {m.detail}
              </div>
            ))}
          </>
        )}
        {M.overlaps.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 8 }}>Adjacent-bucket overlap — are neighbouring sizes distinguishable?</div>
            {M.overlaps.map((o, i) => (
              <div key={i} style={{ fontSize: 12.5, color: o.pct > 30 ? '#fca5a5' : '#94a3b8' }}>
                {o.pct > 30 ? '⚠' : '·'} {o.pct}% of {o.to}-pointers took less than the {o.from}-pointer median
              </div>
            ))}
          </>
        )}
        {M.collapseText && M.collapseText.length > 0 && M.collapseText.map((t, i) => (
          <div key={`c${i}`} style={{ fontSize: 12.5, color: '#fcd34d', marginTop: 4, padding: '7px 10px', background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.25)', borderRadius: 7 }}>
            💡 {t}
          </div>
        ))}
      </div>
    </Card>
  );
}

function WhatThisMeans({ M, typeLabel }) {
  const lines = [];
  const suppressed = M.suppressAbsolute;
  const noise = M.spreadFactor > 2.0 || M.discrimination < 0.4;

  // 1. sample + completeness + flags
  const flagBits = M.worklogMode
    ? `worklog-level: ${M.totalWorklogs} worklogs, ${M.roundNumberBias}% round numbers${M.carryoverRate > 25 ? `, ${M.carryoverRate}% carried over` : ''}`
    : `ticket-level attribution; round-number bias not checked${M.carryoverRate > 25 ? `, ${M.carryoverRate}% carried over` : ''}`;
  const allocNote = M.allocationAssumed ? ' (assumes full allocation — verify)' : ` (allocation from Allocation tab, ~${M.effectiveFTE} FTE)`;
  lines.push(`Sample: ${M.n} completed, pointed, time-logged ${typeLabel} tickets (${M.logCoverage}% log coverage). ${flagBits}. Worklogs capture ~${M.loggingCompleteness !== null ? pctI(M.loggingCompleteness * 100) : '?'}% of working time${allocNote}.`);

  // 2. capacity from THROUGHPUT (logging-immune), not from logged h/SP
  if (M.deliveredSPPerPersonDay) {
    lines.push(`Capacity (from throughput, not worklogs): the team completes ~${f2(M.deliveredSPPerPersonDay)} SP per person-day, implying ~${f1(M.impliedCapacityHoursPerSP)} h of capacity per point. Your ${f1(M.spPerDay)} SP/day assumption is ${f1(M.throughputMultiple)}× that — ${M.throughputMultiple > 1.3 ? 'materially optimistic' : M.throughputMultiple < 0.77 ? 'conservative' : 'about right'}.${M.completionRate !== null ? ` Committed→completed rate ~${pctI(M.completionRate * 100)}%.` : ''}`);
  }
  // absolute-hours line only when logging is complete enough to trust it
  if (!suppressed) {
    lines.push(`Recorded rate: median ${f1(M.medianHoursPerSP)} h/SP (IQR ${f1(M.iqr[0])}–${f1(M.iqr[1])}). With ~${pctI((M.loggingCompleteness || 1) * 100)}% logging completeness this is close to effort, but it is hours RECORDED per point — use throughput above for capacity.`);
  } else {
    lines.push(`Absolute-hour figures (median h/SP, MdAPE) are suppressed: at ~${pctI(M.loggingCompleteness * 100)}% logging they understate effort by an unknown factor. The rank-based findings below are unaffected by uniform under-logging.`);
  }

  // 3. consistency (rank-based, always valid)
  const spreadWord = M.spreadFactor < 1.5 ? 'tight' : M.spreadFactor <= 2.0 ? 'workable' : 'wide — points carry little information';
  const discWord = M.discrimination >= 0.7 ? 'strong: larger estimates reliably take longer' : M.discrimination >= 0.4 ? 'weak: larger estimates only loosely take longer' : 'near-noise: story points barely predict effort';
  lines.push(`Consistency (rank-based, valid at any logging level): spread ×${f1(M.spreadFactor)} (${ciTxt(M.spreadCI)}) — ${spreadWord}. Discrimination ${f2(M.discrimination)} (${ciTxt(M.discriminationCI)}) — ${discWord}.`);

  // 4. monotonicity (hours + rate)
  const hFails = M.monotonic.filter(m => !m.pass);
  const rFails = M.monotonicRate.filter(m => !m.pass);
  if (hFails.length) lines.push(`Median-hours monotonicity fails at ${hFails.map(m => `${m.from}→${m.to}`).join(', ')}.`);
  if (rFails.length) lines.push(`Median h/SP is non-monotonic at ${rFails.map(m => `${m.from}→${m.to}`).join(', ')} — a non-monotonic rate is what breaks forecasting even when hours rise.`);

  // 5. drift + backtest
  if (M.driftTrend.trending) lines.push(`Rate is trending (Mann–Kendall p=${f2(M.driftTrend.p)}), not stationary — a trailing ${M.windowN}-sprint median systematically ${M.driftTrend.direction < 0 ? 'over-predicts' : 'under-predicts'}. Consider a 3-sprint window or exponential weighting.`);
  if (M.backtest.enoughForHeadline) {
    if (M.backtest.signConsistency === 1) lines.push(`Out-of-sample: every evaluated sprint erred the SAME direction — the forecast is systematically ${M.backtest.systematicDir < 0 ? 'over' : 'under'}-predicting (median ${pctI(M.backtest.medianError)}%), a bias not a spread.`);
    else if (!suppressed) lines.push(`Out-of-sample MdAPE ${pctI(M.backtest.mdape)}% (sprint-level).`);
  } else if (M.backtest.rows.length) {
    lines.push(`Backtest not yet conclusive — ${M.backtest.rows.length} of 4 evaluated sprints (widen the window for more).`);
  }

  // Recommendation — exactly one of: use-throughput/collect / tighten / recalibrate-capacity / healthy
  let rec, recColor;
  if (suppressed) {
    rec = `Do NOT recalibrate from logged hours — they capture only ~${pctI(M.loggingCompleteness * 100)}% of effort. Set capacity from throughput (~${f2(M.deliveredSPPerPersonDay)} SP/person-day; your assumption is ${f1(M.throughputMultiple)}× optimistic) and wire that into the Capacity tab. The estimation signal is ${noise ? 'weak — also tighten estimation practice (re-point with reference stories, split ≥8-SP items)' : 'healthy (discrimination ' + f2(M.discrimination) + ') — leave the scale alone'}.`;
    recColor = '#fca5a5';
  } else if (noise) {
    rec = `Tighten estimation practice — the problem is noise (spread ×${f1(M.spreadFactor)}, discrimination ${f2(M.discrimination)}), which recalibration can't fix. Re-point with reference stories, split anything ≥8 SP, and work the miss list in retro.`;
    recColor = '#fca5a5';
  } else if (M.throughputMultiple && (M.throughputMultiple > 1.3 || M.throughputMultiple < 0.77)) {
    rec = `Recalibrate the CAPACITY assumption toward observed throughput (~${f2(M.deliveredSPPerPersonDay)} SP/person-day), not toward logged h/SP. Estimates are internally consistent; only the planning assumption is off.`;
    recColor = '#fcd34d';
  } else {
    rec = `No structural action — estimates are consistent (spread ×${f1(M.spreadFactor)}, discrimination ${f2(M.discrimination)}) and the capacity assumption is within range of observed throughput. Keep monitoring drift and the backtest.`;
    recColor = '#86efac';
  }

  return (
    <Card>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 8 }}>📊 What this means</div>
      <div style={{ display: 'grid', gap: 7 }}>
        {lines.map((l, i) => <div key={i} style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6 }}>{l}</div>)}
      </div>
      <div style={{ marginTop: 12, padding: '11px 13px', background: `${recColor}12`, border: `1px solid ${recColor}33`, borderRadius: 8, fontSize: 12.5, color: recColor, lineHeight: 1.6 }}>
        <strong>✅ Recommended: </strong>{rec}
      </div>
    </Card>
  );
}

// ─── Metrics engine ───────────────────────────────────────────────────────────
function computeMetrics(tickets, today, typeMode, cfg, worklog, windowN = 6, preview = false) {
  const spPerDay = cfg?.spPerDay ?? 2;
  const hoursPerDay = cfg?.hoursPerDay ?? 8;
  const hoursPerIdealDay = cfg?.hoursPerIdealDay ?? 8;
  const planningHoursPerSP = cfg?.planningHoursPerSP ?? (hoursPerDay / spPerDay);
  const eligibility = cfg?.eligibility || {};
  const selectedProject = cfg?.selectedProject ?? 'all';
  const hasEligibility = Object.keys(eligibility).length > 0;
  // allocationPct(person) — fraction of their working time on the analysed scope, from the
  // Allocation tab's eligibility map (even split across each person's eligible projects).
  // Returns null when we have no eligibility row for that person (caller falls back to 100%).
  const allocationPctOf = name => {
    const elig = eligibility[name];
    if (!elig || !elig.length) return null;
    if (selectedProject === 'all') return 1;              // whole tracked portfolio is in scope
    const projects = elig.includes(selectedProject) ? elig.length : elig.length + 1;
    return 1 / projects;                                   // this project is one of their shares
  };
  const allow = new Set(ALLOWED_TYPES);
  const wlByKey = worklog?.byKey || null;
  const worklogMode = !!wlByKey;

  const fmtDMY = d => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getFullYear()).slice(2)}`;

  // Sprint windows (name → {start,end,state}). Prefer the REAL sprint metadata from
  // _rawFields (startDate/endDate/state), falling back to date-in-name parsing.
  const winMap = new Map();
  for (const t of tickets) {
    const raw = t._rawFields || {};
    const arr = raw.customfield_10010 || raw.sprint;
    const consider = (nm, sp) => {
      if (!nm || winMap.has(nm)) return;
      let start = null, end = null, state = null;
      if (sp && typeof sp === 'object') {
        state = sp.state ? String(sp.state).toLowerCase() : null;
        if (sp.startDate) start = new Date(sp.startDate);
        if (sp.endDate) end = new Date(sp.endDate);
        if ((!end || isNaN(end)) && sp.completeDate) end = new Date(sp.completeDate);
      }
      if (!start || !end || isNaN(start) || isNaN(end)) {
        const d = parseSprintDates(nm);
        if (d) { if (!start || isNaN(start)) start = d.start; if (!end || isNaN(end)) end = d.end; }
      }
      if (start && end && !isNaN(start) && !isNaN(end)) winMap.set(nm, { name: nm, start, end, state });
    };
    if (Array.isArray(arr)) {
      for (const sp of arr) consider(typeof sp === 'string' ? sp : sp?.name, sp);
    } else {
      consider(getSprint(t), null);
    }
  }
  const windows = [...winMap.values()];
  const windowFor = date => {
    const d = new Date(date);
    if (isNaN(d)) return null;
    const w = windows.find(x => d >= x.start && d <= x.end);
    return w ? w.name : null;
  };
  const ROUND_SECS = new Set([3600, 14400, 28800]); // 1h, 4h, 8h/1d (default 8h workday)

  // Completed = Jira state 'closed' (or, if state unknown, endDate < today). Take most recent windowN.
  const isCompleted = w => (w.state ? w.state === 'closed' : w.end < today);
  const isInflight = w => (w.state ? (w.state === 'active' || w.state === 'future') : w.end >= today);
  const completedSprints = windows.filter(isCompleted).sort((a, b) => a.start - b.start);
  const windowSprints = completedSprints.slice(-windowN);
  const windowSet = new Set(windowSprints.map(w => w.name));
  const inflightSprints = windows.filter(isInflight);

  const typeOk = t => {
    const type = getType(t).toLowerCase();
    if (type === 'epic') return false;
    if (!allow.has(type)) return false;
    if (typeMode !== 'pool' && type !== typeMode) return false;
    return isDone(getStatus(t)) && getSP(t) > 0;
  };

  // Attribute a ticket to a COMPLETED sprint by its resolution date (not its sprint field):
  //  • resolved inside a sprint window → that sprint (null if that sprint is still in-flight)
  //  • resolved in a gap between sprints → the most recent completed sprint that ended before it
  //  • no resolution date → fall back to the sprint-field name if it's a known completed sprint
  const winContaining = d => windows.find(w => d >= w.start && d <= w.end) || null;
  const attrSprintOf = t => {
    const rd = getResolved(t);
    const d = rd ? new Date(rd) : null;
    if (d && !isNaN(d)) {
      const c = winContaining(d);
      if (c) return isCompleted(c) ? c.name : null; // resolved during an in-flight sprint → excluded
      let best = null;
      for (const w of completedSprints) if (w.end <= d && (!best || w.end > best.end)) best = w;
      return best ? best.name : null;
    }
    const nm = getSprint(t);
    const w = winMap.get(nm);
    return w && isCompleted(w) ? nm : null;
  };

  // Eligible = completed + pointed + allowed type, attributed (by resolution date) to a
  // completed sprint inside the window. In-flight sprints are excluded entirely — early
  // completers there are a self-selected easy subset that biases the rate downward.
  const eligible = tickets.filter(t => typeOk(t) && windowSet.has(attrSprintOf(t)));

  // Worklog-level aggregates (only populated in worklog mode)
  let totalWorklogs = 0, roundCount = 0, coveredTickets = 0;
  const contributorSec = {}, contributorCount = {};

  const sample = eligible
    .filter(t => getLoggedSec(t) > 0)
    .map(t => {
      const key = getKey(t);
      const sp = getSP(t);
      const raw = t._rawFields || {};
      let hours = toHours(getLoggedSec(t));
      let sprint = attrSprintOf(t) || getSprint(t) || 'No Sprint'; // resolution-date sprint (worklog mode may refine below)
      let carry, placeholder = false;

      if (worklogMode && wlByKey.has(key)) {
        const wls = wlByKey.get(key);
        coveredTickets += 1;
        let sec = 0;
        const perWin = {};
        for (const w of wls) {
          totalWorklogs += 1;
          sec += w.seconds || 0;
          if (ROUND_SECS.has(w.seconds)) roundCount += 1;
          contributorSec[w.author] = (contributorSec[w.author] || 0) + (w.seconds || 0);
          contributorCount[w.author] = (contributorCount[w.author] || 0) + 1;
          const win = w.started ? windowFor(w.started) : null;
          if (win) perWin[win] = (perWin[win] || 0) + (w.seconds || 0);
        }
        if (sec > 0) hours = sec / SEC_PER_HOUR; // trust summed worklogs over aggregate
        const touched = Object.keys(perWin);
        if (touched.length) sprint = touched.sort((a, b) => perWin[b] - perWin[a])[0];
        carry = touched.length > 1;
        // E3: whole logged time is a single round-number worklog → probably a placeholder, not a measurement
        placeholder = wls.length === 1 && ROUND_WORKLOG_SECS.has(wls[0].seconds);
      } else {
        const sf = raw.customfield_10010 || raw.sprint;
        carry = Array.isArray(sf) && sf.length > 1;
      }

      return {
        key, summary: getSummary(t), assignee: getAssignee(t), project: getProject(t),
        sprint, sp, hours, hoursPerSP: hours / sp, carry, placeholder,
      };
    });

  const n = sample.length;
  const eligibleN = eligible.length;
  const logCoverage = eligibleN > 0 ? Math.round((n / eligibleN) * 100) : 0;
  const carryoverRate = n > 0 ? Math.round((sample.filter(s => s.carry).length / n) * 100) : 0;
  const roundNumberBias = worklogMode && totalWorklogs > 0 ? Math.round((roundCount / totalWorklogs) * 100) : null;
  const worklogCoverage = worklogMode && n > 0 ? Math.round((coveredTickets / n) * 100) : 0;
  const worklogsPerTicket = worklogMode && coveredTickets > 0 ? totalWorklogs / coveredTickets : null;
  const contributors = worklogMode
    ? Object.keys(contributorSec)
        .map(name => ({ name, hours: contributorSec[name] / SEC_PER_HOUR, count: contributorCount[name] }))
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 15)
        .map(c => ({ ...c, share: totalWorklogs > 0 ? Math.round((c.count / totalWorklogs) * 100) : 0 }))
    : [];

  // Per-completed-sprint contribution (for the accumulation countdown), by resolution-date sprint.
  const eligAttr = eligible.map(t => ({ t, nm: attrSprintOf(t), logged: getLoggedSec(t) > 0 }));
  const sampleBySprint = {}, eligBySprint = {};
  for (const e of eligAttr) { eligBySprint[e.nm] = (eligBySprint[e.nm] || 0) + 1; if (e.logged) sampleBySprint[e.nm] = (sampleBySprint[e.nm] || 0) + 1; }
  const contributing = windowSprints.map(w => ({
    name: w.name,
    eligible: eligBySprint[w.name] || 0,
    sample: sampleBySprint[w.name] || 0,
  }));

  const nCompletedInWindow = windowSprints.length;
  const perSprintEligible = nCompletedInWindow > 0 ? eligibleN / nCompletedInWindow : 0;
  const perSprintSample = nCompletedInWindow > 0 ? n / nCompletedInWindow : 0;
  const coverageFrac = eligibleN > 0 ? n / eligibleN : 0;
  const perSprintLogged = perSprintEligible * coverageFrac;
  const sprintsNeeded = perSprintLogged > 0 ? Math.max(1, Math.ceil((30 - n) / perSprintLogged)) : null;
  // In-flight exclusions: Done+pointed tickets whose RESOLUTION date falls inside an in-flight sprint window
  const excluded = inflightSprints
    .map(w => ({
      name: w.name, endLabel: fmtDMY(w.end),
      eligible: tickets.filter(t => {
        if (!typeOk(t)) return false;
        const rd = getResolved(t); const d = rd ? new Date(rd) : null;
        return d && !isNaN(d) && d >= w.start && d <= w.end;
      }).length,
    }))
    .filter(e => e.eligible > 0);

  // ── Scale semantics (B) ──
  const distinctSP = [...new Set(sample.map(s => s.sp))].sort((a, b) => a - b);
  const detectedScale = detectScaleType(distinctSP);
  const scaleType = (cfg?.scaleType && cfg.scaleType !== 'auto') ? cfg.scaleType : detectedScale;

  // ── A2. Throughput (logging-immune): completed SP per person-day, by completed sprint ──
  const committedSPForSprint = name => {
    let sp = 0;
    for (const t of tickets) {
      if (getSP(t) <= 0) continue;
      const type = getType(t).toLowerCase();
      if (type === 'epic' || !allow.has(type) || (typeMode !== 'pool' && type !== typeMode)) continue;
      const raw = t._rawFields || {};
      const arr = raw.customfield_10010 || raw.sprint;
      const names = Array.isArray(arr) ? arr.map(s => (typeof s === 'string' ? s : s?.name)) : [getSprint(t)];
      if (names.includes(name)) sp += getSP(t);
    }
    return sp;
  };
  const throughputRows = windowSprints.map(w => {
    const wEligible = eligible.filter(t => attrSprintOf(t) === w.name);
    const completedSP = wEligible.reduce((a, t) => a + getSP(t), 0);
    const names = [...new Set(wEligible.map(getAssignee))];
    const contribs = names.length || 0;
    const wd = businessDays(w.start, w.end) || 1;
    // person-days weighted by each contributor's allocation to this scope (100% fallback)
    const allocFTE = names.reduce((a, nm) => a + (allocationPctOf(nm) ?? 1), 0) || (contribs || 1);
    const personDays = wd * allocFTE;
    const committedSP = committedSPForSprint(w.name);
    return {
      name: w.name, label: shortSprintLabel(w.name), completedSP, committedSP, contribs, workingDays: wd, personDays,
      deliveredSPPerPersonDay: personDays > 0 ? completedSP / personDays : 0,
      completionRate: committedSP > 0 ? completedSP / committedSP : null,
    };
  }).filter(r => r.completedSP > 0);
  const totCompletedSP = throughputRows.reduce((a, r) => a + r.completedSP, 0);
  const totPersonDays = throughputRows.reduce((a, r) => a + r.personDays, 0);
  const deliveredSPPerPersonDay = totPersonDays > 0 ? totCompletedSP / totPersonDays : 0;
  const impliedCapacityHoursPerSP = deliveredSPPerPersonDay > 0 ? hoursPerDay / deliveredSPPerPersonDay : null;
  const throughputMultiple = deliveredSPPerPersonDay > 0 ? spPerDay / deliveredSPPerPersonDay : null; // assumption ÷ observed
  const totCommittedSP = throughputRows.reduce((a, r) => a + r.committedSP, 0);
  const completionRate = totCommittedSP > 0 ? totCompletedSP / totCommittedSP : null;

  // ── A1. Logging completeness: logged hours ÷ available capacity hours (allocation from Allocation tab) ──
  const workingDaysInWindow = windowSprints.reduce((a, w) => a + businessDays(w.start, w.end), 0);
  const contributorNames = worklogMode ? Object.keys(contributorSec) : [...new Set(sample.map(s => s.assignee))];
  const numContributors = contributorNames.length || 1;
  const totalLoggedHours = sample.reduce((a, s) => a + s.hours, 0);
  // Sum each contributor's allocated capacity; fall back to 100% where eligibility is unknown.
  let missingAlloc = 0;
  const effectiveFTE = contributorNames.reduce((a, name) => {
    const p = allocationPctOf(name);
    if (p === null) missingAlloc += 1;
    return a + (p === null ? 1 : p);
  }, 0);
  const capacityHours = (effectiveFTE || numContributors) * workingDaysInWindow * hoursPerDay;
  const loggingCompleteness = capacityHours > 0 ? totalLoggedHours / capacityHours : null;
  const allocationAssumed = !hasEligibility;                 // true only if we had NO eligibility data
  const allocationPartial = hasEligibility && missingAlloc > 0;
  const effectiveFTEval = Math.round(effectiveFTE * 10) / 10;
  const suppressAbsolute = loggingCompleteness !== null && loggingCompleteness < 0.70;

  const sampleKeys = sample.map(s => s.key);
  const base = {
    n, eligibleN, logCoverage, carryoverRate, planningHoursPerSP, spPerDay, hoursPerDay, hoursPerIdealDay,
    worklogMode, roundNumberBias, totalWorklogs, worklogCoverage, worklogsPerTicket, contributors, sampleKeys,
    windowN, nCompletedInWindow, detectedScale, scaleType,
    // A1/A2/A3
    loggingCompleteness, allocationAssumed, allocationPartial, effectiveFTE: effectiveFTEval, suppressAbsolute,
    numContributors, totalLoggedHours, capacityHours,
    deliveredSPPerPersonDay, impliedCapacityHoursPerSP, throughputMultiple, throughputRows, completionRate,
  };

  // Accumulation countdown (not an error) — sample not yet mature
  if (n < 30 && !preview) {
    return {
      ...base,
      accumulating: {
        perSprintEligible, perSprintSample, coverage: logCoverage,
        sprintsNeeded, contributing, excluded,
      },
    };
  }
  // Coverage gate — enough tickets, but too few log time to trust the rate
  if (logCoverage < 70 && !preview) {
    return { ...base, coverageGate: { detail: `Only ${logCoverage}% of the ${eligibleN} completed, pointed tickets in the window have logged time (need ~70%). The rate would reflect whoever logs, not the work. Improve worklog discipline before relying on these numbers.` } };
  }
  const notReliable = preview && (n < 30 || logCoverage < 70);
  if (n < 3) {
    // Even preview can't compute meaningful stats
    return { ...base, accumulating: { perSprintEligible, perSprintSample, coverage: logCoverage, sprintsNeeded, contributing, excluded } };
  }

  // Headline
  const hpsp = sample.map(s => s.hoursPerSP);
  const medianHoursPerSP = median(hpsp);
  const iqr = [quantile(hpsp, 0.25), quantile(hpsp, 0.75)];
  const logRatios = sample.map(s => Math.log(s.hoursPerSP / medianHoursPerSP));
  const spreadFactor = Math.exp(stdevSample(logRatios));
  const sps = sample.map(s => s.sp);
  const hrs = sample.map(s => s.hours);
  const discrimination = spearman(sps, hrs);
  const hitsArr = sample.map(s => (Math.abs(s.hours - medianHoursPerSP * s.sp) <= 0.5 * medianHoursPerSP * s.sp ? 1 : 0));
  const hitRate = meanOf(hitsArr) * 100;
  const apes = sample.map(s => Math.abs(s.hours - medianHoursPerSP * s.sp) / s.hours);
  const mdape = median(apes) * 100;

  // B2. estimateRatio — only meaningful when SP is day-denominated (ideal_days)
  let estimateRatio = null;
  if (scaleType === 'ideal_days' && hoursPerIdealDay > 0) {
    const ers = sample.map(s => s.hours / (s.sp * hoursPerIdealDay));
    const medER = median(ers);
    estimateRatio = { median: medER, spread: Math.exp(stdevSample(ers.map(v => Math.log(v / medER)))), ci: bootstrapCI(ers, median) };
  }

  // Bootstrap CIs
  const medianCI = bootstrapCI(hpsp, median);
  const spreadCI = bootstrapCI(logRatios, a => Math.exp(stdevSample(a)));
  const discriminationCI = bootstrapCI(sample, a => spearman(a.map(s => s.sp), a.map(s => s.hours)));
  const hitRateCI = bootstrapCI(hitsArr, a => meanOf(a) * 100);
  const mdapeCI = bootstrapCI(apes, a => median(a) * 100);

  // Per-bucket
  const bySp = {};
  for (const s of sample) (bySp[s.sp] ||= []).push(s);
  const spValues = Object.keys(bySp).map(Number).sort((a, b) => a - b);
  const buckets = spValues.map(sp => {
    const items = bySp[sp];
    const h = items.map(i => i.hours);
    const enough = items.length >= 5;
    if (!enough) return { sp, n: items.length, enough: false };
    const mh = median(h);
    const lr = h.map(v => Math.log(v / mh));
    return {
      sp, n: items.length, enough: true,
      medianHours: mh, iqr: [quantile(h, 0.25), quantile(h, 0.75)],
      medianHoursPerSP: mh / sp, spreadFactor: Math.exp(stdevSample(lr)),
      minH: Math.min(...h), maxH: Math.max(...h),
    };
  });

  // Monotonicity (median hours AND median h/SP — C1) + overlap (adjacent buckets, both n≥5)
  const enoughB = buckets.filter(b => b.enough);
  const monotonic = [], monotonicRate = [], overlaps = [];
  for (let i = 1; i < enoughB.length; i++) {
    const lo = enoughB[i - 1], hi = enoughB[i];
    const pass = hi.medianHours > lo.medianHours;
    monotonic.push({ from: `${lo.sp}`, to: `${hi.sp}`, pass, detail: pass ? '' : `${hi.sp}-pointers median ${f1(hi.medianHours)}h vs ${lo.sp}-pointers ${f1(lo.medianHours)}h` });
    // C1 — a non-monotonic rate (h/SP) is what actually breaks forecasting
    const ratePass = hi.medianHoursPerSP >= lo.medianHoursPerSP;
    monotonicRate.push({ from: `${lo.sp}`, to: `${hi.sp}`, pass: ratePass, detail: `${lo.sp}: ${f1(lo.medianHoursPerSP)} h/SP → ${hi.sp}: ${f1(hi.medianHoursPerSP)} h/SP` });
    const hiItems = bySp[hi.sp];
    const belowLoMedian = hiItems.filter(x => x.hours < lo.medianHours).length;
    overlaps.push({ from: `${lo.sp}`, to: `${hi.sp}`, pct: Math.round((belowLoMedian / hiItems.length) * 100) });
  }

  // C2 — concrete collapse suggestion: runs of adjacent enough-buckets with >30% overlap,
  // extended down to include any smaller (sub-1 SP) buckets clustered with them.
  const collapseSuggestions = [];
  {
    let run = null;
    for (let i = 0; i < overlaps.length; i++) {
      const o = overlaps[i];
      if (o.pct > 30) { if (!run) run = [o.from]; run.push(o.to); }
      else if (run) { collapseSuggestions.push(run); run = null; }
    }
    if (run) collapseSuggestions.push(run);
  }
  const smallBuckets = buckets.filter(b => b.sp < 1).map(b => `${b.sp}`);
  const collapseText = collapseSuggestions.map(grp => {
    const set = new Set(grp);
    // pull any sub-1 SP buckets adjacent to the low end into the same recommendation
    if (grp.some(v => parseFloat(v) <= 0.5)) smallBuckets.forEach(s => set.add(s));
    const names = [...set].map(parseFloat).sort((a, b) => a - b).join(' / ');
    return `${names} are not distinguishable in outcome — collapse to a single bucket.`;
  });

  // C3 — effective scale coverage
  const lowNBuckets = buckets.filter(b => !b.enough).map(b => ({ sp: b.sp, n: b.n }));
  const bucketCoverage = {
    qualifying: enoughB.length,
    spanLo: enoughB.length ? enoughB[0].sp : null,
    spanHi: enoughB.length ? enoughB[enoughB.length - 1].sp : null,
    ticketsInQualifying: enoughB.reduce((a, b) => a + b.n, 0),
    lowN: lowNBuckets,
    lowNTickets: lowNBuckets.reduce((a, b) => a + b.n, 0),
  };

  // Scatter (log–log: multiplicative jitter so sub-1 SP points don't collide or go negative)
  const allHours = sample.map(s => s.hours);
  const yDomain = [Math.max(0.1, Math.min(...allHours) * 0.7), Math.max(...allHours) * 1.4];
  const minSP = Math.min(...spValues), maxSP = Math.max(...spValues);
  const xDomain = [Math.max(0.05, minSP * 0.7), maxSP * 1.3];
  const hits = [], misses = [];
  for (const s of sample) {
    const predicted = medianHoursPerSP * s.sp;
    const miss = Math.abs(s.hours - predicted) > 0.5 * predicted;
    const pt = { x: s.sp * Math.exp(keyJitter(s.key) * 0.5), y: s.hours, sp: s.sp, key: s.key, summary: s.summary, assignee: s.assignee };
    (miss ? misses : hits).push(pt);
  }
  const rayXs = [xDomain[0], ...spValues, xDomain[1]].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  const ray = rayXs.map(x => ({ x, y: medianHoursPerSP * x }));
  const bandHi = rayXs.map(x => ({ x, y: 1.5 * medianHoursPerSP * x }));
  const bandLo = rayXs.map(x => ({ x, y: 0.5 * medianHoursPerSP * x }));
  const scatter = { hits, misses, ray, bandHi, bandLo, yDomain, xDomain, spValues };

  // Misses (E) — full list with absolute error + placeholder flag; component applies floor/sort/top-N
  const missesAll = sample.map(s => {
    const predicted = medianHoursPerSP * s.sp;
    return {
      key: s.key, summary: s.summary, assignee: s.assignee, sp: s.sp, logged: s.hours, predicted,
      logRatio: Math.log(s.hoursPerSP / medianHoursPerSP), absErr: Math.abs(s.hours - predicted), placeholder: s.placeholder,
    };
  });

  // Sprint ordering (completed only)
  const sprintNames = [...new Set(sample.map(s => s.sprint))]
    .filter(name => sprintState(name, today) === 'past' && parseSprintDates(name))
    .sort((a, b) => parseSprintDates(a).start - parseSprintDates(b).start);

  // Drift (last 8 completed sprints, bucket n≥5)
  const completedSprintsInSample = sprintNames.length;
  const drift = sprintNames.map(name => {
    const items = sample.filter(s => s.sprint === name);
    if (items.length < 5) return null;
    const perSp = items.map(i => i.hoursPerSP);
    return { label: shortSprintLabel(name), n: items.length, median: median(perSp), p25: quantile(perSp, 0.25), p75: quantile(perSp, 0.75) };
  }).filter(Boolean).slice(-8);
  // D1 — directional drift via Mann–Kendall on the median-rate series
  const driftTrend = mannKendall(drift.map(d => d.median));
  const driftExcluded = Math.min(completedSprintsInSample, 8) - drift.length;

  // Backtest: predict each sprint from PRIOR sprints only (≥3 prior).
  // Two forecast bases (A3): committed SP (includes carryover) and completed SP (estimation error only).
  const btRows = [];
  for (let i = 3; i < sprintNames.length; i++) {
    const name = sprintNames[i];
    const priorNames = new Set(sprintNames.slice(0, i));
    const priorItems = sample.filter(s => priorNames.has(s.sprint));
    const curItems = sample.filter(s => s.sprint === name);
    if (priorItems.length < 5 || curItems.length < 3) continue;
    const rate = median(priorItems.map(s => s.hoursPerSP));
    const completedSP = eligible.filter(t => attrSprintOf(t) === name).reduce((a, t) => a + getSP(t), 0);
    const committedSP = committedSPForSprint(name);
    const actual = curItems.reduce((a, s) => a + s.hours, 0);
    const predCommitted = committedSP * rate;
    const predCompleted = completedSP * rate;
    if (predCommitted <= 0 && predCompleted <= 0) continue;
    btRows.push({
      sprint: name, label: shortSprintLabel(name), rate, committedSP, completedSP, actual,
      predicted: predCommitted, errorPct: predCommitted > 0 ? ((actual - predCommitted) / predCommitted) * 100 : null,
      errorCompletedPct: predCompleted > 0 ? ((actual - predCompleted) / predCompleted) * 100 : null,
    });
  }
  const signs = btRows.map(r => Math.sign(r.errorPct)).filter(s => s !== 0);
  const signConsistency = signs.length ? Math.max(signs.filter(s => s > 0).length, signs.filter(s => s < 0).length) / signs.length : null;
  const backtest = {
    rows: btRows,
    mdape: btRows.length ? median(btRows.map(r => Math.abs(r.errorPct))) : NaN,
    medianError: btRows.length ? median(btRows.map(r => r.errorPct)) : NaN,
    signConsistency,
    systematicDir: signConsistency === 1 && signs.length ? Math.sign(signs[0]) : 0,
    enoughForHeadline: btRows.length >= 4,
  };

  return {
    ...base, accumulating: null, coverageGate: null, notReliable,
    medianHoursPerSP, iqr, medianCI, spreadFactor, spreadCI,
    discrimination, discriminationCI, hitRate, hitRateCI, mdape, mdapeCI, estimateRatio,
    buckets, monotonic, monotonicRate, overlaps, collapseText, bucketCoverage,
    scatter, missesAll, drift, driftTrend, driftExcluded, backtest,
  };
}
