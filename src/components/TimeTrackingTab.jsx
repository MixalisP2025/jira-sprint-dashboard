import React, { useMemo, useState } from 'react';
import {
  ScatterChart, Scatter, ComposedChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceLine, Cell,
} from 'recharts';
import { Gauge, Layers, Activity, Target, AlertTriangle } from 'lucide-react';

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

const thL = { textAlign: 'left', padding: '8px 10px', fontWeight: 600 };
const thR = { textAlign: 'right', padding: '8px 10px', fontWeight: 600 };
const tdL = { textAlign: 'left', padding: '9px 10px' };
const tdR = { textAlign: 'right', padding: '9px 10px', fontVariantNumeric: 'tabular-nums' };

// ─── Main component ───────────────────────────────────────────────────────────
export default function TimeTrackingTab({ tickets = [], selectedSprint = 'all', selectedAssignee = 'all', selectedProject = 'all' }) {
  const today = useMemo(() => new Date(), []);

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
  const upd = (setter, keyName) => v => { const n = parseFloat(v); if (Number.isFinite(n) && n > 0) { setter(n); localStorage.setItem(keyName, String(n)); } };

  const planningHoursPerSP = hoursPerDay / spPerDay;

  const M = useMemo(
    () => computeMetrics(tickets, today, typeMode, planningHoursPerSP),
    [tickets, today, typeMode, planningHoursPerSP]
  );

  const scopeLabel = [
    selectedSprint !== 'all' ? selectedSprint : 'All sprints',
    selectedProject !== 'all' ? selectedProject : null,
    selectedAssignee !== 'all' ? selectedAssignee : null,
  ].filter(Boolean).join(' · ');

  const typeLabel = typeMode === 'pool' ? 'Story + Task + Bug' : typeMode[0].toUpperCase() + typeMode.slice(1);

  // ── Shared control bar ──
  const controls = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 18px', marginBottom: 16 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>⚙ Estimation scope</span>
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
    </div>
  );

  // ── Data-quality banners (always shown, above everything) ──
  const banners = (
    <>
      {M.n > 0 && M.roundNumberBiasUnavailable && (
        <Banner color="#6b7280" icon="ℹ">
          <strong>Round-number bias check unavailable.</strong> It needs individual worklog durations (1h/4h/8h buckets), which aren't fetched yet — only aggregate time-per-ticket is. All logged-hours figures here are ticket-level totals; treat them as coarse.
        </Banner>
      )}
      {M.n > 0 && M.carryoverRate > 25 && (
        <Banner color="#f59e0b" icon={<AlertTriangle size={15} />}>
          <strong>{M.carryoverRate}% of sampled tickets span more than one sprint.</strong> Sprint attribution below uses each ticket's current sprint field (not per-worklog dates), so carryover work is credited to its latest sprint. Drift/backtest by sprint are approximate.
        </Banner>
      )}
      <Banner color="#64748b" icon="ℹ">
        Worklogs are attributed by each ticket's <strong>assignee and sprint field</strong>, not by individual worklog author/date (worklog-level data isn't fetched yet). Multi-person and carried-over tickets are approximated.
      </Banner>
    </>
  );

  // ── Gate: insufficient sample or low coverage ──
  if (M.disabled) {
    return (
      <div>
        {controls}
        {banners}
        <Card style={{ opacity: 0.85, border: '1px dashed rgba(255,255,255,0.15)' }}>
          <CardHeader title="Story Point Estimation Quality" subtitle={`${scopeLabel} · ${typeLabel}`} />
          <div style={{ textAlign: 'center', padding: '28px 12px' }}>
            <AlertTriangle size={28} style={{ color: '#f59e0b', marginBottom: 10 }} />
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>Panel disabled — {M.disabled.reason}</div>
            <div style={{ fontSize: 13, color: '#94a3b8', maxWidth: 560, margin: '0 auto', lineHeight: 1.6 }}>{M.disabled.detail}</div>
            <div style={{ display: 'flex', gap: 22, justifyContent: 'center', marginTop: 20, flexWrap: 'wrap' }}>
              <MiniStat label="Completed pointed tickets" value={M.eligibleN} />
              <MiniStat label="With logged time (sample n)" value={M.n} />
              <MiniStat label="Log coverage" value={`${M.logCoverage}%`} />
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const gapPct = M.planningHoursPerSP > 0 ? (M.medianHoursPerSP / M.planningHoursPerSP - 1) * 100 : null;
  const discColor = M.discrimination >= 0.7 ? '#22c55e' : M.discrimination >= 0.4 ? '#f59e0b' : '#ef4444';
  const spreadColor = M.spreadFactor < 1.5 ? '#22c55e' : M.spreadFactor <= 2.0 ? '#f59e0b' : '#ef4444';

  return (
    <div>
      {controls}
      {banners}

      {/* Headline metrics */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <KpiTile icon={Layers} label="Sample" value={`n=${M.n}`} sub={`completed, pointed, time-logged · ${M.logCoverage}% coverage`} color="#a855f7" />
        <KpiTile icon={Gauge} label="Median h / SP" value={`${f1(M.medianHoursPerSP)}h`} sub={`IQR ${f1(M.iqr[0])}–${f1(M.iqr[1])}h · ${ciTxt(M.medianCI, 'h')}`} color="#60a5fa" />
        <KpiTile icon={Activity} label="Spread factor" value={`×${f1(M.spreadFactor)}`} sub={`typical ticket within this factor · ${ciTxt(M.spreadCI)}`} color={spreadColor} />
        <KpiTile icon={Target} label="Discrimination" value={f2(M.discrimination) ?? '—'} sub={`SP↔hours rank corr · ${ciTxt(M.discriminationCI)}`} color={discColor} />
        <KpiTile icon={Gauge} label="Hit rate (±50%)" value={`${pctI(M.hitRate)}%`} sub={`within ±50% of predicted · ${ciTxt(M.hitRateCI)}`} color="#22c55e" />
        <KpiTile icon={Activity} label="MdAPE" value={`${pctI(M.mdape)}%`} sub={`median abs. % error (in-sample) · ${ciTxt(M.mdapeCI)}`} color="#f59e0b" />
      </div>

      <WhatThisMeans M={M} gapPct={gapPct} typeLabel={typeLabel} />

      {/* A. Calibration scatter */}
      <Card>
        <CardHeader
          title="Calibration — logged hours vs story points"
          subtitle={`${scopeLabel} · log scale · ray = ${f1(M.medianHoursPerSP)} h/SP median, shaded band = ±50%`}
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
            <XAxis type="number" dataKey="x" name="SP" domain={[0, M.scatter.maxX]} ticks={M.scatter.spValues}
              tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false}
              label={{ value: 'Story points', position: 'insideBottom', offset: -4, fill: '#6b7280', fontSize: 11 }} />
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

      {/* B. Calibration drift */}
      <Card>
        <CardHeader
          title="Calibration drift — median h/SP by sprint"
          subtitle="Last 8 completed sprints (buckets with n≥5). Blue dashed line = capacity planning constant."
        />
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

      {/* C. Outlier list */}
      <Card>
        <CardHeader title="Biggest estimation misses" subtitle="Top 10 tickets by |log-ratio| — the retro artifact" />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
            <thead>
              <tr style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>
                <th style={thL}>Key</th><th style={thL}>Summary</th><th style={thL}>Assignee</th>
                <th style={thR}>SP</th><th style={thR}>Logged</th><th style={thR}>Predicted</th><th style={thR}>Ratio</th>
              </tr>
            </thead>
            <tbody>
              {M.outliers.map((o, i) => (
                <tr key={o.key + i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ ...tdL, color: '#60a5fa', fontWeight: 500, whiteSpace: 'nowrap' }}>{o.key}</td>
                  <td style={{ ...tdL, color: '#e2e8f0', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.summary}>{o.summary}</td>
                  <td style={{ ...tdL, color: '#94a3b8', whiteSpace: 'nowrap' }}>{o.assignee}</td>
                  <td style={{ ...tdR, color: '#c4b5fd' }}>{o.sp}</td>
                  <td style={{ ...tdR, color: '#86efac', fontWeight: 600 }}>{f1(o.logged)}h</td>
                  <td style={{ ...tdR, color: '#94a3b8' }}>{f1(o.predicted)}h</td>
                  <td style={{ ...tdR, color: o.logRatio > 0 ? '#fca5a5' : '#93c5fd', fontWeight: 600 }}>
                    {o.logRatio > 0 ? '×' : '÷'}{f1(Math.exp(Math.abs(o.logRatio)))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Section 5. Out-of-sample backtest */}
      <Card>
        <CardHeader
          title="Out-of-sample forecast test"
          subtitle="Each sprint predicted from PRIOR sprints' rate only — the honest accuracy measure"
          right={M.backtest.rows.length > 0 && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#6b7280', fontSize: 12 }}>Backtest MdAPE</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: M.backtest.mdape > 40 ? '#ef4444' : M.backtest.mdape > 20 ? '#f59e0b' : '#22c55e' }}>{pctI(M.backtest.mdape)}%</div>
            </div>
          )}
        />
        {M.backtest.rows.length === 0 ? (
          <Disabled msg="Needs ≥4 completed sprints (each forecast uses ≥3 prior sprints)." />
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={M.backtest.rows} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip {...TOOLTIP_STYLE} formatter={v => [`${v >= 0 ? '+' : ''}${pctI(v)}%`, 'forecast error']} />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.25)" />
                <Bar dataKey="errorPct" radius={[3, 3, 0, 0]} maxBarSize={40}>
                  {M.backtest.rows.map((r, i) => (
                    <Cell key={i} fill={Math.abs(r.errorPct) > 25 ? '#ef4444' : '#22c55e'} opacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 640 }}>
                <thead>
                  <tr style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>
                    <th style={thL}>Sprint</th><th style={thR}>Prior rate (h/SP)</th><th style={thR}>Committed SP</th>
                    <th style={thR}>Predicted h</th><th style={thR}>Actual h</th><th style={thR}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {M.backtest.rows.map((r, i) => (
                    <tr key={r.sprint + i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ ...tdL, color: '#e2e8f0', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.sprint}>{r.sprint}</td>
                      <td style={{ ...tdR, color: '#94a3b8' }}>{f1(r.rate)}</td>
                      <td style={{ ...tdR, color: '#c4b5fd' }}>{f1(r.committedSP)}</td>
                      <td style={{ ...tdR, color: '#94a3b8' }}>{f1(r.predicted)}h</td>
                      <td style={{ ...tdR, color: '#86efac', fontWeight: 600 }}>{f1(r.actual)}h</td>
                      <td style={{ ...tdR, color: Math.abs(r.errorPct) > 25 ? '#fca5a5' : '#86efac', fontWeight: 600 }}>{r.errorPct >= 0 ? '+' : ''}{pctI(r.errorPct)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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

      {/* Monotonicity + overlap checks */}
      <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Monotonicity — do medians strictly increase?</div>
        {M.monotonic.length === 0 ? (
          <div style={{ fontSize: 12, color: '#6b7280' }}>Not enough adjacent buckets (n≥5) to check.</div>
        ) : M.monotonic.map((m, i) => (
          <div key={i} style={{ fontSize: 12.5, color: m.pass ? '#86efac' : '#fca5a5' }}>
            {m.pass ? '✓' : '✗'} {m.from} → {m.to}: {m.pass ? 'PASS' : `FAIL — ${m.detail}`}
          </div>
        ))}
        {M.overlaps.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 8 }}>Adjacent-bucket overlap — are neighbouring sizes distinguishable?</div>
            {M.overlaps.map((o, i) => (
              <div key={i} style={{ fontSize: 12.5, color: o.pct > 30 ? '#fca5a5' : '#94a3b8' }}>
                {o.pct > 30 ? '⚠' : '·'} {o.pct}% of {o.to}-pointers took less than the {o.from}-pointer median{o.pct > 30 ? ' — sizes not distinguishable, consider collapsing the scale' : ''}
              </div>
            ))}
          </>
        )}
      </div>
    </Card>
  );
}

function WhatThisMeans({ M, gapPct, typeLabel }) {
  const lines = [];
  // 1. sample + coverage + flags
  lines.push(`Sample: ${M.n} completed, pointed, time-logged ${typeLabel} tickets (${M.logCoverage}% log coverage${M.carryoverRate > 25 ? `, ${M.carryoverRate}% carried over` : ''}). Round-number bias isn't checked (needs worklog-level data).`);
  // 2. calibration gap (bias)
  const gapWord = Math.abs(gapPct) < 10 ? 'close to' : gapPct >= 0 ? 'above' : 'below';
  lines.push(`Observed rate: median ${f1(M.medianHoursPerSP)} h/SP (IQR ${f1(M.iqr[0])}–${f1(M.iqr[1])}). That is ${gapPct >= 0 ? '+' : ''}${pctI(gapPct)}% ${gapWord} your ${f1(M.planningHoursPerSP)} h/SP capacity constant. This is a calibration gap (bias), NOT an estimation error — it's fixed by changing one planning number, and says nothing about estimate quality.`);
  // 3. consistency (noise)
  const spreadWord = M.spreadFactor < 1.5 ? 'tight' : M.spreadFactor <= 2.0 ? 'workable' : 'wide — points carry little information';
  const discWord = M.discrimination >= 0.7 ? 'strong: larger estimates reliably take longer' : M.discrimination >= 0.4 ? 'weak: larger estimates only loosely take longer' : 'near-noise: story points barely predict effort';
  lines.push(`Consistency (the real question): spread factor ×${f1(M.spreadFactor)} (${ciTxt(M.spreadCI)}) — a typical ticket lands within this factor of prediction, ${spreadWord}. Discrimination ${f2(M.discrimination)} (${ciTxt(M.discriminationCI)}) — ${discWord}.`);
  // 4. monotonicity failures
  const fails = M.monotonic.filter(m => !m.pass);
  if (fails.length) lines.push(`Monotonicity failures: ${fails.map(m => `${m.from}→${m.to}`).join(', ')} — larger estimates took less time on median. Concrete retro items.`);
  // 5. backtest reality
  if (M.backtest.rows.length) lines.push(`Out-of-sample: forecasting each sprint from prior sprints only was off by a median ${pctI(M.backtest.mdape)}% (MdAPE). This is the number to quote for "how good is our estimating".`);

  // Recommendation — exactly one
  let rec, recColor;
  if (M.spreadFactor > 2.0 || M.discrimination < 0.4) {
    rec = `Tighten estimation practice. The problem is noise, not the planning constant — recalibrating won't help. Re-point using reference stories, break down anything ≥8 SP, and work the miss list above in retro.`;
    recColor = '#fca5a5';
  } else if (Math.abs(gapPct) > 20) {
    rec = `Recalibrate the capacity constant to ~${f1(M.medianHoursPerSP)} h/SP. Estimates are internally consistent; only the planning assumption is off. This is a one-number fix, not an estimation problem.`;
    recColor = '#fcd34d';
  } else {
    rec = `No structural action needed — estimates are consistent (spread ×${f1(M.spreadFactor)}, discrimination ${f2(M.discrimination)}) and the planning constant is within ${pctI(Math.abs(gapPct))}% of observed. Keep monitoring drift and the backtest.`;
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
function computeMetrics(tickets, today, typeMode, planningHoursPerSP) {
  const allow = new Set(ALLOWED_TYPES);

  // Eligible = completed + pointed + allowed type (regardless of logging) — for coverage
  const eligible = tickets.filter(t => {
    const type = getType(t).toLowerCase();
    if (type === 'epic') return false;
    if (!allow.has(type)) return false;
    if (typeMode !== 'pool' && type !== typeMode) return false;
    if (!isDone(getStatus(t))) return false;         // Done-only removes the in-progress SP/hours bias
    return getSP(t) > 0;
  });

  const sample = eligible
    .filter(t => getLoggedSec(t) > 0)
    .map(t => {
      const sp = getSP(t);
      const hours = toHours(getLoggedSec(t));
      const raw = t._rawFields || {};
      const sf = raw.customfield_10010 || raw.sprint;
      return {
        key: getKey(t), summary: getSummary(t), assignee: getAssignee(t), project: getProject(t),
        sprint: getSprint(t) || 'No Sprint', sp, hours, hoursPerSP: hours / sp,
        carry: Array.isArray(sf) && sf.length > 1,
      };
    });

  const n = sample.length;
  const eligibleN = eligible.length;
  const logCoverage = eligibleN > 0 ? Math.round((n / eligibleN) * 100) : 0;
  const carryoverRate = n > 0 ? Math.round((sample.filter(s => s.carry).length / n) * 100) : 0;

  const base = { n, eligibleN, logCoverage, carryoverRate, planningHoursPerSP, roundNumberBiasUnavailable: true };

  // Gates
  if (n < 30) {
    return { ...base, disabled: { reason: 'insufficient sample', detail: `Need ≥30 completed, pointed, time-logged tickets for a headline metric. Have n=${n}${eligibleN > n ? ` (${eligibleN - n} eligible tickets have no logged time)` : ''}.` } };
  }
  if (logCoverage < 70) {
    return { ...base, disabled: { reason: 'low log coverage', detail: `Only ${logCoverage}% of the ${eligibleN} completed pointed tickets have any logged time (need ~70%). Figures would be dominated by whoever logs, not by the work. Improve worklog discipline first.` } };
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

  // Monotonicity + overlap (adjacent buckets, both n≥5)
  const enoughB = buckets.filter(b => b.enough);
  const monotonic = [], overlaps = [];
  for (let i = 1; i < enoughB.length; i++) {
    const lo = enoughB[i - 1], hi = enoughB[i];
    const pass = hi.medianHours > lo.medianHours;
    monotonic.push({ from: `${lo.sp}`, to: `${hi.sp}`, pass, detail: pass ? '' : `${hi.sp}-pointers median ${f1(hi.medianHours)}h vs ${lo.sp}-pointers ${f1(lo.medianHours)}h` });
    const hiItems = bySp[hi.sp];
    const belowLoMedian = hiItems.filter(x => x.hours < lo.medianHours).length;
    overlaps.push({ from: `${lo.sp}`, to: `${hi.sp}`, pct: Math.round((belowLoMedian / hiItems.length) * 100) });
  }

  // Scatter
  const allHours = sample.map(s => s.hours);
  const yDomain = [Math.max(0.1, Math.min(...allHours) * 0.7), Math.max(...allHours) * 1.4];
  const maxX = Math.max(...spValues) + 1;
  const hits = [], misses = [];
  for (const s of sample) {
    const predicted = medianHoursPerSP * s.sp;
    const miss = Math.abs(s.hours - predicted) > 0.5 * predicted;
    const pt = { x: s.sp + keyJitter(s.key), y: s.hours, sp: s.sp, key: s.key, summary: s.summary, assignee: s.assignee };
    (miss ? misses : hits).push(pt);
  }
  const rayXs = [spValues[0], ...spValues, maxX].filter((v, i, a) => a.indexOf(v) === i).sort((a, b) => a - b);
  const ray = rayXs.map(x => ({ x, y: medianHoursPerSP * x }));
  const bandHi = rayXs.map(x => ({ x, y: 1.5 * medianHoursPerSP * x }));
  const bandLo = rayXs.map(x => ({ x, y: 0.5 * medianHoursPerSP * x }));
  const scatter = { hits, misses, ray, bandHi, bandLo, yDomain, maxX, spValues };

  // Outliers
  const outliers = [...sample]
    .map(s => ({ key: s.key, summary: s.summary, assignee: s.assignee, sp: s.sp, logged: s.hours, predicted: medianHoursPerSP * s.sp, logRatio: Math.log(s.hoursPerSP / medianHoursPerSP) }))
    .sort((a, b) => Math.abs(b.logRatio) - Math.abs(a.logRatio))
    .slice(0, 10);

  // Sprint ordering (completed only)
  const sprintNames = [...new Set(sample.map(s => s.sprint))]
    .filter(name => sprintState(name, today) === 'past' && parseSprintDates(name))
    .sort((a, b) => parseSprintDates(a).start - parseSprintDates(b).start);

  // Drift (last 8 completed sprints, bucket n≥5)
  const drift = sprintNames.map(name => {
    const items = sample.filter(s => s.sprint === name);
    if (items.length < 5) return null;
    const perSp = items.map(i => i.hoursPerSP);
    return { label: shortSprintLabel(name), n: items.length, median: median(perSp), p25: quantile(perSp, 0.25), p75: quantile(perSp, 0.75) };
  }).filter(Boolean).slice(-8);

  // Backtest: predict each sprint from PRIOR sprints only (≥3 prior)
  const btRows = [];
  for (let i = 3; i < sprintNames.length; i++) {
    const priorNames = new Set(sprintNames.slice(0, i));
    const priorItems = sample.filter(s => priorNames.has(s.sprint));
    const curItems = sample.filter(s => s.sprint === sprintNames[i]);
    if (priorItems.length < 5 || curItems.length < 3) continue;
    const rate = median(priorItems.map(s => s.hoursPerSP));
    const committedSP = curItems.reduce((a, s) => a + s.sp, 0);
    const predicted = committedSP * rate;
    const actual = curItems.reduce((a, s) => a + s.hours, 0);
    if (predicted <= 0) continue;
    btRows.push({ sprint: sprintNames[i], label: shortSprintLabel(sprintNames[i]), rate, committedSP, predicted, actual, errorPct: ((actual - predicted) / predicted) * 100 });
  }
  const backtest = { rows: btRows, mdape: btRows.length ? median(btRows.map(r => Math.abs(r.errorPct))) : NaN };

  return {
    ...base, disabled: null,
    medianHoursPerSP, iqr, medianCI, spreadFactor, spreadCI,
    discrimination, discriminationCI, hitRate, hitRateCI, mdape, mdapeCI,
    buckets, monotonic, overlaps, scatter, outliers, drift, backtest,
  };
}
