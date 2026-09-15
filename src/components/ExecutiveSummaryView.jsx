import React, { useMemo } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceLine } from 'recharts';
import { loadPlanningSPPerDay } from '../utils/teamEngine';

// Team-level only. No contributor is named anywhere in this view, by design:
// allocation is partly inferred, several people have single-digit sample sizes, and the
// per-person ranges overlap almost everywhere. A named comparison at this noise level
// survives being screenshotted out of context as a verdict the data cannot support.

const f1 = n => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const f2 = n => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const pctI = n => (Number.isFinite(n) ? Math.round(n) : null);

// Two independent axes, rendered separately. Colour follows SEVERITY, never confidence —
// a reassuring finding must never be painted red just because it is tentative.
const CONFIDENCE = {
  high:        { label: 'High confidence', words: 'We can say this with confidence.' },
  medium:      { label: 'Well supported',  words: 'This is well supported but rests on an assumption worth checking.' },
  directional: { label: 'Directional',     words: 'This is directional only — treat it as a question, not a conclusion.' },
};
const SEVERITY = {
  adverse:    { label: 'Needs action', color: '#b91c1c', accent: '#ef4444', bg: 'rgba(185,28,28,0.13)', border: 'rgba(239,68,68,0.45)' },
  neutral:    { label: 'For awareness', color: '#b45309', accent: '#f59e0b', bg: 'rgba(180,83,9,0.13)', border: 'rgba(245,158,11,0.45)' },
  reassuring: { label: 'No action needed', color: '#15803d', accent: '#22c55e', bg: 'rgba(21,128,61,0.13)', border: 'rgba(34,197,94,0.45)' },
};
// Red is reserved for findings that are BOTH adverse and well-evidenced.
const accentFor = f => (f.severity === 'adverse' && f.confidence === 'directional')
  ? SEVERITY.neutral.accent
  : SEVERITY[f.severity].accent;

function Page({ children, breakBefore = false }) {
  return <div className={breakBefore ? 'tt-print-card tt-page-break' : 'tt-print-card'} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '22px 24px', marginBottom: 16 }}>{children}</div>;
}

function SectionTitle({ children, sub }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 16, fontWeight: 800, color: '#f1f5f9' }}>{children}</div>
      {sub && <div style={{ fontSize: 12, color: '#6b7280', marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Finding({ n, finding }) {
  const c = CONFIDENCE[finding.confidence];
  const sev = SEVERITY[finding.severity];
  const accent = accentFor(finding);
  return (
    <div className="tt-print-card" style={{ display: 'flex', gap: 14, padding: '15px 17px', border: '1px solid rgba(255,255,255,0.1)', borderLeft: `4px solid ${accent}`, borderRadius: 10, marginBottom: 12, background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: '#475569', lineHeight: 1, minWidth: 22 }}>{n}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: '#f1f5f9', lineHeight: 1.45 }}>{finding.claim}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: sev.color, background: sev.bg, border: `1px solid ${sev.border}`, borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap' }}>{sev.label}</span>
            <span style={{ fontSize: 10.5, fontWeight: 600, color: '#94a3b8', background: 'rgba(148,163,184,0.12)', border: '1px solid rgba(148,163,184,0.35)', borderRadius: 20, padding: '3px 10px', whiteSpace: 'nowrap' }}>{c.label}</span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '11px 0 9px' }}>
          <div style={{ fontSize: 27, fontWeight: 800, color: finding.numberColor || '#60a5fa', lineHeight: 1 }}>{finding.number}</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>{finding.numberLabel}</div>
        </div>

        <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.6, marginBottom: 8 }}>{finding.detail}</div>

        <div style={{ fontSize: 12.5, color: '#e2e8f0', lineHeight: 1.55, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.22)', borderRadius: 8, padding: '9px 12px', marginBottom: 8 }}>
          <strong style={{ color: '#bfdbfe' }}>What to do:</strong> {finding.action}
        </div>

        <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.55 }}>
          <strong style={{ color: '#94a3b8' }}>What this is based on:</strong> {finding.basedOn} {c.words}
        </div>
      </div>
    </div>
  );
}

