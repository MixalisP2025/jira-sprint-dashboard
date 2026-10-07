import React, { useMemo, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, AlertCircle, CheckCircle, Clock, Loader2, TrendingUp, Lightbulb, FileText } from 'lucide-react';
import { useChangelogs } from '../hooks/useChangelogs';
import { getKey, getStatus, getAssignee, getProject, isDone, shortSprint, f1 } from '../utils/teamEngine';
import {
  sprintCalendar, currentSprint, sprintLedger, staleTickets, paceVerdict, compareSprints,
  suggestions, sprintHistory, hasSprintHistory, reviewContext, canonSprint, latestRowPerIssue, STALE_WORKING_DAYS,
} from '../utils/sprintReview';
import { HEALTH, HEALTH_LABEL } from '../utils/projectPortfolio';
import { HEALTH_STYLE, describeProject } from '../utils/projectReport';
import { JIRA_CONFIG } from '../config/jiraConfig';
import { buildManagementSynopsis } from '../utils/sprintReviewReport';
import SprintSummaryModal from './SprintSummaryModal';

// One page per sprint: where we are, what is falling behind, what is stuck, and whether
// we are improving. Team-level throughout — tickets show their assignee so you know who
// to ask, but nobody is ranked; see ExecutiveSummaryView for why.

const JIRA_BASE = 'https://advancedinformationservices.atlassian.net';

const SEVERITY_STYLE = {
  adverse:    { border: 'border-red-400',     bg: 'bg-red-50',     text: 'text-red-800',     label: 'Needs action' },
  neutral:    { border: 'border-amber-400',   bg: 'bg-amber-50',   text: 'text-amber-800',   label: 'For awareness' },
  reassuring: { border: 'border-emerald-400', bg: 'bg-emerald-50', text: 'text-emerald-800', label: 'No action needed' },
};

