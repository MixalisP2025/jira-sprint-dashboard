import React, { useMemo, useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, CartesianGrid,
} from 'recharts';
import { CheckCircle, AlertCircle, Clock, TrendingUp, Users, Zap } from 'lucide-react';

// ─── Jira field accessors ─────────────────────────────────────────────────────
const getStatus   = t => t['Status'] || '';
const getSP       = t => parseFloat(t['Story Points']) || 0;
const getSprint   = t => t['Sprint'] || t['G'] || '';
const getAssignee = t => t['Assignee'] || t['D'] || 'Unassigned';
const getProject  = t => t['Project'] || t['B'] || 'Unknown';
const getKey      = t => t['Key'] || t['Issue key'] || '';
const getSummary  = t => t['Summary'] || '';
const getType     = t => t['Issue Type'] || '';
const getCreated  = t => t['Created'] || null;
const getUpdated  = t => t['Updated'] || null;
const getDue      = t => t['Due Date'] || t['dueDate'] || null;

// ─── Status helpers ───────────────────────────────────────────────────────────
const normStatus = (s = '') => s.toLowerCase().trim();
const isDone = s => ['done','completed','closed','resolved'].includes(normStatus(s));
const isInP  = s => normStatus(s) === 'in progress';

function daysBetween(a, b) {
  if (!a) return 0;
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
}

