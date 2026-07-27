import React, { useMemo, useState } from 'react';
import {
  ComposedChart, Bar, Line, BarChart,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import { Clock, Timer, Gauge, Layers } from 'lucide-react';

// ─── Jira field accessors ─────────────────────────────────────────────────────
const getStatus   = t => t['Status'] || '';
const getSP       = t => parseFloat(t['Story Points']) || parseFloat(t['Story points']) || parseFloat(t['Custom field (Story Points)']) || 0;
const getSprint   = t => t['Sprint'] || t['G'] || '';
const getAssignee = t => t['Assignee'] || t['D'] || 'Unassigned';
const getProject  = t => t['Project'] || t['B'] || 'Unknown';
const getKey      = t => t['Key'] || t['Issue key'] || '';
const getSummary  = t => t['Summary'] || '';
const getType     = t => t['Issue Type'] || '';

// Time-tracking accessors — Jira stores these in SECONDS
const getLoggedSec   = t => parseFloat(t['Time Spent']) || 0;
const getEstimateSec = t => parseFloat(t['Original Estimate']) || 0;
const getRemainSec   = t => parseFloat(t['Remaining Estimate']) || 0;

const SEC_PER_HOUR = 3600;
const toHours = sec => (sec || 0) / SEC_PER_HOUR;
const fmtHnum = sec => Math.round(toHours(sec) * 10) / 10;

// ─── Status helpers ───────────────────────────────────────────────────────────
const normStatus = (s = '') => s.toLowerCase().trim();
const isDone = s => ['done','completed','closed','resolved'].includes(normStatus(s));

// ─── Sprint date parsing (matches Sprint Health tab format) ───────────────────
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
  if (today > dates.end)   return 'past';
  return 'active';
}

function shortSprintLabel(name) {
  return (name || 'No Sprint')
    .replace(/Sprint\s*/i, 'S')
    .replace(/\s+\d{2}-\d{2}-\d{2}\s+to\s+\d{2}-\d{2}-\d{2}/, '');
}

// ─── Shared UI (matches SprintHealthTab styling) ──────────────────────────────
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

