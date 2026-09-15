import React, { useState, useMemo } from 'react';
import { ChevronRight, ChevronDown, AlertTriangle, GitCompare } from 'lucide-react';

const f1 = n => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const f2 = n => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const pc = v => (Number.isFinite(v) ? Math.round(v * 100) + '%' : '—');
const num = (v, fmt = f1, suffix = '') => (v == null ? '—' : fmt(v) + suffix);

const thL = { textAlign: 'left', padding: '7px 9px', fontWeight: 600, whiteSpace: 'nowrap', fontSize: 9.5, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' };
const thR = { ...thL, textAlign: 'right' };
const tdL = { textAlign: 'left', padding: '8px 9px', fontSize: 12 };
const tdR = { ...tdL, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };

function Card({ children, style = {} }) {
  return <div className="tt-print-card" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 22px', marginBottom: 16, ...style }}>{children}</div>;
}
function CardHeader({ title, subtitle, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14, gap: 16, flexWrap: 'wrap' }}>
      <div><div style={{ fontSize: 14, fontWeight: 600, color: '#f1f5f9' }}>{title}</div>{subtitle && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3, maxWidth: 780, lineHeight: 1.55 }}>{subtitle}</div>}</div>
      {right}
    </div>
  );
}

// Deltas are shown but never coloured good/bad — sprint-to-sprint movement at this volume
// is mostly noise, and a green arrow would invite reading it as a result.
function Delta({ value, fmt = f2, suffix = '' }) {
  if (value == null || !Number.isFinite(value)) return <span style={{ color: '#475569' }}>—</span>;
  if (Math.abs(value) < 1e-9) return <span style={{ color: '#64748b' }}>·</span>;
  return <span style={{ color: '#94a3b8', fontSize: 11 }}>{value > 0 ? '+' : '−'}{fmt(Math.abs(value))}{suffix}</span>;
}

function Sparkline({ data, accessor, color, label, format = f2, height = 40 }) {
  const pts = data.map(accessor);
  const valid = pts.filter(Number.isFinite);
  if (valid.length < 2) return (
    <div style={{ flex: '1 1 200px', minWidth: 180 }}>
      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>{label}</div>
      <div style={{ height, display: 'flex', alignItems: 'center', color: '#475569', fontSize: 11 }}>not enough sprints</div>
    </div>
  );
  const min = Math.min(...valid), max = Math.max(...valid);
  const span = max - min || 1;
  const w = 100, stepX = pts.length > 1 ? w / (pts.length - 1) : w;
  const xy = pts.map((v, i) => (Number.isFinite(v) ? [i * stepX, height - ((v - min) / span) * (height - 8) - 4] : null));
  // break the path wherever a sprint has no value rather than drawing through it
  const segments = [];
  let cur = [];
  for (const p of xy) { if (p) cur.push(p); else { if (cur.length) segments.push(cur); cur = []; } }
  if (cur.length) segments.push(cur);
  const last = valid[valid.length - 1], first = valid[0];
  return (
    <div style={{ flex: '1 1 200px', minWidth: 180 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color }}>{format(last)}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
        {segments.map((seg, i) => (
          <polyline key={i} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke"
            points={seg.map(([x, y]) => `${x},${y}`).join(' ')} />
        ))}
        {xy.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r="1.6" fill={color} vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: '#64748b', marginTop: 2 }}>
        <span>{format(first)}</span><span>{data[0]?.label} → {data[data.length - 1]?.label}</span>
      </div>
    </div>
  );
}

const GATE_NOTE = 'Single-sprint figures for one person are too small to compare — roughly a handful of completed tickets each. Volume only: no rate, no confidence interval, no size mix, no difficulty cross-check. Use the window view for anything comparative.';