// ─── Finding generation ───────────────────────────────────────────────────────
function buildFindings(M, meta, planningSPPerDay) {
  const out = [];
  const T = M.team;
  const sprintCount = meta.sprintCount;
  const inferredAlloc = (M.basisCounts?.spShare || 0) + (M.basisCounts?.eligibility || 0);
  const allocCaveat = inferredAlloc > 0
    ? `Available days for ${inferredAlloc} of the ${M.assessableCount} people counted are inferred, not configured.`
    : 'Available days come from configured allocation.';

  const ratedCount = M.coverage ? M.coverage.ratedCount : sprintCount;
  const excludedNote = M.coverage?.excluded.length
    ? ` ${M.coverage.excluded.map(e => e.label).join(' and ')} ${M.coverage.excluded.length > 1 ? 'are' : 'is'} excluded — only ${M.coverage.excluded.map(e => `${pctI(e.coverage * 100)}%`).join(' and ')} of completed tickets there carried points.`
    : '';

  // 1 — Delivery pace ---------------------------------------------------------
  if (T.spPerDay != null && ratedCount >= 2) {
    const tr = M.paceTrend;
    // Only assert a direction when the test says so. A series that swings by an order of
    // magnitude is describing noise, and calling it improvement would be a claim the data
    // cannot carry.
    const claimTail = tr?.trending
      ? `, and that rate has been ${tr.direction > 0 ? 'improving' : 'declining'} across the window`
      : '';
    const perSprintDays = T.totalAllocDays / Math.max(ratedCount, 1);
    const expectedPerSprint = T.spPerDay * perSprintDays;
    out.push({
      key: 'pace',
      severity: 'neutral',
      claim: `The team delivers about ${f2(T.spPerDay)} story points for every day a person is available${claimTail}.`,
      number: f2(T.spPerDay), numberLabel: 'story points per available person-day', numberColor: '#22c55e',
      detail: `Over the measured sprints the team completed ${f1(T.assessableSP)} points across ${f1(T.totalAllocDays)} available person-days. At the same rate, a sprint with the team's typical availability of ${f1(perSprintDays)} person-days should produce around ${f1(expectedPerSprint)} points.` +
        (tr && !tr.trending && tr.testable
          ? ` The sprint-by-sprint rate varies substantially and shows no reliable direction, so the window average is the more dependable figure — not the most recent sprint.`
          : ''),
      action: `Commit to roughly ${f1(expectedPerSprint)} points next sprint, adjusted for known leave. Treat anything materially above that as a stretch, not a plan.`,
      basedOn: `${ratedCount} of ${sprintCount} completed sprints, ${T.assessableTickets} completed pointed tickets from ${M.assessableCount} people.${excludedNote} ${allocCaveat}`,
      confidence: ratedCount >= 4 && M.assessableCount >= 4 ? (inferredAlloc > 0 ? 'medium' : 'high') : 'directional',
    });
  }

  // 2 — Capacity planning constant --------------------------------------------
  if (T.spPerDay != null && planningSPPerDay > 0) {
    const multiple = planningSPPerDay / T.spPerDay;
    if (multiple >= 1.25 || multiple <= 0.8) {
      const over = multiple > 1;
      out.push({
        key: 'planning', severity: 'adverse',
        claim: over
          ? 'Sprint planning assumes the team works faster than it has ever measurably worked.'
          : 'Sprint planning assumes the team is slower than it has actually been delivering.',
        number: `${f1(multiple)}×`, numberLabel: over ? 'planning assumption over observed delivery' : 'observed delivery over planning assumption',
        numberColor: over ? '#f87171' : '#22c55e',
        detail: `The planning constant in this dashboard is ${f2(planningSPPerDay)} points per person-day. Actual delivery across the window is ${f2(T.spPerDay)}. Every sprint planned on the current constant starts ${over ? 'over-committed' : 'under-committed'} by about ${pctI(Math.abs(multiple - 1) * 100)}%.`,
        action: `Change the planning constant to ${f2(T.spPerDay)} points per person-day and re-plan the next sprint against it. This is a one-line configuration change, not a change to how anyone works.`,
        basedOn: `Completed work and calendar days only — it does not depend on logged time. ${sprintCount} sprints, ${T.assessableTickets} tickets.`,
        confidence: ratedCount >= 4 ? 'high' : 'medium',
      });
    }
  }

  // 3 — Time tracking coverage -------------------------------------------------
  if (T.loggingCompleteness != null && T.loggingCompleteness < 0.75) {
    const spread = M.completenessSpread;
    out.push({
      key: 'logging', severity: 'adverse',
      claim: 'Time tracking captures only a minority of the hours the team actually works.',
      number: `${pctI(T.loggingCompleteness * 100)}%`, numberLabel: 'of available hours are logged in Jira', numberColor: '#f87171',
      detail: `About ${f1(T.loggedHours)} hours are recorded against roughly ${f1(T.capacityHours)} hours of available capacity — both counted over the same ${M.assessableCount} people.${spread ? ` Between individuals the figure ranges from ${pctI(spread[0] * 100)}% to ${pctI(Math.min(spread[1], 1) * 100)}%, so the gap is not spread evenly.` : ''} Any cost, billing or client-facing number drawn from Jira hours today is therefore built on a fraction of the real picture.`,
      action: 'Decide first whether Jira hours are meant to support costing, billing or client reporting. If they are, this is a data-integrity problem that needs a logging policy and a follow-up — not a dashboard change. If they are not, stop reporting on them and remove the pressure to log.',
      basedOn: `Logged work and available person-days × ${f1(T.hoursPerDay)} hours, both drawn from the same ${M.assessableCount} people. Counting everyone who appears in the window, including those left out of the rates, it is ${T.loggingCompletenessAll != null ? pctI(T.loggingCompletenessAll * 100) + '%' : 'similar'}.`,
      confidence: T.loggingCompleteness < 0.6 ? 'high' : 'medium',
      _prominent: true,
    });
  }

  // 4 — Work is started and then sits -------------------------------------------
  if (M.queue && M.queue.open > 0 && M.queue.stale > 0) {
    const q = M.queue;
    const stalePct = Math.round((q.stale / q.open) * 100);
    out.push({
      key: 'queue', severity: 'adverse',
      claim: `${q.stale} of the ${q.open} tickets the team has open have not finished in ${q.staleThreshold} working days or more.`,
      number: `${q.stale}`, numberLabel: `stalled tickets — ${stalePct}% of everything currently open`, numberColor: '#f87171',
      detail: `${q.open - q.active} of the open tickets have had no activity at all in the last ${q.activeWindow} working days. The typical open ticket has been open ${f1(q.medianAge)} working days, and the slowest tenth have been open ${f1(q.p90Age)} or more.${q.oldest ? ` The oldest is ${q.oldest.key}, open ${f1(q.oldest.age)} working days.` : ''}` +
        (M.littlesLaw?.breached ? ` This also means the ${f1(T.cycleDaysMedian)}-day completion time quoted elsewhere is a best case: it is measured only on tickets that finished, and these never enter it.` : ''),
      action: `Review everything open past ${q.staleThreshold} days in one session and make a decision on each: finish it, hand it on, or close it. A queue this old is usually waiting on something nobody has been asked to unblock.`,
      basedOn: `Every ticket in an in-progress state at the time of generation, for the ${M.assessableCount} people counted in this report. Age is working days since the ticket was started.`,
      confidence: q.unknownAge === 0 ? 'high' : 'medium',
      _prominent: true,
    });
  }

  if (M.flow && M.flow.verdict !== 'ok' && T.cycleDaysMedian != null) {
    const isFlow = M.flow.verdict === 'flow';
    out.push({
      key: 'flow', severity: 'adverse',
      claim: `A typical ticket that does finish takes ${f1(T.cycleDaysMedian)} working days, for work sized at ${f1(T.medianTicketSize)} points.`,
      number: `${f1(T.cycleDaysMedian)} days`, numberLabel: `to complete a typical ${f1(T.medianTicketSize)}-point ticket`, numberColor: '#fbbf24',
      detail: isFlow
        ? `Each person has about ${f1(T.openWipMedian)} tickets sitting in an in-progress state. Small items taking this long while that many stay open is the signature of too much started at once — each piece spends most of its life waiting rather than being worked on.`
        : `Each person has only about ${f1(T.openWipMedian)} tickets sitting in an in-progress state, so the delay is not congestion. Work that sits while little else is open is waiting on something outside the team's control — a dependency, a review, an environment, or an approval.`,
      action: isFlow
        ? 'Set a limit on how many items one person may have open at once, and require the oldest to be finished before a new one is started. Re-measure after two sprints.'
        : 'Spend one session identifying what the open work waits on, and who owns each of those. Fixing the two most common blockers will move this number more than any change in individual effort.',
      basedOn: `${T.assessableTickets} completed tickets with change history, plus work still open at the time of generation. Time is counted in working days from first activity to completion.`,
      confidence: T.assessableTickets >= 30 && M.changelogLoaded ? 'high' : 'medium',
    });
  }

  // 5 — Does the sizing hold up? ------------------------------------------------
  if (M.spearman && M.spearman.n >= 8) {
    const { rho, n } = M.spearman;
    const sound = rho >= 0.4;
    out.push({
      key: 'estimation',
      severity: sound ? 'reassuring' : 'adverse',
      claim: sound
        ? 'Estimation itself is sound — the points the team assigns do rank work correctly by how long it takes.'
        : 'The points assigned to work do not track how long that work actually takes.',
      number: sound ? 'Holds up' : 'Weak link', numberLabel: `checked across ${n} completed tickets with recorded time`,
      numberColor: sound ? '#22c55e' : '#f87171',
      detail: sound
        ? 'Bigger-pointed tickets do consistently take longer than smaller-pointed ones. Whatever else this report raises, the team can size work — the other findings should not be read as "the team cannot estimate".'
        : 'Tickets given more points do not reliably take longer than tickets given fewer. Note that recorded time itself is incomplete, so this check is weaker than it looks and may be measuring the logging gap rather than the sizing.',
      action: sound
        ? 'None. Leave the estimation practice alone and direct effort at the findings above.'
        : 'Do not act on this alone. Fix time-recording coverage first, then re-check — with the current coverage this cannot be separated from the logging gap.',
      basedOn: `${n} completed pointed tickets that also carry recorded time, over ${sprintCount} sprints. Depends on recorded time, which is incomplete.`,
      confidence: (T.loggingCompleteness != null && T.loggingCompleteness < 0.4) ? 'directional' : (n >= 40 ? 'medium' : 'directional'),
    });
  }

  // At most five. Prominent findings lead; the estimation finding always keeps a slot when
  // it exists, because without it the rest reads as "the team cannot estimate" — which is
  // the one thing this data does not say.
  const estimation = out.find(f => f.key === 'estimation');
  const rest = out.filter(f => f.key !== 'estimation');
  rest.sort((a, b) => (b._prominent ? 1 : 0) - (a._prominent ? 1 : 0));
  const kept = rest.slice(0, estimation ? 4 : 5);
  return estimation ? [...kept, estimation] : kept;
}