// Sprint boundaries are stored in UTC; local time would push a 23:59Z end into the next day.
const fmtDate = d => (d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' }) : '–');
const pct = v => (Number.isFinite(v) ? `${Math.round(v)}%` : '–');

function Card({ title, subtitle, children, right }) {
  return (
    // text-slate-900 as the base: the dashboard body text is light (dark theme), and
    // anything inside the card without its own colour was white on white.
    <div className="bg-white text-slate-900 rounded-xl p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, tone = 'text-slate-900' }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function Trend({ t, fmt = v => f1(v) }) {
  if (!t) return <span className="text-slate-400 text-xs">–</span>;
  const Icon = t.direction === 'up' ? ArrowUp : t.direction === 'down' ? ArrowDown : ArrowRight;
  const tone = t.good === true ? 'text-emerald-600' : t.good === false ? 'text-red-600' : 'text-slate-500';
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${tone}`} title={`Average of the earlier sprints: ${fmt(t.avg)}`}>
      <Icon className="w-3.5 h-3.5" /> vs {fmt(t.avg)}
    </span>
  );
}

function ProgressBar({ ledger }) {
  const total = ledger.sp > 0 ? ledger.sp : ledger.items;
  if (!total) return null;
  const useSP = ledger.sp > 0;
  const seg = [
    { k: 'Done',         v: useSP ? ledger.doneSP : ledger.doneItems,             c: 'bg-emerald-500' },
    { k: 'Awaiting',     v: useSP ? ledger.awaitingSP : ledger.awaitingItems,     c: 'bg-emerald-300' },
    { k: 'In progress',  v: useSP ? ledger.inProgressSP : ledger.inProgressItems, c: 'bg-blue-400' },
    { k: 'To do',        v: useSP ? ledger.todoSP : ledger.todoItems,             c: 'bg-slate-300' },
    { k: 'Carried out',  v: useSP ? ledger.carriedOutSP : ledger.carriedOutItems, c: 'bg-amber-400' },
  ];
  return (
    <div>
      <div className="flex h-4 rounded overflow-hidden bg-slate-100">
        {seg.map(s => s.v > 0 && <div key={s.k} className={s.c} style={{ width: `${(s.v / total) * 100}%` }} title={`${s.k}: ${f1(s.v)} ${useSP ? 'SP' : 'items'}`} />)}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-600">
        {seg.map(s => (
          <span key={s.k} className="inline-flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-sm ${s.c}`} />{s.k} {f1(s.v)} {useSP ? 'SP' : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function SprintReviewTab({ tickets = [], selectedSprint, selectedProject = 'all', selectedAssignee = 'all', excludedAssignees = [], portfolio = [] }) {
  const now = useMemo(() => new Date(), []);

  const rows = useMemo(() => latestRowPerIssue(tickets).filter(t =>
    !excludedAssignees.includes(getAssignee(t))
    && (selectedProject === 'all' || getProject(t) === selectedProject)
    && (selectedAssignee === 'all' || getAssignee(t) === selectedAssignee)
  ), [tickets, excludedAssignees, selectedProject, selectedAssignee]);

  const calendar = useMemo(() => sprintCalendar(rows), [rows]);
  const explicit = calendar.some(s => canonSprint(s.name) === canonSprint(selectedSprint));
  const sprintName = explicit ? selectedSprint : currentSprint(calendar, now);
  const sprintInfo = calendar.find(s => canonSprint(s.name) === canonSprint(sprintName));

  // From the sprint field alone: enough to pick which tickets need change history.
  const baseLedger = useMemo(() => (sprintName ? sprintLedger(rows, sprintName, sprintInfo) : null), [rows, sprintName, sprintInfo]);

  // Change history for the tickets this page reads: open work in the sprint (time in
  // status) and finished work across the comparison window (cycle time).
  const historyKeys = useMemo(() => {
    if (!baseLedger) return [];
    const windowNames = new Set(compareSprints(rows, calendar, sprintName, null).sprints.map(s => s.sprint));
    const keys = rows.filter(t => {
      const last = sprintHistory(t).at(-1)?.name;
      if (last === sprintName && !isDone(getStatus(t))) return true;
      return isDone(getStatus(t)) && windowNames.has(last);
    }).map(getKey).filter(Boolean);
    return keys;
  }, [rows, calendar, sprintName, baseLedger]);

  const history = useChangelogs(historyKeys);

  const clMap = history.status === 'loaded' ? history.byKey : null;
  // Sprint change history shows carry-over that the sprint field has lost (work moved on
  // before a sprint closed). Without either, carry-over and mid-sprint additions are unknown.
  const hasHistory = useMemo(() => hasSprintHistory(rows, clMap), [rows, clMap]);
  const ctx = useMemo(() => reviewContext(rows, clMap, now), [rows, clMap, now]);
  const ledger = useMemo(() => (sprintName ? sprintLedger(rows, sprintName, sprintInfo, ctx) : null), [rows, sprintName, sprintInfo, ctx]);
  const stale = useMemo(() => (ledger ? staleTickets(ledger, clMap, now, ctx) : []), [ledger, clMap, now, ctx]);
  const comparison = useMemo(() => compareSprints(rows, calendar, sprintName, clMap, undefined, ctx), [rows, calendar, sprintName, clMap, ctx]);
  const pace = useMemo(() => (ledger ? paceVerdict(ledger, now) : null), [ledger, now]);
  const tips = useMemo(() => (ledger ? suggestions({ ledger, stale, comparison, pace, history: hasHistory }) : []), [ledger, stale, comparison, pace, hasHistory]);

  const behind = useMemo(() => portfolio
    .filter(p => p.health === HEALTH.OFF_TRACK || p.health === HEALTH.AT_RISK)
    .filter(p => selectedProject === 'all' || p.project === selectedProject)
    .sort((a, b) => (a.health === b.health ? (b.varianceWeeks ?? 0) - (a.varianceWeeks ?? 0) : a.health === HEALTH.OFF_TRACK ? -1 : 1)),
  [portfolio, selectedProject]);

  // The summary is taken when the preview opens, so edits there are not reset by a
  // late-arriving change history.
  const [summary, setSummary] = useState(null);

  if (!ledger) {
    return <Card title="Sprint Review"><p className="text-slate-600">No sprint with dates was found in the data.</p></Card>;
  }

  const paceTone = pace?.verdict === 'behind' ? 'text-red-600' : pace?.verdict === 'on-pace' ? 'text-emerald-600' : 'text-slate-900';
  const historyNote = history.status === 'loading' ? 'Loading Jira change history…'
    : history.status === 'error' ? `Change history unavailable (${history.error}) — times are measured from the created date.`
    : null;
  const staleShown = stale.slice(0, 10);
  const carried = [...ledger.carriedIn].sort((a, b) => b.sprintsBefore - a.sprintsBefore);

  // Management summary: same figures as this page, previewed before it is printed or sent.
  const openSummary = () => {
    const input = {
      ledger, pace, comparison, behind, stale, tips, hasHistory,
      carried: carried.map(c => ({ key: getKey(c.ticket), summary: c.ticket['Summary'] || '', status: getStatus(c.ticket), sprintsBefore: c.sprintsBefore })),
    };
    setSummary({
      input,
      generatedSynopsis: buildManagementSynopsis(input),
      title: `Sprint Summary - ${shortSprint(sprintName)}`,
      scopeLabel: [selectedProject !== 'all' ? selectedProject : 'All projects', selectedAssignee !== 'all' ? selectedAssignee : null].filter(Boolean).join(' · '),
    });
  };
  // Jira refreshes fetch issues updated in the last N days; a sprint older than that
  // window loses tickets that finished and were never touched again.
  const daysBack = JIRA_CONFIG.dateRange?.daysBack;
  const earliestCompared = comparison.sprints[0]?.start;
  const oldestUndercounted = daysBack && earliestCompared && (now - earliestCompared) / 86400000 > daysBack;

  return (
    <div className="space-y-6">
      {summary && <SprintSummaryModal {...summary} onClose={() => setSummary(null)} />}

      {!hasHistory && history.status !== 'loading' && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 text-sm text-amber-900 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-none" />
          <span>
            Sprint history is not available: this data came from the database snapshot, which keeps each ticket's latest sprint only, and Jira's change history did not include sprint moves.
            Carry-over and work added after the sprint started need a <strong>Refresh from Jira</strong>; until then they show as "–".
          </span>
        </div>
      )}

      {/* ── Where we are ─────────────────────────────────────────────── */}
      <Card
        title={`Sprint Review · ${sprintName}`}
        subtitle={`${fmtDate(ledger.start)} – ${fmtDate(ledger.end)}${explicit ? '' : ' · current sprint (pick another in the Sprint filter)'}${selectedProject !== 'all' ? ` · ${selectedProject}` : ''}${selectedAssignee !== 'all' ? ` · ${selectedAssignee}` : ''}`}
        right={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {history.status === 'loading' && <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading history</span>}
            <button onClick={openSummary} disabled={history.status === 'loading'} title="Preview the management summary, edit the synopsis, then print or copy it"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
              <FileText className="w-4 h-4" />Preview summary
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <Stat label="Committed" value={`${ledger.sp} SP`} sub={`${ledger.items} items`} />
          <Stat label="Done" value={`${ledger.doneSP} SP`} sub={`${ledger.doneItems} items · ${pct(ledger.deliveredPct)}`} tone="text-emerald-600" />
          <Stat label="Awaiting test / version" value={`${ledger.awaitingSP} SP`} sub={`${ledger.awaitingItems} items`} />
          <Stat
            label="Pace"
            value={pace?.verdict === 'behind' ? 'Behind' : pace?.verdict === 'on-pace' ? 'On pace' : '–'}
            sub={pace?.elapsed != null ? `${pct(pace.elapsed)} of working days gone, ${pct(ledger.deliveredPct)} done` : 'No sprint dates'}
            tone={paceTone}
          />
        </div>
        <ProgressBar ledger={ledger} />
        <p className="text-xs text-slate-500 mt-3">
          Committed counts every ticket that was in this sprint at any point, including work that later moved on ("carried out").
          Done uses Done, Closed, Resolved and Completed.
        </p>
      </Card>

      {/* ── Improvements ─────────────────────────────────────────────── */}
      <Card title="What to look at" subtitle="Rules applied to this sprint's numbers. Each points at the figure that triggered it.">
        <div className="space-y-3">
          {tips.map((t, i) => {
            const s = SEVERITY_STYLE[t.severity];
            return (
              <div key={i} className={`border-l-4 ${s.border} ${s.bg} rounded-r-lg p-4`}>
                <div className="flex items-center gap-2">
                  <Lightbulb className={`w-4 h-4 ${s.text}`} />
                  <span className={`font-semibold ${s.text}`}>{t.title}</span>
                  <span className={`ml-auto text-xs font-medium ${s.text}`}>{s.label}</span>
                </div>
                <p className="text-sm text-slate-700 mt-1">{t.detail}</p>
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── Sprint vs sprint ─────────────────────────────────────────── */}
      <Card
        title="Are we improving?"
        subtitle="This sprint against the ones before it. Arrows compare with the average of the earlier sprints; green is better, red is worse."
      >
        {comparison.sprints.length < 2 ? (
          <p className="text-slate-600">Not enough earlier sprints in the data to compare.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-slate-700">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3 font-semibold">Sprint</th>
                  <th className="py-2 px-3 font-semibold text-right">Committed SP</th>
                  <th className="py-2 px-3 font-semibold text-right">Done SP</th>
                  <th className="py-2 px-3 font-semibold text-right">Delivered</th>
                  <th className="py-2 px-3 font-semibold text-right">Carried over</th>
                  <th className="py-2 px-3 font-semibold text-right">Added after start</th>
                  <th className="py-2 pl-3 font-semibold text-right">Median cycle (days)</th>
                </tr>
              </thead>
              <tbody>
                {comparison.sprints.map((s, i) => {
                  const last = i === comparison.sprints.length - 1;
                  return (
                    <tr key={s.sprint} className={`border-b border-slate-100 ${last ? 'bg-blue-50 font-semibold' : ''}`}>
                      <td className="py-2 pr-3 text-slate-900" title={s.sprint}>{shortSprint(s.sprint)} <span className="text-xs text-slate-500 font-normal">{fmtDate(s.start)}</span></td>
                      <td className="py-2 px-3 text-right">{f1(s.committedSP)}</td>
                      <td className="py-2 px-3 text-right">{f1(s.doneSP)}{last && <div><Trend t={comparison.trend.doneSP} /></div>}</td>
                      <td className="py-2 px-3 text-right">{pct(s.deliveredPct)}{last && <div><Trend t={comparison.trend.deliveredPct} fmt={pct} /></div>}</td>
                      <td className="py-2 px-3 text-right">{hasHistory ? pct(s.carryInPct) : '–'}{last && hasHistory && <div><Trend t={comparison.trend.carryInPct} fmt={pct} /></div>}</td>
                      <td className="py-2 px-3 text-right">{hasHistory ? s.addedAfterStart : '–'}{last && hasHistory && <div><Trend t={comparison.trend.addedAfterStart} /></div>}</td>
                      <td className="py-2 pl-3 text-right">{s.medianCycle != null ? f1(s.medianCycle) : '–'}<span className="text-xs text-slate-400 font-normal"> (n={s.cycleSample})</span>{last && <div><Trend t={comparison.trend.medianCycle} /></div>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-xs text-slate-500 mt-3">
              The current sprint is still running, so its Done and Delivered figures will rise until it closes.
              "Carried over" is the share of a sprint's items that were already in an earlier sprint. "Added after start" counts tickets moved into the sprint (or created) after its first day{clMap && [...clMap.values()].some(c => c?.sprint) ? '' : '; without Sprint change history only newly created tickets are seen'}.
              Cycle time is first move out of To Do to Done, in working days{clMap ? ', from Jira change history' : ', approximated from created and resolved dates'}.
              {oldestUndercounted && ` Refreshes fetch issues updated in the last ${daysBack} days, so the oldest sprint (from ${fmtDate(earliestCompared)}) may be undercounted.`}
            </p>
          </div>
        )}
      </Card>

      {/* ── Falling behind ───────────────────────────────────────────── */}
      <Card
        title="Where we are falling behind"
        subtitle="Projects forecast past their target date (from the Project Manager view on Timeline), and work this sprint inherited from earlier sprints."
      >
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Projects at risk or off track</h3>
        {behind.length === 0 ? (
          <p className="text-sm text-slate-600 mb-5 flex items-center gap-2"><CheckCircle className="w-4 h-4 text-emerald-600" />No tracked project is at risk or off track. Projects without a target date are not judged; set targets on the Timeline tab.</p>
        ) : (
          <ul className="space-y-2 mb-5">
            {behind.map(p => {
              const st = HEALTH_STYLE[p.health] || {};
              return (
                <li key={p.project} className="flex items-start gap-3">
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap" style={{ background: st.bg, color: st.color, border: `1px solid ${st.border || 'transparent'}` }}>{HEALTH_LABEL[p.health]}</span>
                  <div className="text-sm">
                    <span className="font-medium text-slate-900">{p.project}</span>
                    {p.owner && <span className="text-slate-500"> · {p.owner}</span>}
                    <div className="text-slate-600">{describeProject(p)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <h3 className="text-sm font-semibold text-slate-700 mb-2">Carried into this sprint{hasHistory ? ` (${carried.length})` : ''}</h3>
        {!hasHistory ? (
          <p className="text-sm text-slate-600">Needs a Refresh from Jira (sprint history is not in the database snapshot).</p>
        ) : carried.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing in this sprint was carried over from an earlier one.</p>
        ) : (
          <TicketTable
            rows={carried.slice(0, 15).map(c => ({
              key: getKey(c.ticket), summary: c.ticket['Summary'] || '', status: getStatus(c.ticket),
              assignee: getAssignee(c.ticket), extra: `${c.sprintsBefore} earlier sprint${c.sprintsBefore > 1 ? 's' : ''}`,
              extraTitle: `First planned in ${c.firstSprint}`, hot: c.sprintsBefore >= 2,
            }))}
            extraLabel="Slipped"
            more={carried.length > 15 ? carried.length - 15 : 0}
          />
        )}
      </Card>

      {/* ── Stale ────────────────────────────────────────────────────── */}
      <Card
        title="Stuck tickets"
        subtitle={`Open work in this sprint, longest in its current status first. Highlighted at ${STALE_WORKING_DAYS}+ working days.`}
        right={<Clock className="w-5 h-5 text-slate-400" />}
      >
        {historyNote && (
          <p className={`text-xs mb-3 flex items-center gap-1.5 ${history.status === 'error' ? 'text-amber-700' : 'text-slate-500'}`}>
            {history.status === 'error' && <AlertCircle className="w-3.5 h-3.5" />}{historyNote}
          </p>
        )}
        {staleShown.length === 0 ? (
          <p className="text-sm text-slate-600">No open work in this sprint.</p>
        ) : (
          <TicketTable
            rows={staleShown.map(s => ({
              key: s.key, summary: s.summary, status: s.status, assignee: s.assignee,
              extra: `${s.days} day${s.days === 1 ? '' : 's'}${s.exact ? '' : '*'}`,
              extraTitle: s.since ? `${s.exact ? 'In this status since' : 'Created'} ${s.since.toLocaleDateString('en-GB')}` : '',
              hot: s.days >= STALE_WORKING_DAYS,
            }))}
            extraLabel="In status"
            more={stale.length > 10 ? stale.length - 10 : 0}
          />
        )}
        {staleShown.some(s => !s.exact) && <p className="text-xs text-slate-500 mt-2">* No status change recorded, so measured from the created date.</p>}
      </Card>

      <p className="text-xs text-slate-400 flex items-center gap-1.5"><TrendingUp className="w-3.5 h-3.5" />Team-level view: tickets show who to ask, but no one is ranked.</p>
    </div>
  );
}

function TicketTable({ rows, extraLabel, more }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-slate-700">
        <thead>
          <tr className="text-left text-slate-500 border-b border-slate-200">
            <th className="py-2 pr-3 font-semibold">Ticket</th>
            <th className="py-2 px-3 font-semibold">Summary</th>
            <th className="py-2 px-3 font-semibold">Status</th>
            <th className="py-2 px-3 font-semibold">Assignee</th>
            <th className="py-2 pl-3 font-semibold text-right">{extraLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-b border-slate-100">
              <td className="py-2 pr-3 whitespace-nowrap">
                <a href={`${JIRA_BASE}/browse/${r.key}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">{r.key}</a>
              </td>
              <td className="py-2 px-3 text-slate-700 max-w-md truncate" title={r.summary}>{r.summary}</td>
              <td className="py-2 px-3 text-slate-600 whitespace-nowrap">{r.status}</td>
              <td className="py-2 px-3 text-slate-600 whitespace-nowrap">{r.assignee}</td>
              <td className={`py-2 pl-3 text-right whitespace-nowrap font-semibold ${r.hot ? 'text-red-600' : 'text-slate-700'}`} title={r.extraTitle}>{r.extra}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {more > 0 && <p className="text-xs text-slate-500 mt-2">+{more} more</p>}
    </div>
  );
}
