import React, { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle, Award, CheckCircle2, HelpCircle, EyeOff } from 'lucide-react';
import { f1, f2, pctI } from '../utils/teamEngine';
import { buildOverview } from '../utils/teamOverview';

// The default view of the Team tab. Answers three questions in order:
//   1. How are the sprints behaving?
//   2. Is the team getting better or worse?
//   3. Who is doing exceptional work, and who needs a hand?
// Every number here also exists in the Analyst panel — this view chooses which ones
// matter and says what they mean. Nothing is computed here that is not computed there.
//
// Charting note: all bars are a SINGLE hue. Colour is never used to rank a person,
// because bar length already encodes the rate and a second encoding of the same thing
// reads as a verdict. Status colour appears only on labelled chips, never on a bar.

const INK = { primary: '#f1f5f9', body: '#cbd5e1', muted: '#94a3b8', faint: '#6b7280' };
const BAR = '#60a5fa';          // the one data hue
const RULE = 'rgba(255,255,255,0.07)';
const STATUS = {
  good: { color: '#22c55e', label: 'Standing out', Icon: Award },
  warn: { color: '#f59e0b', label: 'Worth a conversation', Icon: AlertTriangle },
  hidden: { color: '#a855f7', label: "Their work isn't visible here", Icon: EyeOff },
  calm: { color: '#64748b', label: 'Steady', Icon: CheckCircle2 },
  none: { color: '#475569', label: 'Not enough data to say', Icon: HelpCircle },
};
const MAX_CARDS = 6;   // a list longer than this stops being a list of actions

