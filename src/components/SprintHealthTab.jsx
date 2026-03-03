import React, { useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, Cell, CartesianGrid,
} from 'recharts';
import { CheckCircle, AlertCircle, Clock, TrendingUp, Users, Zap } from 'lucide-react';

// ─── Field helpers (Jira export field names) ──────────────────────────────────
const getStatus  = t => t['Status'] || '';
const getSP      = t => parseFloat(t['Story Points']) || 0;
const getSprint  = t => t['Sprint'] || t['G'] || '';
const getAssignee= t => t['Assignee'] || t['D'] || 'Unassigned';
const getProject = t => t['Project'] || t['B'] || 'Unknown';
const getKey     = t => t['Key'] || t['Issue key'] || '';
const getSummary = t => t['Summary'] || '';
const getType    = t => t['Issue Type'] || '';
const getCreated = t => t['Created'] || t['createdDate'] || null;
const getUpdated = t => t['Updated'] || t['updatedDate'] || null;

const normStatus = s => s.toLowerCase().trim();
const isDone = s => ['done','completed','closed','resolved'].includes(normStatus(s));
const isInP  = s => normStatus(s) === 'in progress';

function daysBetween(a, b) {
  return Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));
}

function parseSprintDates(name) {
  const m = name?.match(/(\d{2}-\d{2}-\d{2})\s+to\s+(\d{2}-\d{2}-\d{2})/);
  if (m) {
    const parse = s => { const [d, mo, y] = s.split('-'); return new Date(`20${y}-${mo}-${d}`); };
    return { start: parse(m[1]), end: parse(m[2]) };
  }
  return null;
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
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 22px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>Sprint Velocity Trend</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>Completed story points per sprint · 3-sprint rolling average</div>
        </div>
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
      </div>

      {data.length === 0 ? (
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280', fontSize: 13 }}>
          No completed sprint data available
        </div>
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
              {data.map((entry, i) => (
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
          <div style={{ marginTop: 14, padding: '9px 12px', background: improving ? '#22c55e10' : '#ef444410', border: `1px solid ${improving ? '#22c55e30' : '#ef444430'}`, borderRadius: 8, fontSize: 12, color: improving ? '#86efac' : '#fca5a5' }}>
            {improving
              ? `📈 Team velocity has improved by ~${delta} SP/sprint over the last 3 sprints compared to earlier average.`
              : `📉 Team velocity has dropped by ~${Math.abs(delta)} SP/sprint over the last 3 sprints. Consider reviewing sprint scope or blockers.`}
          </div>
        );
      })()}
    </div>
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
    const totalDays = Math.max(1, daysBetween(start, end));
    const elapsed   = Math.min(totalDays, Math.max(0, daysBetween(start, today)));

    const totalSP = tickets.reduce((s, t) => s + getSP(t), 0);
    const doneSP  = tickets.filter(t => isDone(getStatus(t))).reduce((s, t) => s + getSP(t), 0);
    const remainSP = totalSP - doneSP;

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
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 22px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>Burndown Chart</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>
            {!selectedSprint || selectedSprint === 'all' ? 'Select a specific sprint to view burndown' : `${selectedSprint} · Story points remaining over time`}
          </div>
        </div>
        {selectedSprint && selectedSprint !== 'all' && (
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
      </div>

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
          {!selectedSprint || selectedSprint === 'all'
            ? 'Select a specific sprint from the dropdown to see its burndown'
            : 'Could not parse sprint dates — check sprint name format (DD-MM-YY to DD-MM-YY)'}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
            <defs>
              <linearGradient id="bdIdeal" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#60a5fa" stopOpacity={0.12} />
                <stop offset="95%" stopColor="#60a5fa" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="bdProj" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.18} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="bdActual" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.1} />
                <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
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

      {projShortfall > 0 && (
        <div style={{ marginTop: 14, padding: '9px 12px', background: '#f59e0b10', border: '1px solid #f59e0b30', borderRadius: 8, fontSize: 12, color: '#fbbf24' }}>
          ⚡ At current pace, ~<strong>{projShortfall} SP</strong> will likely not be completed by sprint end. Consider descoping lower-priority items or increasing team focus on in-progress work.
        </div>
      )}
      {projShortfall === 0 && data.length > 0 && doneSP > 0 && (
        <div style={{ marginTop: 14, padding: '9px 12px', background: '#22c55e10', border: '1px solid #22c55e30', borderRadius: 8, fontSize: 12, color: '#86efac' }}>
          ✅ Team is on track to complete all sprint work by the end date.
        </div>
      )}
    </div>
  );
}

// ─── TicketAgeAnalysis ────────────────────────────────────────────────────────
const AGE_THRESHOLDS = {
  fresh:  { max: 3,   label: 'Fresh',   color: '#22c55e' },
  normal: { max: 7,   label: 'Normal',  color: '#60a5fa' },
  ageing: { max: 14,  label: 'Ageing',  color: '#f59e0b' },
  stale:  { max: 999, label: 'Stale',   color: '#ef4444' },
};

function getAgeCategory(days) {
  if (days <= 3)  return AGE_THRESHOLDS.fresh;
  if (days <= 7)  return AGE_THRESHOLDS.normal;
  if (days <= 14) return AGE_THRESHOLDS.ageing;
  return AGE_THRESHOLDS.stale;
}