// ─── View ─────────────────────────────────────────────────────────────────────
// "14 whole portfolio (100%)" reads as a number bolted to an unrelated phrase, and cites a
// population the rates do not use. Say it as a sentence instead.
const BASIS_PHRASE = {
  configured:  'allocation configured per person',
  spShare:     'allocation inferred from their share of completed points',
  eligibility: 'allocation inferred from project eligibility',
  portfolio:   'whole-portfolio allocation (100%)',
  assumed:     'no verified allocation',
};
function availabilitySentence(M) {
  const counts = M.basisCounts || {};
  const entries = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return 'Availability basis: no contributors in this window.';
  const total = entries.reduce((a, [, n]) => a + n, 0);
  const head = entries.length === 1
    ? `all contributors at ${BASIS_PHRASE[entries[0][0]] || entries[0][0]}`
    : entries.map(([k, n]) => `${n} of ${total} at ${BASIS_PHRASE[k] || k}`).join(', ');
  const excluded = M.rows.length - M.assessableCount;
  const tail = excluded > 0
    ? ` Rates cover the ${M.assessableCount} contributors with enough completed work to measure; ${excluded} others are excluded from both sides.`
    : ` Rates cover all ${M.assessableCount} contributors.`;
  return `Availability basis: ${head}.${tail}`;
}

