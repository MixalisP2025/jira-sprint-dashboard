import React from 'react';
import { f1, f2, pctI } from '../utils/teamEngine';

// Everything that gates the numbers but does not need to be read to use them.
// These checks still run on every render and still suppress outputs — they just do not
// occupy the working surface.

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '20px 22px', marginBottom: 14 };
const h = { fontSize: 14, fontWeight: 700, color: '#f1f5f9', marginBottom: 8 };
const body = { fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.7 };
const dim = { fontSize: 11.5, color: '#6b7280', lineHeight: 1.6 };
const mono = { fontFamily: 'ui-monospace, monospace', color: '#93c5fd' };

function Row({ label, value, note }) {
  return (
    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
      <td style={{ padding: '6px 14px 6px 0', fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>{label}</td>
      <td style={{ padding: '6px 14px 6px 0', fontSize: 12.5, color: '#e2e8f0', fontWeight: 600, whiteSpace: 'nowrap' }}>{value}</td>
      <td style={{ padding: '6px 0', fontSize: 11.5, color: '#6b7280' }}>{note}</td>
    </tr>
  );
}

export default function TeamMethodology({ M, meta }) {
  const T = M.team;
  const ll = M.littlesLaw;
  const tr = M.paceTrend;

  return (
    <div className="tt-print-root">
      <div className="tt-print-header">
        <div style={{ fontSize: 18, fontWeight: 800 }}>Team Contribution — methodology</div>
        <div style={{ fontSize: 12 }}>{meta.scopeLabel} · generated {meta.generatedAt}</div>
      </div>

      <div style={{ ...card, background: 'rgba(96,165,250,0.06)', borderColor: 'rgba(96,165,250,0.25)' }}>
        <div style={h}>Why this page exists</div>
        <div style={body}>
          Every check below runs on each render and gates what the panels are allowed to show — sprints get dropped, people get suppressed, claims get withheld. None of it needs to be read in order to use the numbers, so it lives here instead of on the working surface.
        </div>
      </div>

      {/* Rate derivation */}
      <div style={card}>
        <div style={h}>How the rate is derived</div>
        <div style={{ ...body, marginBottom: 10 }}>
          <div style={mono}>SP per available day = points completed by assessable people ÷ their available days</div>
          <div style={{ ...mono, marginTop: 4 }}>available days = Σ over sprints (working days × presence × allocation)</div>
        </div>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            <Row label="Points (numerator)" value={f1(T.assessableSP)} note={`from ${T.assessableTickets} completed pointed tickets, credited to whoever owned each ticket at completion`} />
            <Row label="Available days (denominator)" value={f1(T.totalAllocDays)} note={`${M.assessableCount} assessable contributors only — the same people on both sides`} />
            <Row label="Result" value={T.spPerDay != null ? f2(T.spPerDay) + ' SP/day' : '—'} note="the headline rate" />
            <Row label="Working days in window" value={T.workingDaysInWindow} note="both endpoints of each sprint counted; weekends and Greek public holidays removed" />
            <Row label="Everyone shown" value={`${f1(T.totalSP)} SP over ${f1(T.allContribDays)} days`} note="reported separately, never blended into the rate above" />
          </tbody>
        </table>
        {M.dayDerivation?.length > 0 && (
          <div style={{ marginTop: 12, overflowX: 'auto' }}>
            <div style={{ ...dim, marginBottom: 5 }}>Per-sprint working days, so the calendar can be checked by hand:</div>
            <table style={{ borderCollapse: 'collapse', fontSize: 11.5, minWidth: 420 }}>
              <thead><tr style={{ color: '#6b7280' }}>
                <th style={{ textAlign: 'left', padding: '4px 12px 4px 0' }}>Sprint</th>
                <th style={{ textAlign: 'left', padding: '4px 12px' }}>Dates (inclusive)</th>
                <th style={{ textAlign: 'right', padding: '4px 12px' }}>Working days</th>
                <th style={{ textAlign: 'left', padding: '4px 0 4px 12px' }}>Feeds the rates</th>
              </tr></thead>
              <tbody>
                {M.dayDerivation.map(d => (
                  <tr key={d.label} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding: '4px 12px 4px 0', color: '#e2e8f0' }}>{d.label}</td>
                    <td style={{ padding: '4px 12px', color: '#94a3b8' }}>{d.start?.toLocaleDateString?.('en-GB', { day: '2-digit', month: 'short' })} – {d.end?.toLocaleDateString?.('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td style={{ padding: '4px 12px', textAlign: 'right', color: '#e2e8f0' }}>{d.workingDays}</td>
                    <td style={{ padding: '4px 0 4px 12px', color: d.rated ? '#86efac' : '#fca5a5' }}>{d.rated ? 'yes' : 'no — pointing coverage'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pointing coverage gate */}
      {M.coverage && (
        <div style={card}>
          <div style={h}>Pointing-coverage gate</div>
          <div style={body}>
            A points-per-day rate only means something if the completed work carried points. Each sprint is measured for the share of its completed tickets that had a story point at all; below <strong>{pctI(M.coverage.threshold * 100)}%</strong> the sprint leaves every rate, on both sides of the ratio.
          </div>
          <div style={{ ...dim, marginTop: 8 }}>
            {M.coverage.excluded.length > 0
              ? <>Excluded: {M.coverage.excluded.map(e => `${e.label} (${e.pointed} of ${e.all} pointed, ${pctI(e.coverage * 100)}%)`).join('; ')}. Without this gate, a change in pointing practice reads as a change in delivery — which is exactly how a rate can appear to improve while nothing about the work changed.</>
              : 'Every sprint in this window cleared the threshold.'}
            {M.coverage.lowButIncluded.length > 0 && <> Included but partial: {M.coverage.lowButIncluded.map(e => `${e.label} at ${pctI(e.coverage * 100)}%`).join('; ')} — their rates understate delivery.</>}
          </div>
        </div>
      )}

      {/* Little's Law */}
      {ll && (
        <div style={card}>
          <div style={h}>Little's Law reconciliation</div>
          <div style={{ ...body, marginBottom: 8 }}>
            <span style={mono}>expected open work = throughput × cycle time</span> — if far more is open than the completion rate accounts for, the surplus is work that is open but not moving, and cycle time (which only ever sees tickets that finished) is a best case.
          </div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              <Row label="Throughput" value={`${f2(ll.throughputPerPersonDay)} tickets / person-day`} note={`${T.assessableTickets} tickets ÷ ${f1(T.totalAllocDays)} available days`} />
              <Row label="Cycle time" value={`${f1(T.cycleDaysMedian)} working days`} note="typical completed ticket, first activity to Done" />
              <Row label="Implied open per person" value={f2(ll.impliedWip)} note="throughput × cycle time" />
              <Row label="Observed open per person" value={f2(ll.observedWip)} note="tickets actually sitting in an in-progress status" />
              <Row label="Ratio" value={`${f2(ll.ratio)}×`} note={ll.breached ? `above the 2× threshold — roughly ${ll.stalledEstimate} tickets open but not moving` : 'within the expected range'} />
            </tbody>
          </table>
        </div>
      )}

      {/* Trend test */}
      {tr && (
        <div style={card}>
          <div style={h}>Trend test on the delivery rate</div>
          <div style={body}>
            {tr.testable
              ? <>Mann–Kendall, two-sided, over the {tr.n} sprints that survived the coverage gate. S={tr.S}, z={f2(tr.z)}, p={tr.pValue < 0.001 ? '<0.001' : tr.pValue.toFixed(3)}. {tr.trending
                  ? <>Below the 0.10 threshold, so a direction is reported: the rate is {tr.direction > 0 ? 'rising' : 'falling'}.</>
                  : <>Above the 0.10 threshold, so no direction is claimed anywhere in the reports. The window average is quoted instead.</>}</>
              : <>Only {tr.n} measured sprint(s) — too few to test, so no direction is claimed.</>}
            {tr.spread != null && Number.isFinite(tr.spread) && <> The highest sprint rate is {f1(tr.spread)}× the lowest, which is the reason a direction cannot simply be eyeballed from the chart.</>}
          </div>
        </div>
      )}

      {/* Suppression + intervals */}
      <div style={card}>
        <div style={h}>Suppression rules and confidence intervals</div>
        <div style={body}>
          A per-person rate is shown only when both hold: at least <strong>10</strong> completed pointed tickets, and an allocation that could be established rather than assumed. Anyone failing either test is left out of the numerator <em>and</em> the denominator — counting them on one side only would compare two different populations.
        </div>
        <div style={{ ...dim, marginTop: 8 }}>
          Intervals on the SP-per-available-day chart are 95% bootstrap intervals over each person's own ticket sizes, 2,000 resamples, percentile method. They are drawn as whiskers rather than printed in the table because the comparison they support is visual: where two people's whiskers overlap, the difference between them is not distinguishable from noise. At these sample sizes most of them do.
        </div>
        {M.suppressedNames?.length > 0 && (
          <div style={{ ...dim, marginTop: 8 }}>Currently suppressed: {M.suppressedNames.join(', ')}.</div>
        )}
      </div>

      {/* What it cannot see */}
      <div style={card}>
        <div style={h}>What none of this can see</div>
        <div style={{ ...body, display: 'grid', gap: 6 }}>
          <div>· <strong>Approved leave.</strong> There is no leave feed. Whole sprints away are caught by presence detection; a week off inside a sprint is not, and reads as slower delivery.</div>
          <div>· <strong>Work that never carried points.</strong> {M.unpointedMedian != null ? `Half the team logs ${pctI(M.unpointedMedian * 100)}% or more of their hours outside their own completed pointed tickets.` : 'Support, reviews, incidents and BAU are invisible to a points-based rate.'}</div>
          <div>· <strong>Difficulty.</strong> Points record agreed size, not how hard something turned out to be.</div>
          <div>· <strong>Choice of work.</strong> What each person was assigned was largely not theirs to decide, and it drives throughput more than anything they control.</div>
        </div>
        <div style={{ ...dim, marginTop: 10, paddingTop: 9, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          Taken together these are why the contributor table answers <em>what was delivered and what is stuck</em>, and not <em>who is performing well</em>. With this many contributors, this much unpointed work, and this few sprints clearing the coverage gate, a throughput ranking mostly ranks people by the kind of work they were handed.
        </div>
      </div>
    </div>
  );
}