// ─── Greek public holidays (fixed + Easter-based) ────────────────────────────
function getGreekHolidays(year) {
  // Fixed public holidays
  const fixed = [
    `${year}-01-01`, // New Year's Day
    `${year}-01-06`, // Epiphany
    `${year}-03-25`, // Independence Day
    `${year}-05-01`, // Labour Day
    `${year}-08-15`, // Assumption of Mary
    `${year}-10-28`, // Ohi Day
    `${year}-12-25`, // Christmas Day
    `${year}-12-26`, // Second Day of Christmas
  ];

  // Easter (Orthodox) — Meeus/Jones/Butcher algorithm for Julian calendar
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  // Convert Julian to Gregorian (add 13 days for 21st century)
  const julianEaster = new Date(year, month - 1, day + 13);
  const easterSunday = julianEaster;

  const addDays = (date, n) => {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  const easterStr = easterSunday.toISOString().slice(0, 10);
  const movable = [
    addDays(easterSunday, -48), // Clean Monday (Kathari Deftera)
    addDays(easterSunday, -2),  // Good Friday
    easterStr,                   // Easter Sunday
    addDays(easterSunday, 1),   // Easter Monday
    addDays(easterSunday, 50),  // Whit Monday (Agiou Pneumatos)
  ];

  return new Set([...fixed, ...movable]);
}

// Count working days between two dates (exclusive of start, inclusive of end)
// Skips weekends and Greek public holidays
function workingDaysBetween(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate);
  const end   = new Date(endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  if (end <= start) return 0;

  // Pre-compute holidays for all years in range
  const holidays = new Set();
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    getGreekHolidays(y).forEach(h => holidays.add(h));
  }

  let count = 0;
  const cur = new Date(start);
  cur.setDate(cur.getDate() + 1); // start exclusive
  while (cur <= end) {
    const dow = cur.getDay();
    const iso = cur.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function getTicketAge(t, today) {
  const dateStr = getUpdated(t) || getCreated(t);
  return dateStr ? daysBetween(dateStr, today) : 0;
}

function getAgeCategory(days) {
  if (days <= 3)  return { label: 'Fresh',  color: '#22c55e' };
  if (days <= 7)  return { label: 'Normal', color: '#60a5fa' };
  if (days <= 14) return { label: 'Ageing', color: '#f59e0b' };
  return               { label: 'Stale',  color: '#ef4444' };
}

function parseSprintDates(name) {
  const m = name?.match(/(\d{2}-\d{2}-\d{2})\s+to\s+(\d{2}-\d{2}-\d{2})/);
  if (m) {
    const parse = s => { const [d, mo, y] = s.split('-'); return new Date(`20${y}-${mo}-${d}`); };
    return { start: parse(m[1]), end: parse(m[2]) };
  }
  return null;
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
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>{title}</div>
        {subtitle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

function InsightBox({ color, children }) {
  return (
    <div style={{ marginTop: 14, padding: '9px 12px', background: `${color}10`, border: `1px solid ${color}30`, borderRadius: 8, fontSize: 12, color }}>
      {children}
    </div>
  );
}

const TOOLTIP_STYLE = {
  contentStyle: { background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 },
  labelStyle: { color: '#e2e8f0' },
  itemStyle: { color: '#94a3b8' },
};

// ─── SprintVelocityTrend ──────────────────────────────────────────────────────
function SprintVelocityTrend({ tickets = [], sprints = [], selectedProject, selectedAssignee }) {
  const data = useMemo(() => {
    const bySprintMap = {};
    for (const t of tickets) {
      if (!isDone(getStatus(t))) continue;
      if (selectedProject && selectedProject !== 'all' && getProject(t) !== selectedProject) continue;
      if (selectedAssignee && selectedAssignee !== 'all' && getAssignee(t) !== selectedAssignee) continue;
      const key = getSprint(t) || 'Unknown';
      if (!bySprintMap[key]) bySprintMap[key] = { sprint: key, doneSP: 0, doneTickets: 0 };
      bySprintMap[key].doneSP += getSP(t);
      bySprintMap[key].doneTickets += 1;
    }
    const sorted = Object.values(bySprintMap).sort((a, b) => {
      const dA = parseSprintDates(a.sprint);
      const dB = parseSprintDates(b.sprint);
      if (dA && dB) return dA.start - dB.start;
      return a.sprint.localeCompare(b.sprint);
    });
    return sorted.map((s, i) => {
      const window = sorted.slice(Math.max(0, i - 2), i + 1);
      const avg = Math.round(window.reduce((sum, w) => sum + w.doneSP, 0) / window.length);
      const label = s.sprint.replace(/Sprint\s*/i, 'S').replace(/\s+\d{2}-\d{2}-\d{2}\s+to\s+\d{2}-\d{2}-\d{2}/, '');
      return { ...s, avg, label };
    });
  }, [tickets, sprints, selectedProject, selectedAssignee]);

  const avgVelocity = data.length > 0 ? Math.round(data.reduce((s, d) => s + d.doneSP, 0) / data.length) : 0;
  const lastSprint  = data[data.length - 1];
  const trend = data.length >= 2 ? lastSprint.doneSP - data[data.length - 2].doneSP : 0;
  const trendColor = trend > 0 ? '#22c55e' : trend < 0 ? '#ef4444' : '#6b7280';
  const trendLabel = trend > 0 ? `↑ +${trend} SP vs prev` : trend < 0 ? `↓ ${trend} SP vs prev` : '= Same as prev';

  return (
    <Card>
      <CardHeader
        title="Sprint Velocity Trend"
        subtitle="Completed story points per sprint · 3-sprint rolling average"
        right={
          <div style={{ display: 'flex', gap: 20, fontSize: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#6b7280' }}>Avg velocity</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#60a5fa' }}>{avgVelocity} SP</div>
            </div>
            {lastSprint && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#6b7280' }}>Latest sprint</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: trendColor }}>{lastSprint.doneSP} SP</div>
                <div style={{ fontSize: 11, color: trendColor }}>{trendLabel}</div>
              </div>
            )}
          </div>
        }
      />
      {data.length === 0 ? (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 13 }}>No completed sprint data available</div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="velGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#1d4ed8" stopOpacity={0.7} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(val, name) => [val + ' SP', name === 'doneSP' ? 'Completed' : '3-sprint avg']} />
            <ReferenceLine y={avgVelocity} stroke="#60a5fa" strokeDasharray="4 3" strokeWidth={1.5}
              label={{ value: `avg ${avgVelocity}`, fill: '#60a5fa', fontSize: 11, position: 'right' }} />
            <Bar dataKey="doneSP" fill="url(#velGrad)" radius={[4,4,0,0]} name="Completed SP" maxBarSize={36}>
              {data.map((_, i) => (
                <Cell key={i} fill={i === data.length - 1 ? '#60a5fa' : 'url(#velGrad)'} opacity={i === data.length - 1 ? 1 : 0.7} />
              ))}
            </Bar>
            <Line dataKey="avg" type="monotone" stroke="#f59e0b" strokeWidth={2} dot={false} name="Rolling avg" />
          </BarChart>
        </ResponsiveContainer>
      )}
      {data.length >= 3 && (() => {
        const recent3   = data.slice(-3).map(d => d.doneSP);
        const older     = data.slice(0, -3).map(d => d.doneSP);
        const recentAvg = recent3.reduce((s, v) => s + v, 0) / recent3.length;
        const olderAvg  = older.length ? older.reduce((s, v) => s + v, 0) / older.length : recentAvg;
        const delta     = Math.round(recentAvg - olderAvg);
        const improving = delta >= 0;
        return (
          <InsightBox color={improving ? '#86efac' : '#fca5a5'}>
            {improving
              ? `📈 Team velocity has improved by ~${delta} SP/sprint over the last 3 sprints.`
              : `📉 Team velocity has dropped by ~${Math.abs(delta)} SP/sprint over the last 3 sprints. Consider reviewing sprint scope or blockers.`}
          </InsightBox>
        );
      })()}
    </Card>
  );
}

// ─── BurndownChart ────────────────────────────────────────────────────────────
function BurndownChart({ tickets = [], selectedSprint = 'all', sprints = [] }) {
  const { data, totalSP, doneSP, projShortfall, daysLeft } = useMemo(() => {
    if (!selectedSprint || selectedSprint === 'all')
      return { data: [], totalSP: 0, doneSP: 0, projShortfall: null, daysLeft: null };
    const dates = parseSprintDates(selectedSprint);
    if (!dates) return { data: [], totalSP: 0, doneSP: 0, projShortfall: null, daysLeft: null };
    const { start, end } = dates;
    const today     = new Date();
    const totalDays = Math.max(1, workingDaysBetween(start, end));
    const elapsed   = Math.min(totalDays, Math.max(0, workingDaysBetween(start, today)));
    const totalSP   = tickets.reduce((s, t) => s + getSP(t), 0);
    const doneSP    = tickets.filter(t => isDone(getStatus(t))).reduce((s, t) => s + getSP(t), 0);
    const remainSP  = totalSP - doneSP;
    const idealPerDay  = totalSP / totalDays;
    const actualPerDay = elapsed > 0 ? doneSP / elapsed : 0;
    const projPerDay   = (totalDays - elapsed) > 0 ? remainSP / (totalDays - elapsed) : 0;
    const daysLeft     = Math.max(0, totalDays - elapsed);
    const data = Array.from({ length: totalDays + 1 }, (_, d) => ({
      day:       `D${d}`,
      ideal:     Math.max(0, Math.round(totalSP - idealPerDay * d)),
      actual:    d <= elapsed ? Math.max(0, Math.round(totalSP - actualPerDay * d)) : null,
      projected: d >= elapsed ? Math.max(0, Math.round(remainSP - projPerDay * (d - elapsed))) : null,
    }));
    const projShortfall = daysLeft > 0 && actualPerDay > 0
      ? Math.max(0, Math.round(remainSP - actualPerDay * daysLeft)) : 0;
    return { data, totalSP, doneSP, projShortfall, daysLeft };
  }, [tickets, selectedSprint]);

  const completionPct = totalSP > 0 ? Math.round((doneSP / totalSP) * 100) : 0;
  const onTrack       = projShortfall === 0;

  return (
    <Card>
      <CardHeader
        title="Burndown Chart"
        subtitle={!selectedSprint || selectedSprint === 'all' ? 'Select a specific sprint to view burndown' : `${selectedSprint} · Story points remaining over time`}
        right={selectedSprint && selectedSprint !== 'all' && (
          <div style={{ display: 'flex', gap: 20, fontSize: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#6b7280' }}>Completed</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#22c55e' }}>{completionPct}%</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{doneSP} / {totalSP} SP</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#6b7280' }}>Days left</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: daysLeft > 5 ? '#60a5fa' : '#f59e0b' }}>{daysLeft}d</div>
              <div style={{ fontSize: 11, color: onTrack ? '#22c55e' : '#ef4444' }}>{onTrack ? 'On track ✓' : `~${projShortfall} SP at risk`}</div>
            </div>
          </div>
        )}
      />
      {selectedSprint && selectedSprint !== 'all' && (
        <div style={{ display: 'flex', gap: 14, fontSize: 11, marginBottom: 14 }}>
          {[['#60a5fa','Ideal (linear)'],['#22c55e','Actual'],['#f59e0b','Projected']].map(([c,l]) => (
            <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#9ca3af' }}>
              <span style={{ width: 14, height: 2, background: c, display: 'inline-block', borderRadius: 1 }} />{l}
            </span>
          ))}
        </div>
      )}
      {data.length === 0 ? (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 13 }}>
          {!selectedSprint || selectedSprint === 'all' ? 'Select a specific sprint from the dropdown to see its burndown' : 'Could not parse sprint dates — check sprint name format (DD-MM-YY to DD-MM-YY)'}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id="bdIdeal"  x1="0" y1="0" x2="0" y2="1"><stop offset="5%"  stopColor="#60a5fa" stopOpacity={0.12} /><stop offset="95%" stopColor="#60a5fa" stopOpacity={0} /></linearGradient>
              <linearGradient id="bdProj"   x1="0" y1="0" x2="0" y2="1"><stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.18} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0} /></linearGradient>
              <linearGradient id="bdActual" x1="0" y1="0" x2="0" y2="1"><stop offset="5%"  stopColor="#22c55e" stopOpacity={0.1}  /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="day" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [v !== null ? `${v} SP` : '—', n]} />
            <Area type="monotone" dataKey="ideal"     stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="5 3" fill="url(#bdIdeal)"  name="Ideal"     dot={false} />
            <Area type="monotone" dataKey="projected" stroke="#f59e0b" strokeWidth={2}   fill="url(#bdProj)"   name="Projected" dot={false} connectNulls />
            <Area type="monotone" dataKey="actual"    stroke="#22c55e" strokeWidth={2.5} fill="url(#bdActual)" name="Actual"    dot={{ r: 3, fill: '#22c55e', strokeWidth: 0 }} connectNulls />
          </AreaChart>
        </ResponsiveContainer>
      )}
      {projShortfall > 0 && <InsightBox color="#fbbf24">⚡ At current pace, ~<strong>{projShortfall} SP</strong> will likely not be completed by sprint end. Consider descoping lower-priority items.</InsightBox>}
      {projShortfall === 0 && data.length > 0 && doneSP > 0 && <InsightBox color="#86efac">✅ Team is on track to complete all sprint work by the end date.</InsightBox>}
    </Card>
  );
}