function PersonDrilldown({ sprint }) {
  if (!sprint.people.length) {
    return <div style={{ padding: '12px 16px', fontSize: 12, color: '#6b7280' }}>No assessable contributors present in this sprint.</div>;
  }
  return (
    <div style={{ padding: '12px 16px 14px', background: 'rgba(96,165,250,0.05)', borderTop: '1px solid rgba(96,165,250,0.18)' }}>
      <div style={{ fontSize: 11.5, color: '#fbbf24', marginBottom: 10, lineHeight: 1.55, display: 'flex', gap: 7, alignItems: 'flex-start' }}>
        <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{GATE_NOTE}</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr><th style={thL}>Contributor</th><th style={thR}>Tickets</th><th style={thR}>SP</th><th style={thR}>Hours</th><th style={thR}>Unpointed%</th></tr>
        </thead>
        <tbody>
          {sprint.people.map(p => (
            <tr key={p.name} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <td style={{ ...tdL, color: '#e2e8f0', whiteSpace: 'nowrap' }}>{p.name}</td>
              <td style={{ ...tdR, color: '#e2e8f0' }}>{p.tickets}</td>
              <td style={{ ...tdR, color: '#e2e8f0' }}>{f1(p.sp)}</td>
              <td style={{ ...tdR, color: '#86efac' }}>{p.hours != null ? f1(p.hours) + 'h' : '—'}</td>
              <td style={{ ...tdR, color: '#64748b' }}>{p.unpointedShare != null ? pc(p.unpointedShare) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COLS = [
  { key: 'pointingCoverage', label: 'Pointed %', render: s => (s.pointingCoverage != null ? pc(s.pointingCoverage) : '—') },
  { key: 'present', label: 'Present', render: s => `${s.present}/${s.of}` },
  { key: 'availDays', label: 'Avail days', render: s => num(s.availDays) },
  { key: 'tickets', label: 'Tickets', render: s => s.tickets },
  { key: 'sp', label: 'SP', render: s => num(s.sp) },
  { key: 'spPerDay', label: 'SP/day', render: s => num(s.spPerDay, f2), strong: true },
  { key: 'medianCycle', label: 'Median cycle', render: s => num(s.medianCycle, f1, 'd') },
  { key: 'openWip', label: 'Open in-prog', render: s => num(s.openWip) },
  { key: 'stale', label: 'Stale (>20d)', render: s => s.stale ?? '—' },
  { key: 'loggedH', label: 'Logged h', render: s => num(s.loggedH, f1, 'h') },
  { key: 'logPct', label: 'Log %', render: s => (s.logPct != null ? pc(s.logPct) : '—') },
  { key: 'unpointedPct', label: 'Unpointed %', render: s => (s.unpointedPct != null ? pc(s.unpointedPct) : '—') },
];

export default function TeamBySprintView({ M, scopeLabel, allocBasisSummary }) {
  const [expanded, setExpanded] = useState(null);
  const [compare, setCompare] = useState(false);
  const sprints = useMemo(() => M.bySprint || [], [M.bySprint]);
  const [aIdx, setAIdx] = useState(() => Math.max(0, sprints.length - 2));
  const [bIdx, setBIdx] = useState(() => Math.max(0, sprints.length - 1));

  const deltas = useMemo(() => sprints.map((s, i) => {
    if (i === 0) return { spPerDay: null, medianCycle: null };
    const prev = sprints[i - 1];
    return {
      spPerDay: (s.spPerDay != null && prev.spPerDay != null) ? s.spPerDay - prev.spPerDay : null,
      medianCycle: (s.medianCycle != null && prev.medianCycle != null) ? s.medianCycle - prev.medianCycle : null,
    };
  }), [sprints]);

  if (!sprints.length) {
    return <div className="tt-print-root"><Card><div style={{ textAlign: 'center', padding: '28px 12px', color: '#94a3b8' }}>No completed sprints in the current window.</div></Card></div>;
  }

  const A = sprints[Math.min(aIdx, sprints.length - 1)];
  const B = sprints[Math.min(bIdx, sprints.length - 1)];

  return (
    <div className="tt-print-root">
      <div className="tt-print-header">
        <div style={{ fontSize: 18, fontWeight: 800 }}>Team Contribution — by sprint</div>
        <div style={{ fontSize: 12 }}>{scopeLabel} · generated {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
        <div style={{ fontSize: 11 }}>Allocation basis: {allocBasisSummary}</div>
      </div>

      <div style={{ fontSize: 11.5, color: '#6b7280', margin: '0 2px 12px' }}>
        Every figure below is drawn from the <strong style={{ color: '#94a3b8' }}>assessable contributors present in that sprint</strong> — the same population on both sides of every ratio. A sprint with fewer people present should be expected to deliver less; the SP/day column is the one that removes that effect.
      </div>

      {/* Small multiples */}
      <Card>
        <CardHeader title="Across the window" subtitle="Three shapes worth watching. Each breaks where a sprint has no value rather than drawing through it." />
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap' }}>
          <Sparkline data={sprints} accessor={s => s.spPerDay} color="#22c55e" label="SP per available day" format={f2} />
          <Sparkline data={sprints} accessor={s => s.medianCycle} color="#f59e0b" label="Median cycle time (working days)" format={f1} />
          <Sparkline data={sprints} accessor={s => s.stale} color="#ef4444" label="Stale queue (>20 working days)" format={f1} />
        </div>
      </Card>

      {/* Per-sprint table */}
      <Card>
        <CardHeader
          title="Sprint by sprint"
          subtitle="Chronological. Click a row to see per-person volume for that sprint. Deltas are against the previous sprint and are deliberately not coloured — at this volume, sprint-to-sprint movement is mostly noise."
          right={<button onClick={() => setCompare(c => !c)} style={{ background: compare ? 'rgba(96,165,250,0.22)' : 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: compare ? '#dbeafe' : '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: 6 }}><GitCompare size={13} /> Compare two sprints</button>}
        />
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
            <thead>
              <tr>
                <th style={{ ...thL, position: 'sticky', left: 0, background: '#0f172a', zIndex: 2 }}>Sprint</th>
                {COLS.map(c => <th key={c.key} style={thR}>{c.label}</th>)}
                <th style={thR}>Δ SP/day</th>
                <th style={thR}>Δ cycle</th>
              </tr>
            </thead>
            <tbody>
              {sprints.map((s, i) => (
                <React.Fragment key={s.name}>
                  <tr
                    onClick={() => setExpanded(e => (e === s.name ? null : s.name))}
                    style={{ borderTop: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', background: expanded === s.name ? 'rgba(96,165,250,0.07)' : 'transparent' }}
                  >
                    <td style={{ ...tdL, color: '#e2e8f0', fontWeight: 500, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: expanded === s.name ? '#132038' : '#0f172a', zIndex: 1 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        {expanded === s.name ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{s.label}
                        {s.rated === false && <span title="Excluded from every rate — too few completed tickets carried story points" style={{ color: '#f87171', fontSize: 10, fontWeight: 700 }}>✕ no rate</span>}
                      </span>
                    </td>
                    {COLS.map(c => {
                      const lowCov = c.key === 'pointingCoverage' && s.pointingCoverage != null && s.pointingCoverage < 0.9;
                      return (
                        <td key={c.key} style={{ ...tdR, opacity: s.rated === false && (c.key === 'spPerDay' || c.key === 'medianCycle') ? 0.4 : 1, color: lowCov ? '#fca5a5' : c.strong ? '#93c5fd' : (c.key === 'stale' && s.stale > 0 ? '#fca5a5' : '#cbd5e1'), fontWeight: (c.strong || lowCov) ? 600 : 400 }}>
                          {c.render(s)}
                        </td>
                      );
                    })}
                    <td style={tdR}><Delta value={deltas[i].spPerDay} fmt={f2} /></td>
                    <td style={tdR}><Delta value={deltas[i].medianCycle} fmt={f1} suffix="d" /></td>
                  </tr>
                  {expanded === s.name && (
                    <tr><td colSpan={COLS.length + 3} style={{ padding: 0 }}><PersonDrilldown sprint={s} /></td></tr>
                  )}
                </React.Fragment>
              ))}
              <tr style={{ borderTop: '2px solid rgba(255,255,255,0.18)', background: 'rgba(255,255,255,0.03)' }}>
                <td style={{ ...tdL, color: '#f1f5f9', fontWeight: 700, whiteSpace: 'nowrap', position: 'sticky', left: 0, background: '#141d2e', zIndex: 1 }}>{M.windowTotals.label}</td>
                {COLS.map(c => (
                  <td key={c.key} style={{ ...tdR, color: '#e2e8f0', fontWeight: 600 }}>{c.render(M.windowTotals)}</td>
                ))}
                <td style={tdR} /><td style={tdR} />
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 10, lineHeight: 1.6 }}>
          <strong style={{ color: '#94a3b8' }}>Pointed %</strong> is the share of completed tickets in that sprint that carried a story point at all. A sprint marked <span style={{ color: '#f87171' }}>✕ no rate</span> fell below the threshold and is excluded from SP/day, cycle time and the window total on both sides — its volume columns are still shown because the work was real.
          {' '}The window total is not the sum of the rows for every column: SP/day, median cycle and open in-progress are computed across the whole window, not averaged across sprints. <strong style={{ color: '#94a3b8' }}>Open in-prog</strong> is the average number of tickets sitting in an in-progress status per person, and <strong style={{ color: '#94a3b8' }}>Stale</strong> counts those open longer than 20 working days at that point — both describe the queue, not effort.
        </div>
      </Card>

      {/* Two-sprint comparison */}
      {compare && (
        <Card>
          <CardHeader title="Sprint comparison" subtitle="Team level only. Useful for this-sprint-versus-last and for quarter boundaries." />
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
            {[[aIdx, setAIdx, 'First'], [bIdx, setBIdx, 'Second']].map(([idx, setIdx, lbl]) => (
              <label key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#94a3b8' }}>{lbl}
                <select value={idx} onChange={e => setIdx(parseInt(e.target.value, 10))} style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}>
                  {sprints.map((s, i) => <option key={s.name} value={i}>{s.label}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
              <thead>
                <tr>
                  <th style={thL}>Measure</th>
                  <th style={thR}>{A.label}</th>
                  <th style={thR}>{B.label}</th>
                  <th style={thR}>Change</th>
                </tr>
              </thead>
              <tbody>
                {COLS.map(c => {
                  const av = A[c.key], bv = B[c.key];
                  const diff = (typeof av === 'number' && typeof bv === 'number') ? bv - av : null;
                  const isPct = c.key === 'logPct' || c.key === 'unpointedPct';
                  return (
                    <tr key={c.key} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ ...tdL, color: '#cbd5e1' }}>{c.label}</td>
                      <td style={{ ...tdR, color: '#e2e8f0' }}>{c.render(A)}</td>
                      <td style={{ ...tdR, color: '#e2e8f0' }}>{c.render(B)}</td>
                      <td style={tdR}>{c.key === 'present' ? '—' : <Delta value={isPct && diff != null ? diff * 100 : diff} fmt={f1} suffix={isPct ? ' pts' : ''} />}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11, color: '#6b7280', marginTop: 10, lineHeight: 1.6 }}>
            Two sprints is a sample of two. A change here is a prompt to ask what happened in that sprint, not evidence of a trend — the sparklines above are the better guide to direction.
          </div>
        </Card>
      )}

      <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.7, padding: '14px 16px', background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.2)', borderRadius: 10 }}>
        <strong style={{ color: '#cbd5e1' }}>Per person per sprint, this data does not support comparison.</strong> {GATE_NOTE} If a normalised per-person-per-sprint figure is asked for, the answer is that the sample cannot carry it — producing one would invite exactly the misreading the window view was built to prevent.
      </div>
    </div>
  );
}