function TicketAgeAnalysis({ tickets = [] }) {
  const today = useMemo(() => new Date(), []);

  const { aged, distribution, avgAge, staleCount, maxAge } = useMemo(() => {
    const inProg = tickets.filter(t => isInP(getStatus(t)));

    const aged = inProg.map(t => {
      const dateStr = getUpdated(t) || getCreated(t);
      const days    = dateStr ? daysBetween(dateStr, today) : 0;
      const cat     = getAgeCategory(days);
      return {
        key:      getKey(t),
        summary:  getSummary(t),
        assignee: getAssignee(t),
        project:  getProject(t),
        days,
        cat,
      };
    }).sort((a, b) => b.days - a.days);

    const distribution = [
      { label: 'Fresh (0–3d)',   count: aged.filter(t => t.days <= 3).length,                color: '#22c55e' },
      { label: 'Normal (4–7d)',  count: aged.filter(t => t.days > 3  && t.days <= 7).length, color: '#60a5fa' },
      { label: 'Ageing (8–14d)', count: aged.filter(t => t.days > 7  && t.days <= 14).length,color: '#f59e0b' },
      { label: 'Stale (14d+)',   count: aged.filter(t => t.days > 14).length,                color: '#ef4444' },
    ];

    const avgAge     = aged.length ? Math.round(aged.reduce((s, t) => s + t.days, 0) / aged.length) : 0;
    const staleCount = aged.filter(t => t.days > 14).length;
    const maxAge     = aged.length ? aged[0].days : 0;

    return { aged, distribution, avgAge, staleCount, maxAge };
  }, [tickets, today]);

  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 22px', marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>Ticket Age Analysis</div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>How long In Progress tickets have been sitting without completion</div>
        </div>
        <div style={{ display: 'flex', gap: 20, fontSize: 12 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#6b7280' }}>Avg age</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: avgAge > 7 ? '#f59e0b' : '#60a5fa' }}>{avgAge}d</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#6b7280' }}>Stale tickets</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: staleCount > 0 ? '#ef4444' : '#22c55e' }}>{staleCount}</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>14+ days</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ color: '#6b7280' }}>Oldest</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: maxAge > 14 ? '#ef4444' : '#6b7280' }}>{maxAge}d</div>
          </div>
        </div>
      </div>

      {/* Distribution bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 8 }}>
          {distribution.map(d => {
            const pct = aged.length > 0 ? (d.count / aged.length) * 100 : 0;
            return pct > 0 ? (
              <div key={d.label} title={`${d.label}: ${d.count} tickets`}
                style={{ width: `${pct}%`, background: d.color, transition: 'width 0.5s ease' }} />
            ) : null;
          })}
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
          {distribution.map(d => (
            <span key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#9ca3af' }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, display: 'inline-block' }} />
              {d.label}: <strong style={{ color: d.color }}>{d.count}</strong>
            </span>
          ))}
        </div>
      </div>

      {aged.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
          No In Progress tickets found for current filters
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 110px 90px 70px', gap: 12, padding: '6px 12px', fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid rgba(255,255,255,0.05)', marginBottom: 4 }}>
            <div>Key</div><div>Summary</div><div>Assignee</div><div>Project</div><div style={{ textAlign: 'right' }}>Age</div>
          </div>
          {aged.slice(0, 12).map(t => (
            <div key={t.key} style={{ display: 'grid', gridTemplateColumns: '100px 1fr 110px 90px 70px', gap: 12, padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', alignItems: 'center' }}>
              <div style={{ fontSize: 12, color: '#60a5fa', fontWeight: 500 }}>{t.key}</div>
              <div style={{ fontSize: 12, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.summary}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.assignee}</div>
              <div style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.project}</div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: t.cat.color, background: `${t.cat.color}18`, border: `1px solid ${t.cat.color}40`, padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap' }}>
                  {t.days}d
                </span>
              </div>
            </div>
          ))}
          {aged.length > 12 && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
              + {aged.length - 12} more In Progress tickets not shown
            </div>
          )}
        </>
      )}

      {staleCount > 0 && (
        <div style={{ marginTop: 14, padding: '9px 12px', background: '#ef444410', border: '1px solid #ef444430', borderRadius: 8, fontSize: 12, color: '#fca5a5' }}>
          🕐 <strong>{staleCount} ticket{staleCount > 1 ? 's have' : ' has'} been In Progress for 14+ days.</strong>{' '}
          These are likely blocked or forgotten — bring them to the next standup for a status review.
        </div>
      )}
    </div>
  );
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
      if (s === 'in progress' || s === 'to do' || s === 'open' || s === 'new') {
        spByAssignee[a] = (spByAssignee[a] || 0) + getSP(t);
      }
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

  if (!tickets.length) {
    return <div className="flex items-center justify-center h-64 text-slate-400">No data loaded. Upload Jira data or refresh from Jira.</div>;
  }
  if (!metrics) return null;

  const scoreColor = metrics.score >= 75 ? 'text-green-400' : metrics.score >= 50 ? 'text-yellow-400' : 'text-red-400';
  const scoreBg    = metrics.score >= 75 ? 'bg-green-500/10 border-green-500/30' : metrics.score >= 50 ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-red-500/10 border-red-500/30';

  return (
    <div className="space-y-6">
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

      {/* ── New sections ── */}
      <SprintVelocityTrend
        tickets={tickets}
        sprints={sprints}
        selectedProject={selectedProject}
        selectedAssignee={selectedAssignee}
      />
      <BurndownChart
        tickets={tickets}
        selectedSprint={selectedSprint}
        sprints={sprints}
      />
      <TicketAgeAnalysis tickets={tickets} />
    </div>
  );
};

export default SprintHealthTab;