// ─── TicketAgeAnalysis (updated — with expand/collapse) ───────────────────────
function TicketAgeAnalysis({ tickets = [] }) {
  const today   = useMemo(() => new Date(), []);
  const [expanded, setExpanded] = useState(false);
  const PREVIEW = 12;

  const { aged, distribution, avgAge, staleCount, maxAge } = useMemo(() => {
    const inProg = tickets.filter(t => isInP(getStatus(t)));
    const aged   = inProg.map(t => {
      const days = getTicketAge(t, today);
      return { key: getKey(t), summary: getSummary(t), assignee: getAssignee(t), project: getProject(t), days, cat: getAgeCategory(days) };
    }).sort((a, b) => b.days - a.days);

    const distribution = [
      { label: 'Fresh (0–3d)',   count: aged.filter(t => t.days <= 3).length,                color: '#22c55e' },
      { label: 'Normal (4–7d)',  count: aged.filter(t => t.days > 3  && t.days <= 7).length, color: '#60a5fa' },
      { label: 'Ageing (8–14d)', count: aged.filter(t => t.days > 7  && t.days <= 14).length,color: '#f59e0b' },
      { label: 'Stale (14d+)',   count: aged.filter(t => t.days > 14).length,                color: '#ef4444' },
    ];
    return {
      aged, distribution,
      avgAge:     aged.length ? Math.round(aged.reduce((s, t) => s + t.days, 0) / aged.length) : 0,
      staleCount: aged.filter(t => t.days > 14).length,
      maxAge:     aged.length ? aged[0].days : 0,
    };
  }, [tickets, today]);

  const visible = expanded ? aged : aged.slice(0, PREVIEW);
  const hidden  = aged.length - PREVIEW;

  return (
    <Card>
      <CardHeader
        title="Ticket Age Analysis"
        subtitle="How long In Progress tickets have been sitting without completion"
        right={
          <div style={{ display: 'flex', gap: 20, fontSize: 12 }}>
            <div style={{ textAlign: 'right' }}><div style={{ color: '#6b7280' }}>Avg age</div><div style={{ fontSize: 18, fontWeight: 700, color: avgAge > 7 ? '#f59e0b' : '#60a5fa' }}>{avgAge}d</div></div>
            <div style={{ textAlign: 'right' }}><div style={{ color: '#6b7280' }}>Stale</div><div style={{ fontSize: 18, fontWeight: 700, color: staleCount > 0 ? '#ef4444' : '#22c55e' }}>{staleCount}</div><div style={{ fontSize: 11, color: '#6b7280' }}>14+ days</div></div>
            <div style={{ textAlign: 'right' }}><div style={{ color: '#6b7280' }}>Oldest</div><div style={{ fontSize: 18, fontWeight: 700, color: maxAge > 14 ? '#ef4444' : '#6b7280' }}>{maxAge}d</div></div>
          </div>
        }
      />

      {/* Distribution bar */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 8 }}>
          {distribution.map(d => {
            const pct = aged.length > 0 ? (d.count / aged.length) * 100 : 0;
            return pct > 0 ? <div key={d.label} title={`${d.label}: ${d.count}`} style={{ width: `${pct}%`, background: d.color, transition: 'width 0.5s ease' }} /> : null;
          })}
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 11, flexWrap: 'wrap' }}>
          {distribution.map(d => (
            <span key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#9ca3af' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, display: 'inline-block' }} />
              {d.label}: <strong style={{ color: d.color }}>{d.count}</strong>
            </span>
          ))}
        </div>
      </div>

      {aged.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 140px 100px 60px', gap: 12, padding: '6px 12px', fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 2 }}>
          <div>Key</div><div>Summary</div><div>Assignee</div><div>Project</div><div style={{ textAlign: 'right' }}>Age</div>
        </div>
      )}

      {aged.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: '#6b7280', fontSize: 13 }}>No In Progress tickets for current filters</div>
      ) : visible.map(t => (
        <div key={t.key} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 140px 100px 60px', gap: 12, padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: '#60a5fa', fontWeight: 500 }}>{t.key}</div>
          <div style={{ fontSize: 12, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.summary}</div>
          <div style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.assignee}</div>
          <div style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.project}</div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: t.cat.color, background: `${t.cat.color}18`, border: `1px solid ${t.cat.color}40`, padding: '2px 8px', borderRadius: 4 }}>{t.days}d</span>
          </div>
        </div>
      ))}

      {hidden > 0 && (
        <button onClick={() => setExpanded(e => !e)} style={{ width: '100%', marginTop: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '9px 0', cursor: 'pointer', fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>
          {expanded ? '▲ Collapse — show fewer tickets' : `▼ Show ${hidden} more In Progress tickets`}
        </button>
      )}

      {staleCount > 0 && <InsightBox color="#fca5a5">🕐 <strong>{staleCount} ticket{staleCount > 1 ? 's have' : ' has'} been In Progress for 14+ days.</strong> These are likely blocked or forgotten — bring them to the next standup.</InsightBox>}
    </Card>
  );
}