function StatusAdvice({ narrative, advice, adviceColor = '#86efac' }) {
  return (
    <div style={{ marginTop: 14, padding: '12px 14px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>📊 What this means</div>
      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{narrative}</div>
      <div style={{ fontSize: 12, color: adviceColor, marginTop: 8, lineHeight: 1.6 }}>
        <strong>✅ Recommended: </strong>{advice}
      </div>
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
    <div style={{ flex: '1 1 160px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 12, marginBottom: 8 }}>
        {Icon && <Icon size={14} style={{ color }} />}{label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

const STATE_META = {
  active:  { label: 'Active',  color: '#22c55e' },
  past:    { label: 'Past',    color: '#94a3b8' },
  future:  { label: 'Future',  color: '#60a5fa' },
  unknown: { label: 'Undated', color: '#6b7280' },
};

// ─── Main component ───────────────────────────────────────────────────────────
export default function TimeTrackingTab({ tickets = [], selectedSprint = 'all', selectedAssignee = 'all', selectedProject = 'all' }) {
  const today = useMemo(() => new Date(), []);
  const [expandTickets, setExpandTickets] = useState(false);

  // Per-sprint aggregation across the current filter scope
  const { sprintRows, totals } = useMemo(() => {
    const map = {};
    for (const t of tickets) {
      const sprint = getSprint(t) || 'No Sprint';
      if (!map[sprint]) {
        map[sprint] = {
          sprint,
          label: shortSprintLabel(sprint),
          state: sprintState(sprint, today),
          sp: 0, doneSP: 0,
          loggedSec: 0, estimateSec: 0, remainSec: 0,
          tickets: 0, ticketsWithLog: 0, ticketsWithSP: 0,
        };
      }
      const row = map[sprint];
      const sp = getSP(t);
      row.sp += sp;
      if (isDone(getStatus(t))) row.doneSP += sp;
      row.loggedSec   += getLoggedSec(t);
      row.estimateSec += getEstimateSec(t);
      row.remainSec   += getRemainSec(t);
      row.tickets += 1;
      if (getLoggedSec(t) > 0) row.ticketsWithLog += 1;
      if (sp > 0) row.ticketsWithSP += 1;
    }

    const rows = Object.values(map).map(r => {
      const loggedH = toHours(r.loggedSec);
      const estH = toHours(r.estimateSec);
      return {
        ...r,
        loggedH: Math.round(loggedH * 10) / 10,
        estH: Math.round(estH * 10) / 10,
        remainH: Math.round(toHours(r.remainSec) * 10) / 10,
        hoursPerSP: r.sp > 0 ? Math.round((loggedH / r.sp) * 10) / 10 : 0,
        // logged vs estimate variance %  (positive = over the estimate)
        estVariancePct: estH > 0 ? Math.round(((loggedH - estH) / estH) * 100) : null,
        logCoverage: r.tickets > 0 ? Math.round((r.ticketsWithLog / r.tickets) * 100) : 0,
      };
    });

    // Sort chronologically (dated sprints first by start date, undated last)
    rows.sort((a, b) => {
      const dA = parseSprintDates(a.sprint);
      const dB = parseSprintDates(b.sprint);
      if (dA && dB) return dA.start - dB.start;
      if (dA) return -1;
      if (dB) return 1;
      return a.sprint.localeCompare(b.sprint);
    });

    const totals = rows.reduce((acc, r) => {
      acc.sp += r.sp;
      acc.loggedSec += r.loggedSec;
      acc.estimateSec += r.estimateSec;
      acc.remainSec += r.remainSec;
      acc.tickets += r.tickets;
      acc.ticketsWithLog += r.ticketsWithLog;
      return acc;
    }, { sp: 0, loggedSec: 0, estimateSec: 0, remainSec: 0, tickets: 0, ticketsWithLog: 0 });

    return { sprintRows: rows, totals };
  }, [tickets, today]);

  const totalLoggedH = fmtHnum(totals.loggedSec);
  const totalEstH = fmtHnum(totals.estimateSec);
  const avgHoursPerSP = totals.sp > 0 ? Math.round((toHours(totals.loggedSec) / totals.sp) * 10) / 10 : 0;
  const logCoverage = totals.tickets > 0 ? Math.round((totals.ticketsWithLog / totals.tickets) * 100) : 0;
  const estVariancePct = totalEstH > 0 ? Math.round(((totalLoggedH - totalEstH) / totalEstH) * 100) : null;

  // Chart data — one entry per sprint (SP vs logged hours + estimate)
  const chartData = sprintRows
    .filter(r => r.sp > 0 || r.loggedH > 0)
    .map(r => ({
      label: r.label,
      state: r.state,
      SP: Math.round(r.sp * 10) / 10,
      Logged: r.loggedH,
      Estimated: r.estH,
    }));

  // Ticket-level breakdown for the selected sprint (or all sprints if 'all')
  const ticketRows = useMemo(() => {
    const rows = tickets
      .filter(t => getLoggedSec(t) > 0 || getSP(t) > 0 || getEstimateSec(t) > 0)
      .map(t => {
        const sp = getSP(t);
        const loggedH = toHours(getLoggedSec(t));
        const estH = toHours(getEstimateSec(t));
        return {
          key: getKey(t),
          summary: getSummary(t),
          type: getType(t),
          assignee: getAssignee(t),
          project: getProject(t),
          sprint: getSprint(t) || 'No Sprint',
          status: getStatus(t),
          sp,
          loggedH: Math.round(loggedH * 10) / 10,
          estH: Math.round(estH * 10) / 10,
          hoursPerSP: sp > 0 ? Math.round((loggedH / sp) * 10) / 10 : null,
          estVariancePct: estH > 0 ? Math.round(((loggedH - estH) / estH) * 100) : null,
        };
      })
      .sort((a, b) => b.loggedH - a.loggedH);
    return rows;
  }, [tickets]);

  // Per-assignee breakdown for the selected sprint (only meaningful with one sprint)
  const assigneeRows = useMemo(() => {
    const map = {};
    for (const t of tickets) {
      const name = getAssignee(t);
      if (!map[name]) map[name] = { name, sp: 0, loggedSec: 0, estimateSec: 0 };
      map[name].sp += getSP(t);
      map[name].loggedSec += getLoggedSec(t);
      map[name].estimateSec += getEstimateSec(t);
    }
    return Object.values(map)
      .map(a => ({
        ...a,
        loggedH: fmtHnum(a.loggedSec),
        estH: fmtHnum(a.estimateSec),
        hoursPerSP: a.sp > 0 ? Math.round((toHours(a.loggedSec) / a.sp) * 10) / 10 : 0,
      }))
      .filter(a => a.loggedH > 0 || a.sp > 0)
      .sort((a, b) => b.loggedH - a.loggedH)
      .slice(0, 15);
  }, [tickets]);

  const activeRows = sprintRows.filter(r => r.state === 'active');
  const pastRows   = sprintRows.filter(r => r.state === 'past');

  // Narrative for the SP-vs-time comparison
  let narrative, advice, adviceColor;
  if (totals.loggedSec === 0) {
    narrative = 'No time has been logged against tickets in the current view, so story points cannot be compared to actual effort. Time Tracking must be enabled in Jira and team members need to log work on their tickets.';
    advice = 'Ask the team to log work (Time Spent) on tickets. Once worklogs exist, this tab shows how many hours each story point actually costs and whether estimates hold up.';
    adviceColor = '#93c5fd';
  } else if (logCoverage < 40) {
    narrative = `Only ${logCoverage}% of tickets have any logged time (${totalLoggedH}h across ${totals.ticketsWithLog} of ${totals.tickets} tickets). The story-points-to-hours comparison is based on partial data and may understate real effort.`;
    advice = 'Improve worklog discipline before relying on the h/SP ratio for planning. Encourage logging time at least daily so the comparison reflects the whole sprint.';
    adviceColor = '#fca5a5';
  } else if (avgHoursPerSP > 0) {
    const wide = estVariancePct !== null && Math.abs(estVariancePct) > 25;
    narrative = `Across the current view, ${totals.sp} SP consumed ${totalLoggedH}h of logged work — about ${avgHoursPerSP}h per story point${totalEstH > 0 ? `, against ${totalEstH}h originally estimated (${estVariancePct >= 0 ? '+' : ''}${estVariancePct}%)` : ''}. ${logCoverage}% of tickets have logged time.`;
    advice = wide
      ? `Actuals differ from estimates by ${Math.abs(estVariancePct)}%. Use the ~${avgHoursPerSP}h/SP actual figure (not the original estimate) when forecasting the next sprint, and revisit how the team sizes points versus hours.`
      : `Estimates and actuals are reasonably aligned. Use ~${avgHoursPerSP}h per story point as a sanity check when committing the next sprint's points against available capacity.`;
    adviceColor = wide ? '#fca5a5' : '#86efac';
  } else {
    narrative = `${totalLoggedH}h logged but no story points are attached to these tickets, so an hours-per-point ratio can't be computed.`;
    advice = 'Add story points to estimated work so effort (hours) can be compared against sizing (points).';
    adviceColor = '#93c5fd';
  }

  if (tickets.length === 0) {
    return (
      <div style={{ padding: '48px 0', textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
        No tickets match the current filters.
      </div>
    );
  }

  const scopeLabel = [
    selectedSprint !== 'all' ? selectedSprint : 'All sprints',
    selectedProject !== 'all' ? selectedProject : null,
    selectedAssignee !== 'all' ? selectedAssignee : null,
  ].filter(Boolean).join(' · ');

  return (
    <div>
      {/* KPI summary */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <KpiTile icon={Layers} label="Story Points"      value={Math.round(totals.sp * 10) / 10} sub={`${totals.tickets} tickets in view`} color="#a855f7" />
        <KpiTile icon={Clock}  label="Time Logged"       value={`${totalLoggedH}h`} sub={`${logCoverage}% of tickets logged time`} color="#22c55e" />
        <KpiTile icon={Timer}  label="Original Estimate" value={`${totalEstH}h`} sub={estVariancePct !== null ? `logged ${estVariancePct >= 0 ? '+' : ''}${estVariancePct}% vs estimate` : 'no estimates set'} color="#f59e0b" />
        <KpiTile icon={Gauge}  label="Hours / Story Point" value={avgHoursPerSP ? `${avgHoursPerSP}h` : '—'} sub="actual effort per SP" color="#60a5fa" />
      </div>

      {/* SP vs Time chart */}
      <Card>
        <CardHeader
          title="Story Points vs Logged Time — by Sprint"
          subtitle={`${scopeLabel} · story points committed against hours actually logged`}
          right={
            <div style={{ display: 'flex', gap: 14, fontSize: 11, alignItems: 'center' }}>
              {[['#a855f7','Story Points'],['#22c55e','Logged h'],['#f59e0b','Estimate h']].map(([c,l]) => (
                <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#9ca3af' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{l}
                </span>
              ))}
            </div>
          }
        />
        {chartData.length === 0 ? (
          <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 13 }}>
            No story points or logged time in the current view
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} interval={0} angle={chartData.length > 6 ? -30 : 0} textAnchor={chartData.length > 6 ? 'end' : 'middle'} height={chartData.length > 6 ? 60 : 30} />
              <YAxis yAxisId="sp"    tick={{ fill: '#a855f7', fontSize: 11 }} axisLine={false} tickLine={false} label={{ value: 'SP', angle: -90, position: 'insideLeft', fill: '#a855f7', fontSize: 11 }} />
              <YAxis yAxisId="hours" orientation="right" tick={{ fill: '#22c55e', fontSize: 11 }} axisLine={false} tickLine={false} label={{ value: 'Hours', angle: 90, position: 'insideRight', fill: '#22c55e', fontSize: 11 }} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [n === 'SP' ? `${v} SP` : `${v}h`, n]} />
              <Bar  yAxisId="sp"    dataKey="SP"        fill="#a855f7" radius={[4,4,0,0]} maxBarSize={34} name="SP" opacity={0.85} />
              <Bar  yAxisId="hours" dataKey="Logged"    fill="#22c55e" radius={[4,4,0,0]} maxBarSize={34} name="Logged" opacity={0.85} />
              <Line yAxisId="hours" dataKey="Estimated" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3, fill: '#f59e0b' }} name="Estimated" />
            </ComposedChart>
          </ResponsiveContainer>
        )}
        <StatusAdvice narrative={narrative} advice={advice} adviceColor={adviceColor} />
      </Card>

      {/* Per-sprint table: active + past */}
      <SprintTable title="Active Sprints" subtitle="Sprints in progress today" rows={activeRows} highlight />
      <SprintTable title="Past Sprints" subtitle="Completed sprints — historical estimate accuracy" rows={pastRows} />
      {activeRows.length === 0 && pastRows.length === 0 && (
        <SprintTable title="All Sprints" subtitle="Sprint dates could not be parsed to classify active vs past" rows={sprintRows} />
      )}

      {/* Per-assignee breakdown */}
      {assigneeRows.length > 0 && (
        <Card>
          <CardHeader
            title="Story Points vs Logged Time — by Assignee"
            subtitle={`${scopeLabel} · effort logged per person`}
          />
          <ResponsiveContainer width="100%" height={Math.max(180, assigneeRows.length * 34)}>
            <BarChart data={assigneeRows} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
              <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.04)" />
              <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fill: '#e2e8f0', fontSize: 12 }} axisLine={false} tickLine={false} width={130} />
              <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [n === 'Logged h' ? `${v}h` : (n === 'SP' ? `${v} SP` : v), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="loggedH" fill="#22c55e" name="Logged h" radius={[0,4,4,0]} maxBarSize={18} />
              <Bar dataKey="sp"      fill="#a855f7" name="SP"       radius={[0,4,4,0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      {/* Ticket-level detail */}
      <Card>
        <CardHeader
          title="Ticket-Level Time vs Points"
          subtitle={`${ticketRows.length} tickets with story points or logged time — sorted by hours logged`}
          right={ticketRows.length > 12 && (
            <button onClick={() => setExpandTickets(e => !e)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#94a3b8' }}>
              {expandTickets ? '▲ Show fewer' : `▼ Show all ${ticketRows.length}`}
            </button>
          )}
        />
        {ticketRows.length === 0 ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#6b7280', fontSize: 13 }}>No tickets with story points or logged time</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 720 }}>
              <thead>
                <tr style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>
                  <th style={thL}>Key</th>
                  <th style={thL}>Summary</th>
                  <th style={thL}>Assignee</th>
                  <th style={thR}>SP</th>
                  <th style={thR}>Est</th>
                  <th style={thR}>Logged</th>
                  <th style={thR}>h/SP</th>
                  <th style={thR}>vs Est</th>
                </tr>
              </thead>
              <tbody>
                {(expandTickets ? ticketRows : ticketRows.slice(0, 12)).map((t, i) => (
                  <tr key={t.key + i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ ...tdL, color: '#60a5fa', fontWeight: 500, whiteSpace: 'nowrap' }}>{t.key}</td>
                    <td style={{ ...tdL, color: '#e2e8f0', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.summary}>{t.summary}</td>
                    <td style={{ ...tdL, color: '#94a3b8', whiteSpace: 'nowrap' }}>{t.assignee}</td>
                    <td style={{ ...tdR, color: '#c4b5fd' }}>{t.sp > 0 ? t.sp : '—'}</td>
                    <td style={{ ...tdR, color: '#94a3b8' }}>{t.estH > 0 ? `${t.estH}h` : '—'}</td>
                    <td style={{ ...tdR, color: '#86efac', fontWeight: 600 }}>{t.loggedH > 0 ? `${t.loggedH}h` : '—'}</td>
                    <td style={{ ...tdR, color: '#e2e8f0' }}>{t.hoursPerSP !== null ? `${t.hoursPerSP}h` : '—'}</td>
                    <td style={{ ...tdR }}>
                      {t.estVariancePct === null ? <span style={{ color: '#6b7280' }}>—</span> : (
                        <span style={{ color: t.estVariancePct > 15 ? '#fca5a5' : t.estVariancePct < -15 ? '#93c5fd' : '#86efac' }}>
                          {t.estVariancePct >= 0 ? '+' : ''}{t.estVariancePct}%
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

const thL = { textAlign: 'left', padding: '8px 10px', fontWeight: 600 };
const thR = { textAlign: 'right', padding: '8px 10px', fontWeight: 600 };
const tdL = { textAlign: 'left', padding: '9px 10px' };
const tdR = { textAlign: 'right', padding: '9px 10px', fontVariantNumeric: 'tabular-nums' };

// ─── Per-sprint comparison table ──────────────────────────────────────────────
function SprintTable({ title, subtitle, rows, highlight = false }) {
  if (!rows || rows.length === 0) return null;
  return (
    <Card style={highlight ? { border: '1px solid rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.04)' } : {}}>
      <CardHeader title={title} subtitle={subtitle} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 760 }}>
          <thead>
            <tr style={{ color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 10 }}>
              <th style={thL}>Sprint</th>
              <th style={thR}>Tickets</th>
              <th style={thR}>SP</th>
              <th style={thR}>Est</th>
              <th style={thR}>Logged</th>
              <th style={thR}>Remaining</th>
              <th style={thR}>h / SP</th>
              <th style={thR}>Logged vs Est</th>
              <th style={thR}>Log Coverage</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const meta = STATE_META[r.state] || STATE_META.unknown;
              return (
                <tr key={r.sprint + i} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ ...tdL }}>
                    <div style={{ color: '#e2e8f0', fontWeight: 500, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.sprint}>{r.sprint}</div>
                    <span style={{ fontSize: 10, color: meta.color, background: `${meta.color}18`, border: `1px solid ${meta.color}40`, padding: '1px 6px', borderRadius: 4 }}>{meta.label}</span>
                  </td>
                  <td style={{ ...tdR, color: '#94a3b8' }}>{r.tickets}</td>
                  <td style={{ ...tdR, color: '#c4b5fd', fontWeight: 600 }}>{Math.round(r.sp * 10) / 10}</td>
                  <td style={{ ...tdR, color: '#94a3b8' }}>{r.estH > 0 ? `${r.estH}h` : '—'}</td>
                  <td style={{ ...tdR, color: '#86efac', fontWeight: 600 }}>{r.loggedH > 0 ? `${r.loggedH}h` : '—'}</td>
                  <td style={{ ...tdR, color: '#94a3b8' }}>{r.remainH > 0 ? `${r.remainH}h` : '—'}</td>
                  <td style={{ ...tdR, color: '#e2e8f0' }}>{r.hoursPerSP > 0 ? `${r.hoursPerSP}h` : '—'}</td>
                  <td style={{ ...tdR }}>
                    {r.estVariancePct === null ? <span style={{ color: '#6b7280' }}>—</span> : (
                      <span style={{ color: r.estVariancePct > 15 ? '#fca5a5' : r.estVariancePct < -15 ? '#93c5fd' : '#86efac' }}>
                        {r.estVariancePct >= 0 ? '+' : ''}{r.estVariancePct}%
                      </span>
                    )}
                  </td>
                  <td style={{ ...tdR }}>
                    <span style={{ color: r.logCoverage >= 60 ? '#86efac' : r.logCoverage >= 30 ? '#fcd34d' : '#fca5a5' }}>{r.logCoverage}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