// A sprint with partial pointing coverage still plots, but must not look like a clean point.
function CoverageDot({ cx, cy, payload }) {
  if (cx == null || cy == null) return null;
  const low = payload?.lowCoverage;
  return (
    <g>
      <circle cx={cx} cy={cy} r={3} fill="#22c55e" />
      {low && <circle cx={cx} cy={cy} r={6} fill="none" stroke="#f59e0b" strokeWidth={1.8} />}
    </g>
  );
}

function PaceTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload || {};
  return (
    <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '9px 12px', fontSize: 12 }}>
      <div style={{ color: '#e2e8f0', fontWeight: 600 }}>{label}</div>
      <div style={{ color: '#86efac' }}>{p.spPerDay} points per person-day</div>
      <div style={{ color: '#94a3b8', fontSize: 11 }}>{p.sp} points over {p.days} person-days</div>
      {p.pointingCoverage != null && (
        <div style={{ color: p.lowCoverage ? '#fbbf24' : '#64748b', fontSize: 11, marginTop: 3 }}>
          {pctI(p.pointingCoverage * 100)}% of completed tickets carried points{p.lowCoverage ? ' — rate understates delivery' : ''}
        </div>
      )}
    </div>
  );
}

export default function ExecutiveSummaryView({ M, meta, windowN, onWindowChange }) {
  const planningSPPerDay = useMemo(() => loadPlanningSPPerDay(), []);

  const findings = useMemo(() => buildFindings(M, meta, planningSPPerDay), [M, meta, planningSPPerDay]);
  const paceSeries = useMemo(() => M.teamTrend.filter(p => p.spPerDay != null), [M.teamTrend]);
  const teamPace = M.team.spPerDay;

  return (
    <div className="tt-print-root">
      <div className="tt-no-print" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#94a3b8' }}>Report window
          <select value={windowN} onChange={e => onWindowChange?.(parseInt(e.target.value, 10))} style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#e2e8f0', padding: '5px 8px', fontSize: 12 }}>
            <option value={3}>Last 3 completed sprints</option><option value={6}>Last 6 completed sprints</option><option value={12}>Last 12 completed sprints</option>
          </select>
        </label>
        <button onClick={() => window.print()} style={{ background: 'rgba(37,99,235,0.2)', border: '1px solid rgba(96,165,250,0.5)', borderRadius: 8, padding: '7px 13px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#bfdbfe' }}>
          🖨 Print / Save as PDF
        </button>
      </div>

      {/* ── Header (also the print header) ── */}
      <div className="tt-print-card" style={{ borderBottom: '3px solid rgba(255,255,255,0.15)', paddingBottom: 14, marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.01em' }}>Delivery — Executive Summary</div>
        <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 5, lineHeight: 1.6 }}>
          {meta.projectLabel} · {meta.sprintCount} completed sprints{meta.windowStart && meta.windowEnd ? ` (${meta.windowStart.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} – ${meta.windowEnd.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })})` : ''} · generated {meta.generatedAt}
        </div>
        <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 8, lineHeight: 1.6, background: 'rgba(96,165,250,0.08)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 8, padding: '9px 12px' }}>
          This report covers the <strong>last {meta.sprintCount} completed sprints{meta.sprintNames?.length ? ` (${meta.sprintNames[0]}–${meta.sprintNames[meta.sprintNames.length - 1]})` : ''}</strong>. It does not change with the sprint filter above — use the report-window selector instead.
          {M.coverage?.excluded.length > 0 && (
            <> <strong style={{ color: '#fca5a5' }}>{M.coverage.excluded.map(e => e.label).join(' and ')} {M.coverage.excluded.length > 1 ? 'are' : 'is'} excluded from every rate</strong> — only {M.coverage.excluded.map(e => `${pctI(e.coverage * 100)}%`).join(' and ')} of completed tickets there carried story points.</>
          )}
        </div>
        <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 6, lineHeight: 1.55 }}>{availabilitySentence(M)}</div>
      </div>

      {/* ── PAGE 1 — findings ── */}
      <Page>
        <SectionTitle sub={`${findings.length} finding${findings.length === 1 ? '' : 's'} from the last ${meta.sprintCount} completed sprints. Each carries the number behind it, what to do about it, and how much weight it will bear.`}>
          What the delivery data shows
        </SectionTitle>
        {findings.length === 0 ? (
          <div style={{ padding: '24px 12px', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            Not enough completed work in this window to support a finding. Widen the window or wait for more sprints to close.
          </div>
        ) : findings.map((f, i) => <Finding key={f.key} n={i + 1} finding={f} />)}
      </Page>

      {/* ── PAGE 2 — supporting charts, team level only ── */}
      <Page breakBefore>
        <SectionTitle sub="Team totals only. Individual lines are deliberately not shown — see the note at the end.">
          How delivery moved across the window
        </SectionTitle>

        <div style={{ fontSize: 12.5, color: '#cbd5e1', marginBottom: 10, fontWeight: 600 }}>Points delivered per available person-day, by sprint</div>
        {paceSeries.length < 2 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 12.5 }}>Needs at least two completed sprints.</div>
        ) : (
          <ResponsiveContainer width="100%" height={230}>
            <LineChart data={paceSeries} margin={{ top: 8, right: 20, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip content={<PaceTip />} />
              {teamPace != null && <ReferenceLine y={f2(teamPace)} stroke="#94a3b8" strokeDasharray="4 3" label={{ value: `window average ${f2(teamPace)}`, fill: '#94a3b8', fontSize: 10, position: 'insideTopRight' }} />}
              <Line dataKey="spPerDay" stroke="#22c55e" strokeWidth={2.2} dot={<CoverageDot />} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6, lineHeight: 1.6 }}>
          Sprints excluded for low pointing coverage do not appear on this chart at all — a rate computed from them would measure the pointing practice, not the delivery.
          {M.teamTrend.some(p => p.lowCoverage) && <> An amber ring marks a sprint that is included but where under 90% of completed tickets carried points; its rate understates what was delivered.</>}
        </div>

        <div style={{ fontSize: 12.5, color: '#cbd5e1', margin: '20px 0 10px', fontWeight: 600 }}>Points completed and person-days available, by sprint</div>
        {M.teamTrend.length < 2 ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#6b7280', fontSize: 12.5 }}>Needs at least two completed sprints.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={M.teamTrend} margin={{ top: 8, right: 20, left: -8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }} labelStyle={{ color: '#e2e8f0' }} />
              <Bar dataKey="sp" name="Points completed" fill="#60a5fa" radius={[3, 3, 0, 0]} maxBarSize={38} />
              <Bar dataKey="days" name="Person-days available" fill="#334155" radius={[3, 3, 0, 0]} maxBarSize={38} />
            </BarChart>
          </ResponsiveContainer>
        )}
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 8, lineHeight: 1.6 }}>
          Person-days available already account for who was on the team in each sprint and how much of their time this project holds. A sprint with fewer people available should be expected to deliver fewer points; the first chart is the one that removes that effect.
        </div>
      </Page>

      {/* ── PAGE 3 — appendix ── */}
      <Page breakBefore>
        <SectionTitle sub="Method, sample sizes and the assumptions each figure rests on.">
          Appendix — how these numbers were produced
        </SectionTitle>

        <div style={{ display: 'grid', gap: 14, fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.68 }}>
          <div>
            <div style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Window and scope</div>
            {meta.sprintCount} completed sprints for {meta.projectLabel}: {meta.sprintNames.join(', ')}. Sprints still running are excluded. {meta.workingDaysInWindow} working days in total, with weekends and Greek public holidays removed. The derivation is printed below so it can be checked against a calendar.
            {M.dayDerivation?.length > 0 && (
              <div style={{ marginTop: 8, overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 11.5, minWidth: 420 }}>
                  <thead><tr style={{ color: '#6b7280' }}>
                    <th style={{ textAlign: 'left', padding: '4px 10px 4px 0' }}>Sprint</th>
                    <th style={{ textAlign: 'left', padding: '4px 10px' }}>Dates (inclusive)</th>
                    <th style={{ textAlign: 'right', padding: '4px 10px' }}>Working days</th>
                    <th style={{ textAlign: 'left', padding: '4px 0 4px 10px' }}>Used for rates</th>
                  </tr></thead>
                  <tbody>
                    {M.dayDerivation.map(d => (
                      <tr key={d.label} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        <td style={{ padding: '4px 10px 4px 0', color: '#e2e8f0' }}>{d.label}</td>
                        <td style={{ padding: '4px 10px', color: '#94a3b8' }}>{d.start?.toLocaleDateString?.('en-GB', { day: '2-digit', month: 'short' })} – {d.end?.toLocaleDateString?.('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                        <td style={{ padding: '4px 10px', textAlign: 'right', color: '#e2e8f0' }}>{d.workingDays}</td>
                        <td style={{ padding: '4px 0 4px 10px', color: d.rated ? '#86efac' : '#fca5a5' }}>{d.rated ? 'yes' : 'no — pointing coverage'}</td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid rgba(255,255,255,0.15)' }}>
                      <td style={{ padding: '5px 10px 4px 0', color: '#f1f5f9', fontWeight: 700 }}>Total</td>
                      <td />
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: '#f1f5f9', fontWeight: 700 }}>{M.dayDerivation.reduce((a, d) => a + d.workingDays, 0)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 5 }}>Both the first and last day of a sprint count as working days. Counting only the days after the start would drop one day per sprint and inflate every rate here by around a tenth.</div>
              </div>
            )}
          </div>

          {M.coverage && (
            <div>
              <div style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Which sprints the rates are built from</div>
              A rate in points per day only means something if the completed work carried points in the first place. Each sprint is checked for the share of its completed tickets that had a story point at all; anything below {pctI(M.coverage.threshold * 100)}% is dropped from every rate, on both sides of the ratio.
              {M.coverage.excluded.length > 0
                ? <> {M.coverage.excluded.map(e => `${e.label} was excluded — ${e.pointed} of its ${e.all} completed tickets carried points (${pctI(e.coverage * 100)}%)`).join('; ')}. Without this gate those sprints would have dragged the window rate down and made the later sprints look like an improvement in delivery, when what changed was the pointing practice.</>
                : ' Every sprint in this window cleared the threshold.'}
              {M.coverage.lowButIncluded.length > 0 && <> {M.coverage.lowButIncluded.map(e => `${e.label} is included but only ${pctI(e.coverage * 100)}% pointed`).join('; ')}, so its rate understates what was delivered.</>}
            </div>
          )}

          {M.paceTrend && (
            <div>
              <div style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Whether the rate is trending</div>
              {M.paceTrend.testable
                ? <>The sprint-by-sprint rate was tested for a consistent direction across {M.paceTrend.n} measured sprints (Mann–Kendall, two-sided, p={M.paceTrend.pValue < 0.001 ? '<0.001' : M.paceTrend.pValue.toFixed(3)}). {M.paceTrend.trending
                    ? `It ${M.paceTrend.direction > 0 ? 'is rising' : 'is falling'} consistently enough to report as a direction.`
                    : 'It does not move consistently in either direction, so this report does not claim a trend — the window average is quoted instead. A series that swings this much between sprints will look like improvement or decline depending on which end you read from.'}</>
                : `Only ${M.paceTrend.n} measured sprint(s) — too few to test for a direction, so none is claimed.`}
            </div>
          )}

          <div>
            <div style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Sample sizes</div>
            {M.team.assessableTickets} completed pointed tickets from {M.assessableCount} people are counted in the rates.
            {M.rows.length !== M.assessableCount && ` A further ${M.rows.length - M.assessableCount} contributor(s) appear in the window but are left out of every rate — and out of the capacity denominator — because they completed fewer than 10 pointed tickets or their available time could not be established.`}
            {M.team.excludedSP > 0 && ` That excluded work amounts to ${f1(M.team.excludedSP)} points, which is why the totals here are smaller than the raw delivery figure of ${f1(M.team.totalSP)} points.`}
            {M.spearman && ` The sizing check uses the ${M.spearman.n} completed tickets that also carry recorded time.`}
          </div>

          <div>
            <div style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>How available time was worked out</div>
            For each person, each sprint: the working days in that sprint, multiplied by the share of their time this project holds, counted only for sprints they were actually on the team.
            Presence is detected from work logged inside the sprint or a ticket they completed in it. Current basis across the team: <strong style={{ color: '#e2e8f0' }}>{meta.allocBasisSummary}</strong>.
            Where a person's share of time could not be established at all, they are excluded from both sides of every rate rather than assumed to be full-time — assuming full-time inflates the denominator and makes the whole team look slower.
          </div>

          <div>
            <div style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>What the figures cannot see</div>
            <div style={{ display: 'grid', gap: 5, marginTop: 4 }}>
              <div>· <strong>Approved leave.</strong> There is no leave feed. Whole sprints away are picked up by presence detection; a week off inside a sprint is not, and reads as slower delivery.</div>
              <div>· <strong>Work that never carried points.</strong> Support, reviews, incidents, meetings and mentoring are invisible to a points-based rate. {M.unpointedMedian != null ? `Half the team logs ${pctI(M.unpointedMedian * 100)}% or more of their recorded hours outside their own completed pointed tickets.` : ''}</div>
              <div>· <strong>Difficulty.</strong> Points record agreed size, not how hard something turned out to be.</div>
              <div>· <strong>Choice of work.</strong> What each person was assigned was largely not theirs to decide.</div>
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Definitions used above</div>
            <div style={{ display: 'grid', gap: 5, marginTop: 4, color: '#94a3b8' }}>
              <div>· <em>Available person-day</em> — one working day of one person's time, already scaled to this project and to whether they were on the team.</div>
              <div>· <em>Typical</em> — the middle value across the set (the median), not the average, so a single outlier cannot move it.</div>
              <div>· <em>Cycle time</em> — working days from the first activity on a ticket to the moment it reached Done, taken from Jira change history. It is measured only on tickets that finished, so tickets that stalled and never completed are absent from it and it reads optimistically.</div>
              <div>· <em>Open</em> — a ticket sitting in an in-progress status. This counts what is on the board, not how many things someone is working on at once.</div>
              <div>· <em>Stalled</em> — an open ticket that has been open longer than {M.queue?.staleThreshold ?? 20} working days.</div>
            </div>
          </div>

          <div style={{ padding: '12px 15px', background: 'rgba(148,163,184,0.07)', border: '1px solid rgba(148,163,184,0.22)', borderRadius: 10 }}>
            <div style={{ fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>Why no individuals are named in this report</div>
            Available time is partly inferred rather than recorded, several people completed only a handful of pointed tickets in this window, and the ranges around each person's rate overlap almost everywhere — meaning most apparent differences between individuals cannot be told apart from noise. A named comparison at this level of certainty would be read as a verdict it cannot support, especially once it is separated from this page.
            <div style={{ marginTop: 8, color: '#e2e8f0', fontWeight: 600 }}>Contributor-level detail is available to line managers on request.</div>
          </div>
        </div>
      </Page>
    </div>
  );
}