// ─── AssigneeStaleBreakdown ───────────────────────────────────────────────────
function AssigneeStaleBreakdown({ tickets = [] }) {
  const today = useMemo(() => new Date(), []);

  const { data, topOffender } = useMemo(() => {
    const map = {};
    for (const t of tickets) {
      if (!isInP(getStatus(t))) continue;
      const name = getAssignee(t);
      if (!map[name]) map[name] = { name, fresh: 0, normal: 0, ageing: 0, stale: 0, totalSP: 0 };
      const days = getTicketAge(t, today);
      map[name].totalSP += getSP(t);
      if (days <= 3)       map[name].fresh  += 1;
      else if (days <= 7)  map[name].normal += 1;
      else if (days <= 14) map[name].ageing += 1;
      else                 map[name].stale  += 1;
    }
    const data = Object.values(map)
      .map(d => ({ ...d, riskScore: d.stale * 3 + d.ageing }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10);
    return { data, topOffender: data[0] || null };
  }, [tickets, today]);

  if (data.length === 0) return null;

  return (
    <Card>
      <CardHeader
        title="Assignee Stale Ticket Breakdown"
        subtitle="Who owns the most stuck In Progress tickets — sorted by risk score"
        right={topOffender && (
          <div style={{ textAlign: 'right', fontSize: 12 }}>
            <div style={{ color: '#6b7280' }}>Highest risk</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#ef4444', maxWidth: 140, textAlign: 'right' }}>{topOffender.name}</div>
            <div style={{ fontSize: 11, color: '#9ca3af' }}>{topOffender.stale} stale · {topOffender.ageing} ageing</div>
          </div>
        )}
      />
      <ResponsiveContainer width="100%" height={Math.max(160, data.length * 36)}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 60, left: 10, bottom: 0 }}>
          <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.04)" />
          <XAxis type="number" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" tick={{ fill: '#e2e8f0', fontSize: 12 }} axisLine={false} tickLine={false} width={120} />
          <Tooltip {...TOOLTIP_STYLE} formatter={(v, n) => [v + ' tickets', n]} />
          <Bar dataKey="stale"  stackId="a" fill="#ef4444" name="Stale (14d+)"   />
          <Bar dataKey="ageing" stackId="a" fill="#f59e0b" name="Ageing (8–14d)" />
          <Bar dataKey="normal" stackId="a" fill="#60a5fa" name="Normal (4–7d)"  />
          <Bar dataKey="fresh"  stackId="a" fill="#22c55e" name="Fresh (0–3d)"   radius={[0,4,4,0]} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 14, fontSize: 11, marginTop: 10, flexWrap: 'wrap' }}>
        {[['#ef4444','Stale (14d+)'],['#f59e0b','Ageing (8–14d)'],['#60a5fa','Normal (4–7d)'],['#22c55e','Fresh (0–3d)']].map(([c,l]) => (
          <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#9ca3af' }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />{l}
          </span>
        ))}
      </div>
      {topOffender?.stale > 2 && (
        <InsightBox color="#fca5a5">⚠ <strong>{topOffender.name}</strong> has {topOffender.stale} stale tickets ({topOffender.totalSP} SP). Consider a 1:1 to identify blockers and redistribute if needed.</InsightBox>
      )}
    </Card>
  );
}

