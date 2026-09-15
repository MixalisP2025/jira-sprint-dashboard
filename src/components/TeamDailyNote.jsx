import React, { useMemo, useState } from 'react';
import { Mail, Printer, CheckCircle2, PlayCircle, PauseCircle, Ban, Clock } from 'lucide-react';
import { f1, pctI } from '../utils/teamEngine';
import { STALL_DAYS_DEFAULT, AGING_DAYS } from '../utils/teamDaily';

// The operational read. Current sprint only, volume and status only.
// Nothing on this page is a rate, a comparison between people, or a trailing average —
// if a line is not something somebody can act on today, it does not belong here.

const STALL_CAP = 10;

const card = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '18px 20px', marginBottom: 14 };
const h = { fontSize: 13, fontWeight: 700, color: '#f1f5f9', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 7 };
const thL = { textAlign: 'left', padding: '5px 9px 5px 0', fontSize: 9.5, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' };
const tdL = { textAlign: 'left', padding: '5px 9px 5px 0', fontSize: 12.5, color: '#e2e8f0' };
const keyStyle = { ...tdL, fontFamily: 'ui-monospace, monospace', color: '#93c5fd', whiteSpace: 'nowrap' };
const btn = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#cbd5e1', display: 'inline-flex', alignItems: 'center', gap: 6 };

function Empty({ children }) {
  return <div style={{ fontSize: 12.5, color: '#86efac', padding: '4px 0' }}>{children}</div>;
}

function TicketRows({ rows, cols }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead><tr>{cols.map(c => <th key={c.label} style={{ ...thL, textAlign: c.align || 'left' }}>{c.label}</th>)}</tr></thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.key} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            {cols.map(c => <td key={c.label} style={{ ...(c.mono ? keyStyle : tdL), textAlign: c.align || 'left', color: c.color?.(r) || (c.mono ? '#93c5fd' : '#e2e8f0') }}>{c.render(r)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function TeamDailyNote({ note, projectLabel, onEmail, loading, error, stallDays = STALL_DAYS_DEFAULT, onStallDaysChange }) {
  const [showAllStalled, setShowAllStalled] = useState(false);

  const dateLine = useMemo(() => note.generatedAt.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: note.tz,
  }), [note.generatedAt, note.tz]);

  // Between sprints there is nothing to report on — an empty state, not a broken page.
  if (!note.sprint) {
    return (
      <div className="tt-print-root">
        <div style={card}>
          <div style={{ textAlign: 'center', padding: '30px 16px' }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 }}>No sprint is running for {projectLabel}</div>
            <div style={{ fontSize: 12.5, color: '#94a3b8', maxWidth: 460, margin: '0 auto', lineHeight: 1.65 }}>
              This note covers the sprint in flight, so there is nothing to report between sprints. It will fill in as soon as the next one starts.
              {note.aging.count > 0 && <> In the meantime, <strong style={{ color: '#cbd5e1' }}>{note.aging.count} tickets</strong> have been open more than {AGING_DAYS} working days — the list is on the Queue tab.</>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const s = note.standing;
  const sp = note.sprint;
  const ahead = s.pctDone != null && s.pctElapsed != null && s.pctDone >= s.pctElapsed;
  const stalledShown = showAllStalled ? note.stalled : note.stalled.slice(0, STALL_CAP);

  return (
    <div className="tt-print-root">
      <div className="tt-no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
        <button onClick={onEmail} style={{ ...btn, background: 'rgba(37,99,235,0.2)', borderColor: 'rgba(96,165,250,0.5)', color: '#bfdbfe' }}><Mail size={13} /> Email this note</button>
        <button onClick={() => window.print()} style={btn}><Printer size={13} /> Print</button>
      </div>

      {/* 1. Header */}
      <div style={{ ...card, borderBottom: '3px solid rgba(255,255,255,0.15)' }}>
        <div style={{ fontSize: 19, fontWeight: 800, color: '#f1f5f9' }}>
          {sp.name.replace(/\s+\d{2}-\d{2}-\d{2}\s+to\s+\d{2}-\d{2}-\d{2}/, '')}
          <span style={{ fontSize: 13, fontWeight: 500, color: '#94a3b8', marginLeft: 10 }}>
            {sp.finished ? 'sprint has ended' : `day ${sp.dayOfSprint} of ${sp.totalDays}`} · generated {dateLine}
          </span>
        </div>
        <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 3 }}>{projectLabel} · current sprint only — no trailing averages, no per-person rates · days counted in {note.tz}{loading ? ' · still loading activity data' : ''}</div>
        {error && <div style={{ fontSize: 11.5, color: '#fca5a5', marginTop: 4 }}>Activity data failed to load ({error}) — "moved", "not moving" and "blocked" fall back to the Updated field and will be coarser than usual.</div>}
      </div>

      {/* 2. Where the sprint stands */}
      <div style={card}>
        <div style={h}>Where the sprint stands</div>
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Committed</div>
            <div style={{ fontSize: 21, fontWeight: 700, color: '#e2e8f0' }}>{f1(s.committedSP)} <span style={{ fontSize: 12, fontWeight: 400, color: '#94a3b8' }}>points · {s.committedTickets} tickets</span></div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Done</div>
            <div style={{ fontSize: 21, fontWeight: 700, color: '#86efac' }}>{f1(s.doneSP)} <span style={{ fontSize: 12, fontWeight: 400, color: '#94a3b8' }}>points · {s.doneTickets} tickets</span></div>
          </div>
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 26, display: 'flex', gap: 26 }}>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Sprint elapsed</div>
              <div style={{ fontSize: 21, fontWeight: 700, color: '#cbd5e1' }}>{s.pctElapsed != null ? pctI(s.pctElapsed * 100) + '%' : '—'}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>Points done</div>
              <div style={{ fontSize: 21, fontWeight: 700, color: ahead ? '#22c55e' : '#fbbf24' }}>{s.pctDone != null ? pctI(s.pctDone * 100) + '%' : '—'}</div>
            </div>
          </div>
        </div>
        {s.projectedSP != null && (
          <div style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.07)', lineHeight: 1.6 }}>
            At the rate this sprint has actually run, it finishes at <strong style={{ color: s.projectedSP >= s.committedSP ? '#86efac' : '#fbbf24' }}>~{f1(s.projectedSP)} points</strong> against {f1(s.committedSP)} committed
            {s.projectedSP < s.committedSP && <> — about <strong>{f1(s.committedSP - s.projectedSP)} points short</strong></>}.
          </div>
        )}
      </div>

      {/* 3. Moved in the last working day */}
      <div style={card}>
        {/* moved.on is UTC midnight of a civil day, so it must be formatted in UTC —
            formatting in the browser's zone would slide it back a day west of Greenwich. */}
        <div style={h}>Moved on {note.moved.on.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', timeZone: 'UTC' })}</div>
        {note.moved.done.length === 0 && note.moved.started.length === 0 ? (
          <div style={{ fontSize: 12.5, color: '#fbbf24', padding: '4px 0', lineHeight: 1.6 }}>
            <strong>Nothing moved.</strong> No ticket reached Done and none was started. If that is unexpected, it is the first thing to ask about today.
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            {note.moved.done.length > 0 && (
              <div>
                <div style={{ fontSize: 11.5, color: '#86efac', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}><CheckCircle2 size={13} /> Reached Done ({note.moved.done.length})</div>
                <TicketRows rows={note.moved.done} cols={[
                  { label: 'Key', mono: true, render: r => r.key },
                  { label: 'Summary', render: r => r.summary },
                  { label: 'Assignee', render: r => r.assignee },
                ]} />
              </div>
            )}
            {note.moved.started.length > 0 && (
              <div>
                <div style={{ fontSize: 11.5, color: '#93c5fd', fontWeight: 600, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}><PlayCircle size={13} /> Started ({note.moved.started.length})</div>
                <TicketRows rows={note.moved.started} cols={[
                  { label: 'Key', mono: true, render: r => r.key },
                  { label: 'Summary', render: r => r.summary },
                  { label: 'Assignee', render: r => r.assignee },
                ]} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4. Not moving */}
      <div style={card}>
        <div style={{ ...h, justifyContent: 'space-between' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><PauseCircle size={14} style={{ color: '#fbbf24' }} /> Not moving — no activity in {stallDays}+ working days</span>
          <label className="tt-no-print" style={{ fontSize: 11, fontWeight: 400, color: '#6b7280', display: 'inline-flex', alignItems: 'center', gap: 6 }} title="Absence of a worklog is weak evidence when logging is patchy. If this list fills with work that is plainly moving, raise the threshold.">
            threshold
            <select value={stallDays} onChange={e => onStallDaysChange?.(parseInt(e.target.value, 10))} style={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, color: '#e2e8f0', padding: '3px 6px', fontSize: 11 }}>
              {[2, 3, 5, 7, 10].map(d => <option key={d} value={d}>{d} days</option>)}
            </select>
          </label>
        </div>
        {note.stalled.length === 0 ? <Empty>Everything in progress has been touched in the last {stallDays} working days.</Empty> : (
          <>
            <TicketRows rows={stalledShown} cols={[
              { label: 'Days', align: 'right', render: r => f1(r.daysSince), color: r => (r.daysSince >= 10 ? '#f87171' : '#fbbf24') },
              { label: 'Key', mono: true, render: r => r.key },
              { label: 'Summary', render: r => r.summary },
              { label: 'Assignee', render: r => r.assignee },
              { label: 'Status', render: r => r.status, color: () => '#94a3b8' },
            ]} />
            {note.stalled.length > STALL_CAP && (
              <button onClick={() => setShowAllStalled(v => !v)} className="tt-no-print" style={{ ...btn, marginTop: 9, fontSize: 11.5 }}>
                {showAllStalled ? 'Show fewer' : `and ${note.stalled.length - STALL_CAP} more`}
              </button>
            )}
          </>
        )}
      </div>

      {/* 5. Blocked */}
      <div style={card}>
        <div style={h}><Ban size={14} style={{ color: '#f87171' }} /> Blocked</div>
        {note.blocked.length === 0 ? <Empty>Nothing is sitting in a blocked status.</Empty> : (
          <TicketRows rows={note.blocked} cols={[
            { label: 'Days blocked', align: 'right', render: r => (r.daysBlocked != null ? f1(r.daysBlocked) : '—'), color: () => '#f87171' },
            { label: 'Key', mono: true, render: r => r.key },
            { label: 'Summary', render: r => r.summary },
            { label: 'Last touched by', render: r => r.lastTouchedBy, color: () => '#94a3b8' },
          ]} />
        )}
      </div>

      {/* 6. Aging — trend only, the review is a separate session */}
      <div style={{ ...card, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <Clock size={15} style={{ color: '#fb923c', flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.6 }}>
          <strong>{note.aging.count} tickets have been open more than {AGING_DAYS} working days</strong>
          {note.aging.delta != null && (note.aging.delta === 0
            ? <> — unchanged since the last note.</>
            : <> — {note.aging.delta > 0 ? 'up' : 'down'} {Math.abs(note.aging.delta)} since the last note (was {note.aging.prev}).</>)}
          {!note.aging.hasBaseline && <> — <span style={{ color: '#94a3b8' }}>no comparison yet</span>; this is the first note, so there is no earlier figure to measure against.</>}
          <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 3 }}>The list is on the Queue tab. This line flags the direction; working through it is a separate session, not a daily task.</div>
          {note.unassigned.changed && (
            <div style={{ marginTop: 7, color: '#7dd3fc' }}>
              Unassigned queue: <strong>{note.unassigned.count}</strong> tickets in progress with nobody on them ({note.unassigned.count > note.unassigned.prev ? '+' : '−'}{Math.abs(note.unassigned.count - note.unassigned.prev)} since the last note).
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