function Card({ children, style = {} }) {
  return <div className="tt-print-card" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '22px 24px', marginBottom: 16, ...style }}>{children}</div>;
}
function Q({ children, sub }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 16.5, fontWeight: 700, color: INK.primary }}>{children}</div>
      {sub && <div style={{ fontSize: 12.5, color: INK.faint, marginTop: 5, lineHeight: 1.55, maxWidth: 760 }}>{sub}</div>}
    </div>
  );
}
function Verdict({ tone = 'calm', children }) {
  const c = STATUS[tone];
  return (
    <div style={{ display: 'flex', gap: 11, alignItems: 'flex-start', background: `${c.color}12`, border: `1px solid ${c.color}38`, borderRadius: 10, padding: '13px 15px', marginBottom: 18 }}>
      <c.Icon size={17} style={{ color: c.color, flexShrink: 0, marginTop: 1 }} />
      <div style={{ fontSize: 13.5, color: '#e2e8f0', lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

// ─── How are sprints behaving? ────────────────────────────────────────────────
function SprintBehaviour({ O, staleThreshold }) {
  const maxSP = Math.max(1, ...O.sprints.map(s => s.sp || 0));
  const anyExcluded = O.sprints.some(s => !s.rated);

  return (
    <Card>
      <Q sub="One row per completed sprint, oldest first. The bar is points delivered; everything else is how that delivery went.">
        How are the sprints behaving?
      </Q>

      {O.typicalSP != null && (
        <Verdict tone={O.swing && O.swing.hi > O.swing.lo * 2 ? 'warn' : 'calm'}>
          A typical sprint delivers <strong>{f1(O.typicalSP)} points</strong>
          {O.swing && <> — though sprints ranged from <strong>{f1(O.swing.lo)}</strong> to <strong>{f1(O.swing.hi)}</strong>
            {O.swing.hi > O.swing.lo * 2 ? ', which is a wide enough swing that planning to the average will overshoot half the time' : ', a reasonably tight band'}</>}.
        </Verdict>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
          <thead>
            <tr style={{ fontSize: 10, color: INK.faint, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <th style={{ textAlign: 'left', padding: '0 10px 8px 0', fontWeight: 600 }}>Sprint</th>
              <th style={{ textAlign: 'left', padding: '0 10px 8px', fontWeight: 600, width: '38%' }}>Points delivered</th>
              <th style={{ textAlign: 'right', padding: '0 10px 8px', fontWeight: 600 }}>vs before</th>
              <th style={{ textAlign: 'right', padding: '0 10px 8px', fontWeight: 600 }}>Tickets</th>
              <th style={{ textAlign: 'right', padding: '0 10px 8px', fontWeight: 600 }}>Typical ticket</th>
              <th style={{ textAlign: 'right', padding: '0 0 8px 10px', fontWeight: 600 }}>Stuck</th>
            </tr>
          </thead>
          <tbody>
            {O.sprints.map(s => (
              <tr key={s.name} style={{ borderTop: `1px solid ${RULE}` }}>
                <td style={{ padding: '9px 10px 9px 0', fontSize: 12.5, color: INK.primary, fontWeight: 600, whiteSpace: 'nowrap' }}>
                  {s.label}
                  {!s.rated && <div style={{ fontSize: 10.5, color: '#fbbf24', fontWeight: 400, marginTop: 2 }}>not measured</div>}
                </td>
                <td style={{ padding: '9px 10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <div style={{ flex: 1, minWidth: 60, height: 9, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${((s.sp || 0) / maxSP) * 100}%`, height: '100%', background: BAR, opacity: s.rated ? 1 : 0.35, borderRadius: '0 4px 4px 0' }} />
                    </div>
                    <span style={{ fontSize: 12.5, color: INK.primary, fontWeight: 600, fontVariantNumeric: 'tabular-nums', minWidth: 34, textAlign: 'right' }}>{f1(s.sp)}</span>
                  </div>
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                  {s.deltaSP == null ? <span style={{ color: INK.faint }}>—</span> : (
                    <span style={{ color: Math.abs(s.deltaSP) < 0.1 ? INK.muted : s.deltaSP > 0 ? '#86efac' : '#fca5a5' }}>
                      {s.deltaSP > 0 ? '+' : ''}{pctI(s.deltaSP * 100)}%
                    </span>
                  )}
                </td>
                <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12.5, color: INK.muted, fontVariantNumeric: 'tabular-nums' }}>{s.tickets}</td>
                <td style={{ padding: '9px 10px', textAlign: 'right', fontSize: 12.5, color: INK.muted, fontVariantNumeric: 'tabular-nums' }}>
                  {s.medianCycle != null ? `${f1(s.medianCycle)} days` : '—'}
                </td>
                <td style={{ padding: '9px 0 9px 10px', textAlign: 'right', fontSize: 12.5, fontVariantNumeric: 'tabular-nums', color: s.stale > 0 ? '#fca5a5' : INK.muted }}>{s.stale}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontSize: 11.5, color: INK.faint, marginTop: 12, lineHeight: 1.6 }}>
        <strong style={{ color: INK.muted }}>Typical ticket</strong> is the median working days from first move off the backlog to done.
        {' '}<strong style={{ color: INK.muted }}>Stuck</strong> counts tickets open longer than {staleThreshold} working days during that sprint.
        {anyExcluded && <> Sprints marked <span style={{ color: '#fbbf24' }}>not measured</span> had too few completed tickets carrying story points for a rate to mean anything — the delivery was real, the measurement is not.</>}
      </div>
    </Card>
  );
}

// ─── Is the team getting better or worse? ─────────────────────────────────────
function TeamProgress({ M, O, windowN }) {
  const tr = M.paceTrend;
  const team = M.team;
  const tone = tr?.trending ? (tr.direction > 0 ? 'good' : 'warn') : 'calm';
  const Icon = tr?.trending ? (tr.direction > 0 ? TrendingUp : TrendingDown) : Minus;
  const shortfall = O.sprintCount - O.measuredCount;

  const stats = [
    { label: 'Points per available person-day', value: team.spPerDay != null ? f2(team.spPerDay) : '—', note: 'the number to plan the next sprint with' },
    { label: 'Typical time to finish a ticket', value: team.cycleDaysMedian != null ? `${f1(team.cycleDaysMedian)} days` : '—', note: 'from first move off the backlog to done' },
    { label: 'Tickets open at once, per person', value: team.openWipMedian != null ? f1(team.openWipMedian) : '—', note: 'more than ~3 usually slows everything down' },
    { label: 'Work stuck right now', value: M.queue.stale, note: `of ${M.queue.open} open · older than ${M.queue.staleThreshold} working days` },
  ];

  return (
    <Card>
      <Q sub={`Comparing the ${windowN} completed sprints in the window against each other.`}>
        Is the team getting better or worse?
      </Q>

      <Verdict tone={tone}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <Icon size={15} style={{ color: STATUS[tone].color }} />
          {tr?.trending
            ? <span>Delivery is <strong>{tr.direction > 0 ? 'improving' : 'declining'}</strong> across the window — the sprint-by-sprint rate moves consistently in one direction, not just up and down.</span>
            : tr?.testable
              ? <span>Delivery <strong>varies sprint to sprint with no reliable direction</strong>. Plan against the window average, not against the last sprint — the last sprint is as likely to be a high point as a signal.</span>
              : <span>
                <strong>Can't yet say whether the team is trending</strong> — only {O.measuredCount} of the {O.sprintCount} sprints in the window could be measured
                {shortfall > 0 && <>, because the other {shortfall} had too little of their completed work carrying story points</>}. Four measured sprints are needed before a direction means anything. Judge on the sprint rows above for now.
              </span>}
        </span>
      </Verdict>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {stats.map(s => (
          <div key={s.label} style={{ flex: '1 1 180px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '14px 16px' }}>
            <div style={{ fontSize: 11.5, color: INK.faint, marginBottom: 7, lineHeight: 1.4 }}>{s.label}</div>
            <div style={{ fontSize: 25, fontWeight: 700, color: INK.primary, lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 10.5, color: INK.faint, marginTop: 6, lineHeight: 1.5 }}>{s.note}</div>
          </div>
        ))}
      </div>

      {team.loggingCompleteness != null && team.loggingCompleteness < 0.75 && (
        <div style={{ fontSize: 12, color: '#fcd34d', marginTop: 14, lineHeight: 1.6 }}>
          ⚠ {pctI(team.loggingCompleteness * 100) < 1
            ? <>Essentially <strong>no time is being logged in Jira</strong> for this scope.</>
            : <>Only <strong>{pctI(team.loggingCompleteness * 100)}%</strong> of available hours are logged in Jira.</>}
          {' '}Everything above is built on completed tickets and calendar days, so it stands — but do not read any <em>hours</em> figure in this dashboard as real effort.
        </div>
      )}
    </Card>
  );
}

// ─── The ranking ──────────────────────────────────────────────────────────────
function Ranking({ O, rateMedian }) {
  if (!O.ranked.length) return null;
  const max = Math.max(...O.ranked.map(r => Number.isFinite(r.hi) ? r.hi : r.rate), rateMedian || 0) * 1.05;
  const pct = v => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const SEP_LABEL = {
    above: { text: 'clearly above typical', color: '#86efac' },
    below: { text: 'clearly below typical', color: '#fcd34d' },
    typical: { text: 'not distinguishable from typical', color: INK.faint },
    unknown: { text: 'range unknown', color: INK.faint },
  };

  return (
    <>
      <div style={{ fontSize: 11, color: INK.faint, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 12 }}>
        Delivery rate, highest first
      </div>

      <div style={{ display: 'grid', gap: 3 }}>
        {O.ranked.map((r, i) => {
          const sep = SEP_LABEL[r.separation];
          return (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderTop: i === 0 ? 'none' : `1px solid ${RULE}` }}>
              <div style={{ width: 18, fontSize: 11.5, color: INK.faint, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{i + 1}</div>
              <div style={{ width: 130, fontSize: 12.5, color: INK.primary, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>{r.name}</div>

              {/* bar + uncertainty whisker, one hue, team median as the reference rule */}
              <div style={{ flex: 1, minWidth: 120, position: 'relative', height: 20 }}>
                <div style={{ position: 'absolute', inset: '5px 0 auto 0', height: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 3 }} />
                <div style={{ position: 'absolute', top: 5, left: 0, width: pct(r.rate), height: 10, background: BAR, opacity: r.rateMisleading ? 0.35 : 0.9, borderRadius: '0 4px 4px 0' }} />
                {Number.isFinite(r.lo) && Number.isFinite(r.hi) && (
                  <div style={{ position: 'absolute', top: 9, left: pct(r.lo), width: `calc(${pct(r.hi)} - ${pct(r.lo)})`, height: 2, background: 'rgba(226,232,240,0.55)' }} />
                )}
                {rateMedian > 0 && (
                  <div style={{ position: 'absolute', top: 1, left: pct(rateMedian), width: 1, height: 18, background: 'rgba(226,232,240,0.45)' }} title={`team typical ${f2(rateMedian)}`} />
                )}
              </div>

              <div style={{ width: 44, fontSize: 12.5, color: INK.primary, fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{f2(r.rate)}</div>
              <div style={{ width: 190, fontSize: 11, textAlign: 'right', lineHeight: 1.4 }}>
                <div style={{ color: sep.color }}>{sep.text}</div>
                {r.rateMisleading && <div style={{ color: '#fcd34d' }}>understates their real work</div>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 11.5, color: INK.faint, marginTop: 14, lineHeight: 1.65, background: 'rgba(255,255,255,0.02)', border: `1px solid ${RULE}`, borderRadius: 8, padding: '11px 13px' }}>
        <strong style={{ color: INK.muted }}>Read this ordering with care.</strong> The thin line through each bar is the range the person's true rate could plausibly sit in, and the vertical rule is the team's typical rate.
        {' '}Only <strong style={{ color: INK.body }}>{O.distinguishable} of {O.ranked.length}</strong> people sit clearly to one side of it — for everyone else the ranking is real but the gaps are not, and shuffling those rows would fit the data equally well.
        {' '}Rate also depends on ticket size, on allocation (partly inferred), and on how much of someone's work carries a story point at all. <strong style={{ color: INK.body }}>The signals below are the part worth acting on.</strong>
      </div>
    </>
  );
}

// ─── The signals ──────────────────────────────────────────────────────────────
function PersonCard({ p, tone }) {
  const c = STATUS[tone];
  return (
    <div style={{ border: `1px solid ${RULE}`, borderLeft: `3px solid ${c.color}`, borderRadius: 9, padding: '13px 15px', background: 'rgba(255,255,255,0.02)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: p.strengths.length || p.concerns.length ? 9 : 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: INK.primary }}>{p.name}</div>
        <div style={{ fontSize: 11, color: INK.faint, fontVariantNumeric: 'tabular-nums' }}>
          {p.row.tickets} tickets · {f1(p.row.sp)} points
          {p.row.suppressed && <span style={{ color: '#94a3b8' }}> · {p.row.suppressReason}</span>}
        </div>
      </div>

      {[...p.concerns, ...p.visibility].map((c2, i) => (
        <div key={`c${i}`} style={{ marginBottom: 9 }}>
          <div style={{ fontSize: 12.5, color: INK.body, lineHeight: 1.6 }}>{c2.text}</div>
          <div style={{ fontSize: 12, color: '#fcd34d', marginTop: 4, lineHeight: 1.5 }}>Ask: {c2.ask}</div>
        </div>
      ))}
      {p.strengths.map((s, i) => (
        <div key={`s${i}`} style={{ fontSize: 12.5, color: INK.body, lineHeight: 1.6, marginBottom: 7 }}>{s.text}</div>
      ))}
    </div>
  );
}

function Group({ tone, people, blurb, collapse = false }) {
  const [expanded, setExpanded] = useState(false);
  if (!people.length) return null;
  const c = STATUS[tone];
  const capped = collapse && !expanded && people.length > MAX_CARDS;
  const shown = capped ? people.slice(0, MAX_CARDS) : people;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <c.Icon size={14} style={{ color: c.color }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: c.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</span>
        <span style={{ fontSize: 11.5, color: INK.faint }}>({people.length})</span>
      </div>
      {blurb && <div style={{ fontSize: 11.5, color: INK.faint, marginBottom: 10, lineHeight: 1.55, maxWidth: 720 }}>{blurb}</div>}
      <div style={{ display: 'grid', gap: 9 }}>
        {shown.map(p => <PersonCard key={p.name} p={p} tone={tone} />)}
      </div>
      {collapse && people.length > MAX_CARDS && (
        <button className="tt-no-print" onClick={() => setExpanded(v => !v)}
          style={{ background: 'none', border: 'none', padding: '9px 0 0', font: 'inherit', fontSize: 11.5, color: '#93c5fd', textDecoration: 'underline', cursor: 'pointer' }}>
          {expanded ? 'Show only the most serious' : `Show the other ${people.length - MAX_CARDS} — sorted most serious first`}
        </button>
      )}
    </div>
  );
}

// Names only — a compact list for the groups that need no per-person detail.
function NameList({ tone, people, blurb }) {
  if (!people.length) return null;
  const c = STATUS[tone];
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <c.Icon size={14} style={{ color: c.color }} />
        <span style={{ fontSize: 11.5, fontWeight: 700, color: c.color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.label}</span>
        <span style={{ fontSize: 11.5, color: INK.faint }}>({people.length})</span>
      </div>
      {blurb && <div style={{ fontSize: 11.5, color: INK.faint, marginBottom: 8, lineHeight: 1.55, maxWidth: 720 }}>{blurb}</div>}
      <div style={{ fontSize: 12.5, color: INK.body, lineHeight: 1.7 }}>
        {people.map((p, i) => (
          <span key={p.name}>
            {p.name}
            <span style={{ color: INK.faint }}> ({p.row.suppressed ? p.row.suppressReason : `${p.row.tickets} tickets`})</span>
            {i < people.length - 1 ? ' · ' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function TeamOverview({ M, windowN, projectLabel, scopeLabel, onView }) {
  const O = useMemo(() => buildOverview(M), [M]);
  const [showRanking, setShowRanking] = useState(true);

  const link = (label, key) => (
    <button onClick={() => onView(key)} className="tt-no-print"
      style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: '#93c5fd', textDecoration: 'underline', cursor: 'pointer' }}>
      {label}
    </button>
  );

  return (
    <div className="tt-print-root">
      <div className="tt-print-header">
        <div style={{ fontSize: 18, fontWeight: 800 }}>Team overview — {projectLabel}</div>
        <div style={{ fontSize: 12 }}>{scopeLabel} · generated {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
      </div>

      <SprintBehaviour O={O} staleThreshold={M.queue.staleThreshold} />

      <TeamProgress M={M} O={O} windowN={windowN} />

      <Card>
        <Q sub="The ordering tells you the shape of the team. The signals underneath tell you what to actually do about it.">
          Who is doing exceptional work, and who needs a hand?
        </Q>

        <div className="tt-no-print" style={{ marginBottom: 14 }}>
          <button onClick={() => setShowRanking(v => !v)}
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '5px 11px', cursor: 'pointer', fontSize: 11.5, color: INK.muted }}>
            {showRanking ? 'Hide the ranking' : 'Show the ranking'}
          </button>
        </div>
        {showRanking && (
          <div style={{ marginBottom: 24 }}>
            <Ranking O={O} rateMedian={M.team.spPerDayMedian} />
          </div>
        )}

        <Group
          tone="warn"
          collapse
          people={O.groups.attention}
          blurb="A signal fired for each of these people, most serious first. Every one is about the work — where it sat, why it came back, what it was waiting on — and each comes with the question worth asking. None of them is a judgement about the person, and percentage signals only fire once someone has enough completed tickets to quote one."
        />
        <Group
          tone="good"
          people={O.groups.standout}
          blurb="Consistently strong on something specific and measurable, with nothing pulling the other way."
        />
        <Group
          tone="hidden"
          collapse
          people={O.groups.invisible}
          blurb="Nothing is wrong with their work — this view simply cannot see most of it, because it is not landing as pointed tickets. Read their position in the ranking above as a measurement gap, not as output. Fixing this is a ticketing decision, not a conversation about performance."
        />
        <NameList
          tone="calm"
          people={O.groups.steady}
          blurb="Nothing fired in either direction. In a healthy team this is the largest group, and that is a good sign rather than a gap."
        />
        <NameList
          tone="none"
          people={O.groups.unknown}
          blurb="Under 10 completed pointed tickets in the window, or no allocation this view can establish. Any rate for them would be noise — they are named here rather than being silently ranked last."
        />

        <div style={{ fontSize: 11.5, color: INK.faint, marginTop: 6, lineHeight: 1.65 }}>
          Full per-person numbers are on the {link('Analyst panel', 'analyst')}; the working list of stuck tickets is on the {link('Queue', 'queue')}; how every figure is derived is on {link('Methodology', 'method')}.
        </div>
      </Card>
    </div>
  );
}