// ─── BlockedTicketDetector ────────────────────────────────────────────────────
function BlockedTicketDetector({ tickets = [], staleDaysThreshold = 5 }) {
  const today = useMemo(() => new Date(), []);
  const [threshold, setThreshold] = useState(staleDaysThreshold);

  const blocked = useMemo(() => {
    return tickets
      .filter(t => !isDone(getStatus(t)))
      .map(t => {
        const lastUpdate = getUpdated(t) || getCreated(t);
        const daysSince  = lastUpdate ? daysBetween(lastUpdate, today) : 999;
        return { key: getKey(t), summary: getSummary(t), assignee: getAssignee(t), status: getStatus(t), sp: getSP(t), daysSince };
      })
      .filter(t => t.daysSince >= threshold)
      .sort((a, b) => b.daysSince - a.daysSince);
  }, [tickets, today, threshold]);

  const critical = blocked.filter(t => t.daysSince >= 10);
  const totalSP  = blocked.reduce((s, t) => s + t.sp, 0);

  return (
    <Card>
      <CardHeader
        title="Blocked Ticket Detector"
        subtitle={`Non-done tickets with no update in ${threshold}+ days — likely blocked or forgotten`}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#6b7280' }}>Threshold:</span>
            {[3, 5, 7, 10].map(d => (
              <button key={d} onClick={() => setThreshold(d)} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 12, cursor: 'pointer', fontWeight: 500, background: threshold === d ? '#3b82f6' : 'rgba(255,255,255,0.06)', border: `1px solid ${threshold === d ? '#3b82f6' : 'rgba(255,255,255,0.12)'}`, color: threshold === d ? '#fff' : '#94a3b8' }}>{d}d</button>
            ))}
            <div style={{ marginLeft: 8, textAlign: 'right' }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: blocked.length > 0 ? '#f97316' : '#22c55e' }}>{blocked.length}</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{totalSP} SP at risk</div>
            </div>
          </div>
        }
      />

      {blocked.length === 0 ? (
        <div style={{ padding: '20px 0', textAlign: 'center' }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>✅</div>
          <div style={{ fontSize: 13, color: '#22c55e', fontWeight: 500 }}>No blocked tickets detected</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>All active tickets have been updated within {threshold} days</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 140px 100px 80px', gap: 12, padding: '6px 12px', fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 2 }}>
            <div>Key</div><div>Summary</div><div>Assignee</div><div>Status</div><div style={{ textAlign: 'right' }}>No update</div>
          </div>
          {blocked.map(t => (
            <div key={t.key} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 140px 100px 80px', gap: 12, padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'center', background: t.daysSince >= 10 ? 'rgba(239,68,68,0.04)' : 'transparent' }}>
              <div style={{ fontSize: 12, color: '#60a5fa', fontWeight: 500 }}>{t.key}</div>
              <div style={{ fontSize: 12, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.summary}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.assignee}</div>
              <div><span style={{ fontSize: 11, color: '#94a3b8', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap' }}>{t.status}</span></div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: t.daysSince >= 10 ? '#ef4444' : '#f97316', background: t.daysSince >= 10 ? '#ef444418' : '#f9731618', border: `1px solid ${t.daysSince >= 10 ? '#ef444440' : '#f9731640'}`, padding: '2px 8px', borderRadius: 4 }}>{t.daysSince}d</span>
              </div>
            </div>
          ))}
        </>
      )}

      {critical.length > 0 && (
        <InsightBox color="#fca5a5">🚨 <strong>{critical.length} ticket{critical.length > 1 ? 's have' : ' has'} had zero activity for 10+ days</strong> ({critical.reduce((s,t)=>s+t.sp,0)} SP). These need immediate attention — escalate or descope before sprint end.</InsightBox>
      )}
    </Card>
  );
}

// ─── DailyStandupExport ───────────────────────────────────────────────────────
function DailyStandupExport({ tickets = [], selectedSprint = 'all', selectedProject = 'all' }) {
  const today = useMemo(() => new Date(), []);
  const [copied, setCopied]   = useState(false);
  const [expanded, setExpanded] = useState(false);

  const report = useMemo(() => {
    const dateStr = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const CAPACITY = 16;

    const loadMap = {};
    for (const t of tickets) {
      if (isDone(getStatus(t))) continue;
      const name = getAssignee(t);
      loadMap[name] = (loadMap[name] || 0) + getSP(t);
    }
    const overloaded = Object.entries(loadMap)
      .filter(([, sp]) => sp > CAPACITY)
      .map(([name, sp]) => `  • ${name}: ${sp} SP active (capacity ${CAPACITY} SP, over by ${sp - CAPACITY} SP)`);

    const stale = tickets
      .filter(t => isInP(getStatus(t)) && getTicketAge(t, today) >= 14)
      .sort((a, b) => getTicketAge(b, today) - getTicketAge(a, today))
      .map(t => `  • ${getKey(t)} — ${getSummary(t)} [${getAssignee(t)}] — ${getTicketAge(t, today)}d in progress`);

    const blocked = tickets
      .filter(t => !isDone(getStatus(t)))
      .map(t => ({ t, daysSince: daysBetween(getUpdated(t) || getCreated(t), today) }))
      .filter(({ daysSince }) => daysSince >= 5)
      .sort((a, b) => b.daysSince - a.daysSince)
      .map(({ t, daysSince }) => `  • ${getKey(t)} — ${getSummary(t)} [${getAssignee(t)}] — no update ${daysSince}d`);

    const totalSP  = tickets.reduce((s, t) => s + getSP(t), 0);
    const doneSP   = tickets.filter(t => isDone(getStatus(t))).reduce((s, t) => s + getSP(t), 0);
    const inProgSP = tickets.filter(t => isInP(getStatus(t))).reduce((s, t) => s + getSP(t), 0);
    const pct      = totalSP > 0 ? Math.round((doneSP / totalSP) * 100) : 0;

    const overdue = tickets
      .filter(t => !isDone(getStatus(t)) && getDue(t) && new Date(getDue(t)) < today)
      .map(t => `  • ${getKey(t)} — ${getSummary(t)} [${getAssignee(t)}]`);

    const sprintLabel   = selectedSprint === 'all' ? 'All Sprints' : selectedSprint;
    const projectLabel  = selectedProject === 'all' ? '' : ` · ${selectedProject}`;

    const lines = [
      `📋 DAILY STANDUP — ${dateStr}`,
      `Sprint: ${sprintLabel}${projectLabel}`,
      ``,
      `📊 SPRINT PROGRESS`,
      `  Completed: ${doneSP} SP / ${totalSP} SP (${pct}%)`,
      `  In Progress: ${inProgSP} SP`,
      `  Remaining: ${totalSP - doneSP} SP`,
      ``,
      ...(overloaded.length > 0 ? [`⚠ OVERLOADED TEAM MEMBERS (${overloaded.length})`, ...overloaded, ``] : []),
      ...(stale.length > 0     ? [`🕐 STALE IN-PROGRESS TICKETS — 14+ DAYS (${stale.length})`, ...stale, ``] : []),
      ...(blocked.length > 0   ? [`🚨 BLOCKED / NO ACTIVITY — 5+ DAYS (${blocked.length})`, ...blocked, ``] : []),
      ...(overdue.length > 0   ? [`🔴 OVERDUE TICKETS (${overdue.length})`, ...overdue, ``] : []),
      ...(overloaded.length === 0 && stale.length === 0 && blocked.length === 0 && overdue.length === 0
        ? [`✅ No critical risks detected today.`, ``] : []),
      `─────────────────────────────`,
      `Generated by Sprint Analytics Dashboard`,
    ];

    return { text: lines.join('\n'), overloaded, stale, blocked, overdue };
  }, [tickets, today, selectedSprint, selectedProject]);

  function handleCopy() {
    navigator.clipboard.writeText(report.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  const hasRisks = report.overloaded.length > 0 || report.stale.length > 0 || report.blocked.length > 0 || report.overdue.length > 0;

  return (
    <Card style={{ border: '1px solid rgba(96,165,250,0.2)', background: 'rgba(96,165,250,0.04)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: expanded ? 16 : 0 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>📋 Daily Standup Export</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>One-click summary of today's sprint risks — paste into Slack, Teams, or email</div>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {report.overloaded.length > 0 && <span style={{ fontSize: 11, background: '#f9731618', border: '1px solid #f9731640', color: '#f97316', padding: '3px 8px', borderRadius: 4 }}>{report.overloaded.length} overloaded</span>}
            {report.stale.length > 0     && <span style={{ fontSize: 11, background: '#ef444418', border: '1px solid #ef444440', color: '#ef4444', padding: '3px 8px', borderRadius: 4 }}>{report.stale.length} stale</span>}
            {report.blocked.length > 0   && <span style={{ fontSize: 11, background: '#f59e0b18', border: '1px solid #f59e0b40', color: '#f59e0b', padding: '3px 8px', borderRadius: 4 }}>{report.blocked.length} blocked</span>}
            {!hasRisks && <span style={{ fontSize: 11, background: '#22c55e18', border: '1px solid #22c55e40', color: '#22c55e', padding: '3px 8px', borderRadius: 4 }}>✅ All clear</span>}
          </div>
          <button onClick={() => setExpanded(e => !e)} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 7, padding: '7px 14px', cursor: 'pointer', fontSize: 12, color: '#94a3b8' }}>
            {expanded ? '▲ Hide' : '▼ Preview'}
          </button>
          <button onClick={handleCopy} style={{ background: copied ? '#22c55e' : '#3b82f6', border: 'none', borderRadius: 7, padding: '7px 16px', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: '#fff', minWidth: 80 }}>
            {copied ? '✓ Copied!' : '📋 Copy'}
          </button>
        </div>
      </div>
      {expanded && (
        <pre style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '14px 16px', fontSize: 12, color: '#94a3b8', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 380, overflowY: 'auto', margin: 0, fontFamily: "'Fira Code', 'Cascadia Code', monospace" }}>
          {report.text}
        </pre>
      )}
    </Card>
  );
}

// ─── Report Generator ────────────────────────────────────────────────────────
function generateSprintReport({ tickets, sprints, selectedSprint, selectedAssignee, selectedProject, metrics }) {
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const sprintLabel  = selectedSprint  === 'all' ? 'All Sprints'  : (selectedSprint  || 'All Sprints');
  const projectLabel = selectedProject === 'all' ? 'All Projects' : (selectedProject || 'All Projects');
  const assigneeLabel= selectedAssignee=== 'all' ? 'All Assignees': (selectedAssignee|| 'All Assignees');

  // ── Velocity data ──
  const bySprintMap = {};
  for (const t of tickets) {
    if (!isDone(getStatus(t))) continue;
    const key = getSprint(t) || 'Unknown';
    if (!bySprintMap[key]) bySprintMap[key] = { sprint: key, doneSP: 0, count: 0 };
    bySprintMap[key].doneSP += getSP(t);
    bySprintMap[key].count  += 1;
  }
  const velocityRows = Object.values(bySprintMap)
    .sort((a, b) => a.sprint.localeCompare(b.sprint))
    .slice(-8);

  // ── Stale tickets ──
  const staleTickets = tickets
    .filter(t => isInP(getStatus(t)) && getTicketAge(t, today) >= 14)
    .sort((a, b) => getTicketAge(b, today) - getTicketAge(a, today));

  // ── Blocked tickets ──
  const blockedTickets = tickets
    .filter(t => !isDone(getStatus(t)))
    .map(t => ({ t, daysSince: daysBetween(getUpdated(t) || getCreated(t), today) }))
    .filter(({ daysSince }) => daysSince >= 5)
    .sort((a, b) => b.daysSince - a.daysSince);

  // ── Assignee workload ──
  const assigneeMap = {};
  for (const t of tickets) {
    const name = getAssignee(t);
    if (!assigneeMap[name]) assigneeMap[name] = { name, todo: 0, inprog: 0, done: 0, awaiting: 0, totalSP: 0 };
    const s = normStatus(getStatus(t));
    const sp = getSP(t);
    assigneeMap[name].totalSP += sp;
    if (isDone(s)) assigneeMap[name].done += sp;
    else if (isInP(s)) assigneeMap[name].inprog += sp;
    else if (s.includes('awaiting') || s.includes('testing') || s.includes('review')) assigneeMap[name].awaiting += sp;
    else assigneeMap[name].todo += sp;
  }
  const assigneeRows = Object.values(assigneeMap)
    .filter(a => a.name !== 'Unassigned')
    .sort((a, b) => b.totalSP - a.totalSP);

  const scoreColor = metrics.score >= 75 ? '#22c55e' : metrics.score >= 50 ? '#f59e0b' : '#ef4444';
  const scoreLabel = metrics.score >= 75 ? 'Healthy' : metrics.score >= 50 ? 'Needs Attention' : 'At Risk';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Sprint Health Report — ${dateStr}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f8fafc; color: #1e293b; font-size: 13px; }
  .page { max-width: 1100px; margin: 0 auto; padding: 32px 28px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 28px; padding-bottom: 20px; border-bottom: 2px solid #e2e8f0; }
  .header h1 { font-size: 22px; font-weight: 700; color: #0f172a; }
  .header .meta { font-size: 12px; color: #64748b; margin-top: 4px; }
  .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
  .kpi { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; }
  .kpi .label { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 6px; }
  .kpi .value { font-size: 26px; font-weight: 700; color: #0f172a; }
  .kpi .sub { font-size: 11px; color: #94a3b8; margin-top: 3px; }
  section { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 20px; margin-bottom: 18px; }
  section h2 { font-size: 14px; font-weight: 600; color: #0f172a; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid #f1f5f9; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { background: #f8fafc; text-align: left; padding: 8px 10px; font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #e2e8f0; }
  td { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #f8fafc; }
  .bar-wrap { background: #f1f5f9; border-radius: 4px; height: 8px; width: 100%; min-width: 80px; }
  .bar-fill { height: 8px; border-radius: 4px; }
  .tag { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 500; }
  .tag-red    { background: #fee2e2; color: #dc2626; }
  .tag-orange { background: #ffedd5; color: #ea580c; }
  .tag-yellow { background: #fef9c3; color: #ca8a04; }
  .tag-green  { background: #dcfce7; color: #16a34a; }
  .tag-blue   { background: #dbeafe; color: #2563eb; }
  .focus-item { display: flex; align-items: flex-start; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 12px; color: #374151; }
  .focus-item:last-child { border-bottom: none; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 18px; }
  .footer { text-align: center; font-size: 11px; color: #94a3b8; margin-top: 28px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
  @media print {
    body { background: #fff; }
    .page { padding: 16px; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div>
      <h1>Sprint Health Report</h1>
      <div class="meta">${dateStr}</div>
      <div class="meta" style="margin-top:6px;">
        Sprint: <strong>${sprintLabel}</strong> &nbsp;·&nbsp;
        Project: <strong>${projectLabel}</strong> &nbsp;·&nbsp;
        Assignee: <strong>${assigneeLabel}</strong>
      </div>
    </div>
    <div style="text-align:right;">
      <div class="badge" style="background:${scoreColor}20; color:${scoreColor}; border:1px solid ${scoreColor}40; font-size:15px; padding:8px 18px;">
        Health Score: ${metrics.score}/100 — ${scoreLabel}
      </div>
      <div class="meta" style="margin-top:8px;">${metrics.total} tickets · ${metrics.totalSP.toFixed(0)} total SP</div>
    </div>
  </div>

  <!-- KPIs -->
  <div class="kpi-grid">
    <div class="kpi">
      <div class="label">Completion Rate</div>
      <div class="value">${metrics.completionRate}%</div>
      <div class="sub">${metrics.done} / ${metrics.total} tickets done</div>
    </div>
    <div class="kpi">
      <div class="label">Story Points Done</div>
      <div class="value">${metrics.doneSP.toFixed(0)} SP</div>
      <div class="sub">of ${metrics.totalSP.toFixed(0)} total SP</div>
    </div>
    <div class="kpi">
      <div class="label">Bug Rate</div>
      <div class="value">${metrics.bugRate}%</div>
      <div class="sub">${metrics.bugs} bugs in scope</div>
    </div>
    <div class="kpi">
      <div class="label">In Progress</div>
      <div class="value">${metrics.inProgress}</div>
      <div class="sub">${metrics.toDo} to do · ${metrics.unassigned} unassigned</div>
    </div>
  </div>

  <!-- Focus Actions + Project Health -->
  <div class="two-col">
    <section style="margin-bottom:0">
      <h2>⚡ Focus Actions</h2>
      ${metrics.focusActions.length === 0
        ? '<div class="focus-item" style="color:#16a34a;">✅ No critical actions — sprint looks healthy</div>'
        : metrics.focusActions.map(a => `<div class="focus-item"><span style="color:#f97316;font-size:15px;">⚠</span>${a}</div>`).join('')
      }
    </section>
    <section style="margin-bottom:0">
      <h2>📊 Project Health</h2>
      <table>
        <thead><tr><th>Project</th><th>Done</th><th>Bugs</th><th>Progress</th></tr></thead>
        <tbody>
          ${metrics.projectHealth.slice(0, 8).map(p => `
            <tr>
              <td style="font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.name}</td>
              <td>${p.done}/${p.total}</td>
              <td>${p.bugs > 0 ? `<span class="tag tag-red">${p.bugs}</span>` : '<span class="tag tag-green">0</span>'}</td>
              <td style="min-width:100px">
                <div style="display:flex;align-items:center;gap:8px">
                  <div class="bar-wrap"><div class="bar-fill" style="width:${p.rate}%;background:${p.rate>=70?'#22c55e':p.rate>=40?'#f59e0b':'#ef4444'}"></div></div>
                  <span style="font-size:11px;color:#64748b;white-space:nowrap">${p.rate}%</span>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
    </section>
  </div>

  <!-- Assignee Workload -->
  <section>
    <h2>👥 Assignee Workload</h2>
    <table>
      <thead><tr><th>Assignee</th><th>Total SP</th><th>Done SP</th><th>In Progress SP</th><th>To Do SP</th><th>Awaiting SP</th><th>Status</th></tr></thead>
      <tbody>
        ${assigneeRows.map(a => {
          const active = a.inprog + a.todo;
          const overloaded = active > 16;
          return `<tr>
            <td style="font-weight:500">${a.name}</td>
            <td>${a.totalSP.toFixed(1)}</td>
            <td><span class="tag tag-green">${a.done.toFixed(1)}</span></td>
            <td>${a.inprog.toFixed(1)}</td>
            <td>${a.todo.toFixed(1)}</td>
            <td>${a.awaiting.toFixed(1)}</td>
            <td>${overloaded ? `<span class="tag tag-red">Overloaded (${active.toFixed(1)} SP active)</span>` : `<span class="tag tag-green">OK</span>`}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </section>

  <!-- Sprint Velocity -->
  ${velocityRows.length > 0 ? `
  <section>
    <h2>📈 Sprint Velocity</h2>
    <table>
      <thead><tr><th>Sprint</th><th>Completed SP</th><th>Tickets Done</th></tr></thead>
      <tbody>
        ${velocityRows.map(v => `
          <tr>
            <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${v.sprint}</td>
            <td><strong>${v.doneSP.toFixed(0)}</strong></td>
            <td>${v.count}</td>
          </tr>`).join('')}
      </tbody>
    </table>
  </section>` : ''}

  <!-- Stale Tickets -->
  ${staleTickets.length > 0 ? `
  <section>
    <h2>🕐 Stale In-Progress Tickets (14+ days)</h2>
    <table>
      <thead><tr><th>Key</th><th>Summary</th><th>Assignee</th><th>Project</th><th>Days In Progress</th></tr></thead>
      <tbody>
        ${staleTickets.map(t => {
          const days = getTicketAge(t, today);
          return `<tr>
            <td style="color:#2563eb;font-weight:500">${getKey(t)}</td>
            <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${getSummary(t)}</td>
            <td>${getAssignee(t)}</td>
            <td>${getProject(t)}</td>
            <td><span class="tag ${days>=21?'tag-red':'tag-orange'}">${days}d</span></td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </section>` : ''}

  <!-- Blocked Tickets -->
  ${blockedTickets.length > 0 ? `
  <section>
    <h2>🚨 Blocked / No Activity (5+ days)</h2>
    <table>
      <thead><tr><th>Key</th><th>Summary</th><th>Assignee</th><th>Status</th><th>No Update</th></tr></thead>
      <tbody>
        ${blockedTickets.map(({ t, daysSince }) => `
          <tr style="${daysSince>=10?'background:#fff5f5':''}">
            <td style="color:#2563eb;font-weight:500">${getKey(t)}</td>
            <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${getSummary(t)}</td>
            <td>${getAssignee(t)}</td>
            <td><span class="tag tag-blue">${getStatus(t)}</span></td>
            <td><span class="tag ${daysSince>=10?'tag-red':'tag-orange'}">${daysSince}d</span></td>
          </tr>`).join('')}
      </tbody>
    </table>
  </section>` : ''}

  <div class="footer">
    Generated by Sprint Analytics Dashboard &nbsp;·&nbsp; ${dateStr}
    <br/><span class="no-print" style="margin-top:8px;display:inline-block;">
      <button onclick="window.print()" style="margin-top:10px;padding:8px 20px;background:#3b82f6;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">🖨 Print / Save as PDF</button>
    </span>
  </div>

</div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

// ─── Main SprintHealthTab ─────────────────────────────────────────────────────
const SprintHealthTab = ({ tickets = [], sprints = [], selectedSprint, selectedAssignee, selectedProject }) => {
  const metrics = useMemo(() => {
    if (!tickets.length) return null;
    const total      = tickets.length;
    const done       = tickets.filter(t => isDone(getStatus(t))).length;
    const inProgress = tickets.filter(t => isInP(getStatus(t))).length;
    const toDo       = tickets.filter(t => ['to do','open','new'].includes(normStatus(getStatus(t)))).length;
    const awaiting   = tickets.filter(t => { const s = normStatus(getStatus(t)); return s.includes('awaiting') || s.includes('testing') || s.includes('review'); }).length;
    const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;
    const totalSP = tickets.reduce((sum, t) => sum + getSP(t), 0);
    const doneSP  = tickets.filter(t => isDone(getStatus(t))).reduce((sum, t) => sum + getSP(t), 0);
    const bugs    = tickets.filter(t => getType(t) === 'Bug').length;
    const bugRate = total > 0 ? Math.round((bugs / total) * 100) : 0;
    const unassigned = tickets.filter(t => !t['Assignee'] || t['Assignee'] === 'Unassigned').length;
    const spByAssignee = {};
    tickets.forEach(t => {
      const a = getAssignee(t);
      const s = normStatus(getStatus(t));
      if (s === 'in progress' || s === 'to do' || s === 'open' || s === 'new') spByAssignee[a] = (spByAssignee[a] || 0) + getSP(t);
    });
    const overloaded = Object.entries(spByAssignee).filter(([, sp]) => sp > 16).length;
    let score = 100;
    if (completionRate < 30) score -= 20; else if (completionRate < 60) score -= 10;
    if (bugRate > 30) score -= 15; else if (bugRate > 15) score -= 7;
    if (overloaded > 0) score -= overloaded * 5;
    if (unassigned > total * 0.2) score -= 10;
    score = Math.max(0, Math.min(100, score));
    const sprintList = sprints.filter(s => s !== 'all');
    const burndownData = sprintList.slice(0, 8).map(sprint => {
      const st = tickets.filter(t => { const ts = getSprint(t); return ts === sprint || ts.includes(sprint); });
      const sd = st.filter(t => isDone(getStatus(t))).length;
      return { sprint: sprint.length > 20 ? sprint.slice(-10) : sprint, completed: sd, total: st.length, rate: st.length > 0 ? Math.round((sd / st.length) * 100) : 0 };
    }).reverse();
    const projectMap = {};
    tickets.forEach(t => {
      const proj = getProject(t);
      if (!projectMap[proj]) projectMap[proj] = { total: 0, done: 0, bugs: 0 };
      projectMap[proj].total++;
      if (isDone(getStatus(t))) projectMap[proj].done++;
      if (getType(t) === 'Bug') projectMap[proj].bugs++;
    });
    const projectHealth = Object.entries(projectMap).map(([name, d]) => ({
      name, rate: d.total > 0 ? Math.round((d.done / d.total) * 100) : 0, total: d.total, done: d.done, bugs: d.bugs,
    })).sort((a, b) => b.total - a.total);
    const focusActions = [];
    if (overloaded > 0) focusActions.push(`${overloaded} assignee(s) overloaded — rebalance workload`);
    if (unassigned > 0) focusActions.push(`${unassigned} unassigned ticket(s) — assign to team members`);
    if (bugRate > 20) focusActions.push(`High bug rate (${bugRate}%) — prioritise bug fixes`);
    if (completionRate < 40 && selectedSprint !== 'all') focusActions.push(`Low completion rate (${completionRate}%) — review sprint scope`);
    return { total, done, inProgress, toDo, awaiting, completionRate, totalSP, doneSP, bugs, bugRate, unassigned, overloaded, score, burndownData, projectHealth, focusActions };
  }, [tickets, sprints, selectedSprint]);

  if (!tickets.length) return <div className="flex items-center justify-center h-64 text-slate-400">No data loaded. Upload Jira data or refresh from Jira.</div>;
  if (!metrics) return null;

  const scoreColor = metrics.score >= 75 ? 'text-green-400' : metrics.score >= 50 ? 'text-yellow-400' : 'text-red-400';
  const scoreBg    = metrics.score >= 75 ? 'bg-green-500/10 border-green-500/30' : metrics.score >= 50 ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-red-500/10 border-red-500/30';

  return (
    <div className="space-y-6">
      {/* Generate Report Button */}
      <div className="flex justify-end">
        <button
          onClick={() => generateSprintReport({ tickets, sprints, selectedSprint, selectedAssignee, selectedProject, metrics })}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 20px', background: 'linear-gradient(135deg, #3b82f6, #2563eb)', border: 'none', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#fff', boxShadow: '0 2px 8px rgba(59,130,246,0.35)' }}
        >
          <span style={{ fontSize: 16 }}>📄</span> Generate Report
        </button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-1"><TrendingUp className="w-4 h-4 text-blue-400" /><span className="text-xs text-slate-400">Completion Rate</span></div>
          <div className="text-2xl font-bold text-white">{metrics.completionRate}%</div>
          <div className="text-xs text-slate-500">{metrics.done}/{metrics.total} tickets</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-1"><CheckCircle className="w-4 h-4 text-green-400" /><span className="text-xs text-slate-400">Story Points Done</span></div>
          <div className="text-2xl font-bold text-white">{metrics.doneSP.toFixed(0)}</div>
          <div className="text-xs text-slate-500">of {metrics.totalSP.toFixed(0)} total SP</div>
        </div>
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-1"><AlertCircle className="w-4 h-4 text-red-400" /><span className="text-xs text-slate-400">Bug Rate</span></div>
          <div className="text-2xl font-bold text-white">{metrics.bugRate}%</div>
          <div className="text-xs text-slate-500">{metrics.bugs} bugs in scope</div>
        </div>
        <div className={`rounded-xl p-4 border ${scoreBg}`}>
          <div className="flex items-center gap-2 mb-1"><Zap className="w-4 h-4 text-purple-400" /><span className="text-xs text-slate-400">Health Score</span></div>
          <div className={`text-2xl font-bold ${scoreColor}`}>{metrics.score}/100</div>
          <div className="text-xs text-slate-500">{metrics.score >= 75 ? 'Healthy' : metrics.score >= 50 ? 'Needs attention' : 'At risk'}</div>
        </div>
      </div>

      {/* Completion Rate by Sprint */}
      {metrics.burndownData.length > 1 && (
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Completion Rate by Sprint</h3>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics.burndownData}>
                <defs>
                  <linearGradient id="healthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="sprint" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="%" domain={[0, 100]} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#e2e8f0' }} formatter={(v) => [`${v}%`, 'Completion']} />
                <Area type="monotone" dataKey="rate" stroke="#3b82f6" fill="url(#healthGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Project Health + Focus Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2"><Users className="w-4 h-4 text-blue-400" />Project Health</h3>
          <div className="space-y-3">
            {metrics.projectHealth.slice(0, 6).map(proj => (
              <div key={proj.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300 truncate max-w-[60%]">{proj.name}</span>
                  <span className="text-slate-400">{proj.rate}% done · {proj.bugs} bugs</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${proj.rate >= 70 ? 'bg-green-500' : proj.rate >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${proj.rate}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2"><Clock className="w-4 h-4 text-orange-400" />Focus Actions</h3>
          {metrics.focusActions.length === 0 ? (
            <div className="flex items-center gap-2 text-green-400 text-sm"><CheckCircle className="w-4 h-4" />Sprint looks healthy — no immediate actions needed</div>
          ) : (
            <ul className="space-y-2">
              {metrics.focusActions.map((action, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-300"><AlertCircle className="w-4 h-4 text-orange-400 mt-0.5 shrink-0" />{action}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 pt-4 border-t border-slate-700 grid grid-cols-2 gap-2 text-xs">
            <div className="text-slate-400">In Progress: <span className="text-white font-medium">{metrics.inProgress}</span></div>
            <div className="text-slate-400">To Do: <span className="text-white font-medium">{metrics.toDo}</span></div>
            <div className="text-slate-400">Awaiting: <span className="text-white font-medium">{metrics.awaiting}</span></div>
            <div className="text-slate-400">Unassigned: <span className="text-white font-medium">{metrics.unassigned}</span></div>
          </div>
        </div>
      </div>

      {/* Enhanced sections */}
      <SprintVelocityTrend tickets={tickets} sprints={sprints} selectedProject={selectedProject} selectedAssignee={selectedAssignee} />
      <BurndownChart tickets={tickets} selectedSprint={selectedSprint} sprints={sprints} />
      <TicketAgeAnalysis tickets={tickets} />
      <AssigneeStaleBreakdown tickets={tickets} />
      <BlockedTicketDetector tickets={tickets} />
      <DailyStandupExport tickets={tickets} selectedSprint={selectedSprint} selectedProject={selectedProject} />
    </div>
  );
};

export default SprintHealthTab;
