import React, { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { AlertCircle, AlertTriangle, CalendarClock, CalendarX, Clock, Download, Flag, PauseCircle, UserX, Loader2 } from 'lucide-react';
import { useChangelogs } from '../hooks/useChangelogs';
import { getKey, getStatus, getAssignee, getProject, getSP, getType, isDone, isTodoName, shortSprint } from '../utils/teamEngine';
import {
  sprintCalendar, currentSprint, sprintHistory, canonSprint, latestRowPerIssue, compareSprints, reviewContext,
} from '../utils/sprintReview';
import {
  headlineLists, statusMatrix, createdVsResolved, workloadFromStats, openLoadByPerson, getDue, getPriority, isOpen, isOnHold,
  STUCK_WORKING_DAYS, DUE_SOON_DAYS, CREATED_RESOLVED_WEEKS,
} from '../utils/pmDashboard';
import { HEALTH, HEALTH_LABEL } from '../utils/projectPortfolio';
import { HEALTH_STYLE, describeProject } from '../utils/projectReport';
import { zonedDayKey } from '../utils/workingDays';
import { downloadXlsx } from '../utils/xlsxExport';
import { JIRA_CONFIG } from '../config/jiraConfig';

// The PM Dashboard: what a project manager checks every day, on one page. The headline
// counts mirror the Jira "Management – Jira Delivery & Priorities" dashboard so the two
// can be read side by side; workload, sprint-over-sprint delivery and project forecasts
// come from the same calculations as the Capacity, Sprint Review and Timeline tabs.
//
// Workload names people (this page is for the PM) but is listed alphabetically: it
// shows load against capacity, never a ranking.

const JIRA_BROWSE = 'https://advancedinformationservices.atlassian.net/browse';
const SPRINTS_SHOWN = 6;

// Validated with the dataviz palette check (light surface): categorical slots 1–3.
const C = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', axis: '#898781', grid: '#e7e5e4' };

const fmtDue = key => (key ? new Date(`${key}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', timeZone: 'UTC' }) : '–');
const pct = v => (Number.isFinite(v) ? `${Math.round(v)}%` : '–');
const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : 0);

function Card({ title, subtitle, right, children }) {
  return (
    <div className="bg-white text-slate-900 rounded-xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
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

const TILES = [
  { id: 'highest', label: 'Priority – Highest', icon: Flag, tone: 'text-red-700' },
  { id: 'high', label: 'Priority – High', icon: Flag, tone: 'text-orange-700' },
  { id: 'onHold', label: 'On Hold', icon: PauseCircle, tone: 'text-slate-700' },
  { id: 'overdue', label: 'Overdue', icon: CalendarX, tone: 'text-red-700' },
  { id: 'dueSoon', label: `Due next ${DUE_SOON_DAYS} days`, icon: CalendarClock, tone: 'text-amber-700' },
  { id: 'unassigned', label: 'Unassigned', icon: UserX, tone: 'text-slate-700' },
  { id: 'stuck', label: `Stuck ${STUCK_WORKING_DAYS}+ working days`, icon: Clock, tone: 'text-red-700' },
];

// The Raw Data tab's list toggles. Hide Completed is left out: these lists are open work only.
const LIST_FILTERS = [
  { id: 'storiesOnly', label: 'Stories Only', tone: 'text-purple-600 focus:ring-purple-500' },
  { id: 'hideAwaitingTesting', label: 'Hide Awaiting Testing', tone: 'text-amber-600 focus:ring-amber-500' },
  { id: 'hideAwaitingVersioning', label: 'Hide Awaiting Versioning', tone: 'text-purple-600 focus:ring-purple-500' },
  { id: 'noStoryPoints', label: 'No Story Points Only', tone: 'text-amber-600 focus:ring-amber-500' },
  { id: 'noDueDate', label: 'No Due Date Only', tone: 'text-rose-600 focus:ring-rose-500' },
];
const NO_LIST_FILTERS = { storiesOnly: false, hideAwaitingTesting: false, hideAwaitingVersioning: false, noStoryPoints: false, noDueDate: false, flaggedOnly: false };

function ChartTooltip({ active, payload, label, suffix = '' }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-md px-3 py-2 text-xs text-slate-700">
      <div className="font-semibold text-slate-900 mb-1">{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
          <span>{p.name}: <strong className="text-slate-900">{p.value}{suffix}</strong></span>
        </div>
      ))}
      {payload[0]?.payload?.note && <div className="text-slate-500 mt-1">{payload[0].payload.note}</div>}
    </div>
  );
}

export default function PMDashboardTab({
  tickets = [], stats = {}, selectedSprint, setSelectedSprint, selectedProject = 'all', selectedAssignee = 'all',
  excludedAssignees = [], portfolio = [],
}) {
  const now = useMemo(() => new Date(), []);
  const today = useMemo(() => zonedDayKey(now), [now]);
  const [scope, setScope] = useState('sprint');      // sprint | open
  const [listId, setListId] = useState('overdue');   // which ticket list is open below the tiles
  // Filters on the ticket list, as on Raw Data; the tile counts follow them too.
  const [listFilters, setListFilters] = useState(NO_LIST_FILTERS);
  const [listStatus, setListStatus] = useState('all');
  // Flags are set on the Raw Data tab and shared through the same storage key.
  const [flaggedTickets] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('flaggedTickets') || '[]')); }
    catch { return new Set(); }
  });

  // One row per issue (the DB snapshot can repeat an issue per sprint), global filters applied.
  const base = useMemo(() => latestRowPerIssue(tickets).filter(t =>
    !excludedAssignees.includes(getAssignee(t))
    && (selectedProject === 'all' || getProject(t) === selectedProject)
    && (selectedAssignee === 'all' || getAssignee(t) === selectedAssignee)
  ), [tickets, excludedAssignees, selectedProject, selectedAssignee]);

  const calendar = useMemo(() => sprintCalendar(base), [base]);
  const explicit = calendar.some(s => canonSprint(s.name) === canonSprint(selectedSprint));
  const sprintName = explicit ? selectedSprint : currentSprint(calendar, now);

  const sprintRows = useMemo(
    () => base.filter(t => canonSprint(sprintHistory(t).at(-1)?.name) === canonSprint(sprintName)),
    [base, sprintName],
  );
  const scoped = scope === 'sprint' ? sprintRows : base;
  const open = useMemo(() => scoped.filter(isOpen), [scoped]);
  const datesMissing = useMemo(() => base.length > 0 && !base.some(t => t['Created']), [base]);

  // Change history: started open work (time in status) and the sprints being compared.
  const windowNames = useMemo(
    () => new Set(compareSprints(base, calendar, sprintName, null, SPRINTS_SHOWN).sprints.map(s => s.sprint)),
    [base, calendar, sprintName],
  );
  const historyKeys = useMemo(() => base.filter(t => {
    const s = getStatus(t);
    if (!isDone(s) && !isTodoName(s) && !isOnHold(s) && (scope === 'open' || sprintRows.includes(t))) return true;
    return windowNames.has(sprintHistory(t).at(-1)?.name);
  }).map(getKey), [base, scope, sprintRows, windowNames]);
  const history = useChangelogs(historyKeys);
  const clMap = history.status === 'loaded' ? history.byKey : null;

  const lists = useMemo(() => headlineLists(open, { today, changelogs: clMap, now }), [open, today, clMap, now]);
  const matrix = useMemo(() => statusMatrix(open), [open]);
  const cvr = useMemo(() => createdVsResolved(base, { now }), [base, now]);
  const ctx = useMemo(() => reviewContext(base, clMap, now), [base, clMap, now]);
  // Refreshes fetch finished work updated in the last N days, so a sprint that started
  // before that window has lost most of its done tickets and would read as a collapse.
  // Show only sprints that started inside it.
  const daysBack = JIRA_CONFIG.dateRange?.daysBack;
  const windowStart = useMemo(() => (daysBack ? new Date(now.getTime() - daysBack * 86400000) : null), [now, daysBack]);
  const trendAll = useMemo(() => compareSprints(base, calendar, sprintName, clMap, SPRINTS_SHOWN, ctx), [base, calendar, sprintName, clMap, ctx]);
  const trend = useMemo(() => ({ ...trendAll, sprints: trendAll.sprints.filter(s => !windowStart || (s.start && s.start >= windowStart)) }), [trendAll, windowStart]);
  const droppedSprints = trendAll.sprints.length - trend.sprints.length;
  const workload = useMemo(() => workloadFromStats(stats, excludedAssignees), [stats, excludedAssignees]);
  const openLoad = useMemo(() => openLoadByPerson(open, { today }), [open, today]);
  const behind = useMemo(() => portfolio
    .filter(p => p.health === HEALTH.OFF_TRACK || p.health === HEALTH.AT_RISK)
    .filter(p => selectedProject === 'all' || p.project === selectedProject)
    .sort((a, b) => (b.varianceWeeks ?? 0) - (a.varianceWeeks ?? 0)), [portfolio, selectedProject]);

  const tileRows = listId === 'priority' ? [...lists.highest, ...lists.high] : lists[listId] || [];
  const listStatuses = [...new Set(tileRows.map(getStatus).filter(Boolean))].sort();
  const keepRow = t => {
    const s = (getStatus(t) || '').toLowerCase();
    if (listFilters.storiesOnly && getType(t) !== 'Story') return false;
    if (listFilters.hideAwaitingTesting && s === 'awaiting testing') return false;
    if (listFilters.hideAwaitingVersioning && s === 'awaiting versioning') return false;
    if (listFilters.noStoryPoints && getSP(t) !== 0) return false;
    if (listFilters.noDueDate && getDue(t)) return false;
    if (listFilters.flaggedOnly && !flaggedTickets.has(getKey(t))) return false;
    return listStatus === 'all' || getStatus(t) === listStatus;
  };
  const listRows = tileRows.filter(keepRow);
  const listFiltered = listRows.length !== tileRows.length;
  const filtersOn = listStatus !== 'all' || Object.values(listFilters).some(Boolean);
  const listTitle = listId === 'priority' ? 'Priority items (Highest and High)' : TILES.find(t => t.id === listId)?.label;
  const scopeLabel = scope === 'sprint' ? shortSprint(sprintName) : 'all open work';
  const sprintRunning = trend.sprints.length && trend.sprints.at(-1).end > now;

  const exportList = () => downloadXlsx({
    fileName: `${listTitle.replace(/[^\w]+/g, '-').toLowerCase()}-${today}.xlsx`,
    sheetName: listTitle,
    rows: listRows,
    columns: [
      { header: 'Key', value: getKey, link: t => `${JIRA_BROWSE}/${getKey(t)}` },
      { header: 'Summary', value: t => t['Summary'], width: 60 },
      { header: 'Priority', value: getPriority },
      { header: 'Status', value: getStatus },
      { header: 'Assignee', value: t => getAssignee(t) || 'Unassigned' },
      { header: 'Project', value: getProject },
      { header: 'Story Points', type: 'number', value: getSP },
      { header: 'Due Date', type: 'date', value: getDue },
      ...(listId === 'stuck' ? [{ header: 'Working days in status', type: 'number', value: t => t._daysInStatus }] : []),
    ],
  });

  const sprintChart = trend.sprints.map(s => ({
    sprint: shortSprint(s.sprint),
    committed: r1(s.committedSP),
    done: r1(s.doneSP),
    note: `Delivered ${pct(s.deliveredPct)} · carried over ${pct(s.carryInPct)}${s.end > now ? ' · in progress' : ''}`,
  }));
  const cvrChart = cvr.weeks.map(w => ({ ...w, label: fmtDue(w.week).slice(0, 6) }));

  return (
    <div className="space-y-6">
      {/* ── Scope ─────────────────────────────────────────────────── */}
      <Card
        title="PM Dashboard"
        subtitle={`${scope === 'sprint' ? `${sprintName}${explicit ? '' : ' (current sprint)'}` : 'All open work, every sprint and backlog'}${selectedProject !== 'all' ? ` · ${selectedProject}` : ''}${selectedAssignee !== 'all' ? ` · ${selectedAssignee}` : ''}`}
        right={
          <div className="flex items-center gap-3">
            {history.status === 'loading' && <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="w-3.5 h-3.5 animate-spin" />Loading history</span>}
            <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm font-medium" role="group" aria-label="Scope">
              {[['sprint', 'This sprint'], ['open', 'All open work']].map(([k, l]) => (
                <button key={k} onClick={() => setScope(k)} aria-pressed={scope === k}
                  className={`px-3 py-2 ${scope === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-100'}`}>{l}</button>
              ))}
            </div>
          </div>
        }
      >
        {datesMissing && (
          <p className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-none" />
            This data came from the database snapshot, which has no due, created or resolved dates. Overdue, due-soon and created-vs-resolved need a <strong>Refresh from Jira</strong>.
          </p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {TILES.map(({ id, label, icon, tone }) => {
            const total = lists[id].length;
            const n = filtersOn ? lists[id].filter(keepRow).length : total;
            const active = listId === id;
            const waiting = id === 'stuck' && !clMap;
            return (
              <button key={id} onClick={() => setListId(active ? 'priority' : id)} aria-pressed={active}
                className={`text-left rounded-lg border p-3 transition ${active ? 'border-slate-900 ring-2 ring-slate-900/10 bg-slate-50' : 'border-slate-200 hover:border-slate-400'}`}>
                {React.createElement(icon, { className: `w-4 h-4 ${tone}` })}
                <div className="text-2xl font-bold text-slate-900 mt-1">
                  {waiting ? '…' : n}
                  {!waiting && n !== total && <span className="text-sm font-normal text-slate-500"> of {total}</span>}
                </div>
                <div className="text-xs text-slate-600 leading-tight">{label}</div>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Counts are open work in {scopeLabel}{filtersOn ? ', with the list filters below applied' : ''}. Click a tile to list its tickets below. Overdue = due before today; stuck = started work (not To Do or On Hold) in the same status for {STUCK_WORKING_DAYS}+ working days, from Jira change history.
        </p>
      </Card>

      {/* ── Ticket list ───────────────────────────────────────────── */}
      <Card
        title={`${listTitle} (${listFiltered ? `${listRows.length} of ${tileRows.length}` : listRows.length})`}
        subtitle={`Open work in ${scopeLabel}`}
        right={
          <button onClick={exportList} disabled={!listRows.length}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            <Download className="w-4 h-4" />Export to Excel
          </button>
        }
      >
        <div className="flex flex-wrap items-center gap-3 mb-4">
          {LIST_FILTERS.map(({ id, label, tone }) => (
            <label key={id} className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors">
              <input type="checkbox" checked={listFilters[id]} onChange={() => setListFilters(f => ({ ...f, [id]: !f[id] }))}
                className={`w-4 h-4 rounded ${tone}`} />
              <span className="text-slate-700 text-sm font-medium select-none">{label}</span>
            </label>
          ))}
          <button onClick={() => setListFilters(f => ({ ...f, flaggedOnly: !f.flaggedOnly }))} aria-pressed={listFilters.flaggedOnly}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
              listFilters.flaggedOnly ? 'bg-orange-500 border-orange-500 text-white' : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-orange-50 hover:border-orange-300'
            }`}>
            🚩 Flagged{flaggedTickets.size > 0 && <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${listFilters.flaggedOnly ? 'bg-white text-orange-600' : 'bg-orange-500 text-white'}`}>{flaggedTickets.size}</span>}
          </button>
          <select value={listStatus} onChange={e => setListStatus(e.target.value)} aria-label="Status"
            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-sm text-slate-700">
            <option value="all">All statuses</option>
            {[...new Set([...listStatuses, ...(listStatus !== 'all' ? [listStatus] : [])])].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {filtersOn && (
            <button onClick={() => { setListFilters(NO_LIST_FILTERS); setListStatus('all'); }}
              className="text-sm text-slate-600 hover:text-slate-900 underline">Clear</button>
          )}
        </div>
        {listRows.length === 0 ? <p className="text-sm text-slate-600">{listFiltered ? 'Nothing matches these filters.' : 'Nothing here.'}</p> : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
            <table className="w-full text-sm text-slate-700">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3 font-semibold">Key</th>
                  <th className="py-2 px-3 font-semibold">Summary</th>
                  <th className="py-2 px-3 font-semibold">Priority</th>
                  <th className="py-2 px-3 font-semibold">Status</th>
                  <th className="py-2 px-3 font-semibold">Assignee</th>
                  <th className="py-2 px-3 font-semibold">Due</th>
                  {listId === 'stuck' && <th className="py-2 pl-3 font-semibold text-right">In status</th>}
                </tr>
              </thead>
              <tbody>
                {listRows.map(t => {
                  const due = getDue(t);
                  return (
                    <tr key={getKey(t)} className="border-b border-slate-100">
                      <td className="py-2 pr-3 whitespace-nowrap"><a href={`${JIRA_BROWSE}/${getKey(t)}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-medium">{getKey(t)}</a></td>
                      <td className="py-2 px-3 max-w-md truncate" title={t['Summary']}>{t['Summary']}</td>
                      <td className="py-2 px-3 whitespace-nowrap">{getPriority(t) || '–'}</td>
                      <td className="py-2 px-3 whitespace-nowrap">{getStatus(t)}</td>
                      <td className="py-2 px-3 whitespace-nowrap">{getAssignee(t) && getAssignee(t) !== 'Unassigned' ? getAssignee(t) : <em className="text-slate-400">Unassigned</em>}</td>
                      <td className={`py-2 px-3 whitespace-nowrap ${due && due < today ? 'text-red-600 font-semibold' : ''}`}>{fmtDue(due)}</td>
                      {listId === 'stuck' && <td className="py-2 pl-3 text-right font-semibold text-red-600">{t._daysInStatus} days</td>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Workload ──────────────────────────────────────────────── */}
      {scope === 'sprint' ? (
        <Card title="Workload per person" subtitle={`${shortSprint(sprintName)} · story points against each person's sprint capacity (same figures as the Capacity tab), alphabetical`}>
          {!explicit ? (
            <div className="text-sm text-slate-700 flex flex-wrap items-center gap-3">
              Workload against capacity needs a sprint selected in the filter.
              {setSelectedSprint && sprintName && (
                <button onClick={() => setSelectedSprint(sprintName)} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700">Show {shortSprint(sprintName)}</button>
              )}
            </div>
          ) : workload.length === 0 ? <p className="text-sm text-slate-600">No assigned work in this sprint.</p> : (
            <WorkloadTable people={workload} />
          )}
        </Card>
      ) : (
        <Card title="Open work per person" subtitle="Everything open, in any sprint or the backlog. No capacity here: it spans more than one sprint. Alphabetical.">
          <OpenLoadTable people={openLoad} />
        </Card>
      )}

      {/* ── Sprint over sprint ────────────────────────────────────── */}
      <Card title="Sprint over sprint" subtitle={`Committed vs done story points, last ${trend.sprints.length} sprints${sprintRunning ? ' (the latest is still running)' : ''}. Hover a sprint for delivery % and carry-over.${droppedSprints ? ` Earlier sprints are left out: they started before the ${daysBack}-day refresh window, so their finished work is incomplete.` : ''}`}>
        {sprintChart.length < 2 ? <p className="text-sm text-slate-600">Not enough sprints in the data yet.</p> : (
          <>
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={sprintChart} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={C.grid} />
                  <XAxis dataKey="sprint" tick={{ fill: C.axis, fontSize: 12 }} axisLine={{ stroke: C.grid }} tickLine={false} />
                  <YAxis tick={{ fill: C.axis, fontSize: 12 }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip content={<ChartTooltip suffix=" SP" />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#52514e' }} iconType="square" />
                  <Bar dataKey="committed" name="Committed" fill={C.blue} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  <Bar dataKey="done" name="Done" fill={C.orange} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-slate-500 text-xs">Show as table</summary>
              <table className="w-full text-sm text-slate-700 mt-2">
                <thead><tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-1.5 pr-3 font-semibold">Sprint</th><th className="py-1.5 px-3 font-semibold text-right">Committed SP</th><th className="py-1.5 px-3 font-semibold text-right">Done SP</th><th className="py-1.5 px-3 font-semibold text-right">Delivered</th><th className="py-1.5 pl-3 font-semibold text-right">Carried over</th>
                </tr></thead>
                <tbody>{trend.sprints.map(s => (
                  <tr key={s.sprint} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3">{shortSprint(s.sprint)}{s.end > now ? <span className="text-slate-400"> (in progress)</span> : ''}</td>
                    <td className="py-1.5 px-3 text-right">{r1(s.committedSP)}</td><td className="py-1.5 px-3 text-right">{r1(s.doneSP)}</td>
                    <td className="py-1.5 px-3 text-right">{pct(s.deliveredPct)}</td><td className="py-1.5 pl-3 text-right">{clMap ? pct(s.carryInPct) : '…'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </details>
          </>
        )}
      </Card>

      {/* ── Project × status ──────────────────────────────────────── */}
      <Card title="Open work by project and status" subtitle={`${matrix.total} open items in ${scopeLabel}, busiest project first (Jira's "Active Work" view).`}>
        {matrix.rows.length === 0 ? <p className="text-sm text-slate-600">No open work.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-slate-700">
              <thead><tr className="text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-3 font-semibold text-left">Project</th>
                {matrix.columns.map(c => <th key={c} className="py-2 px-2 font-semibold text-right whitespace-nowrap">{c}</th>)}
                <th className="py-2 pl-3 font-semibold text-right">Total</th>
              </tr></thead>
              <tbody>
                {matrix.rows.map(r => (
                  <tr key={r.project} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3 text-slate-900">{r.project}</td>
                    {matrix.columns.map(c => <td key={c} className={`py-1.5 px-2 text-right tabular-nums ${r.counts[c] ? '' : 'text-slate-300'}`}>{r.counts[c]}</td>)}
                    <td className="py-1.5 pl-3 text-right font-semibold tabular-nums">{r.total}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="py-2 pr-3">Total</td>
                  {matrix.columns.map(c => <td key={c} className="py-2 px-2 text-right tabular-nums">{matrix.totals[c]}</td>)}
                  <td className="py-2 pl-3 text-right tabular-nums">{matrix.total}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Created vs resolved ───────────────────────────────────── */}
      <Card title="Created vs resolved"
        subtitle={`Per week, last ${CREATED_RESOLVED_WEEKS} weeks${selectedProject !== 'all' ? ` · ${selectedProject}` : ''} (all sprints). ${cvr.net > 0 ? `${cvr.net} more created than resolved: the backlog is growing.` : cvr.net < 0 ? `${-cvr.net} more resolved than created: the backlog is shrinking.` : 'Created and resolved are level.'}`}>
        {datesMissing ? <p className="text-sm text-slate-600">Needs a Refresh from Jira.</p> : (
          <>
            <div style={{ height: 240 }}>
              <ResponsiveContainer>
                <BarChart data={cvrChart} barGap={2} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={C.grid} />
                  <XAxis dataKey="label" tick={{ fill: C.axis, fontSize: 12 }} axisLine={{ stroke: C.grid }} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fill: C.axis, fontSize: 12 }} axisLine={false} tickLine={false} width={40} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(15,23,42,0.04)' }} labelFormatter={l => `Week of ${l}`} />
                  <Legend wrapperStyle={{ fontSize: 12, color: '#52514e' }} iconType="square" />
                  <Bar dataKey="created" name="Created" fill={C.blue} radius={[4, 4, 0, 0]} maxBarSize={24} />
                  <Bar dataKey="resolved" name="Resolved" fill={C.orange} radius={[4, 4, 0, 0]} maxBarSize={24} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-slate-500 mt-1">{cvr.created} created, {cvr.resolved} resolved in {CREATED_RESOLVED_WEEKS} weeks. Weeks start on Monday.</p>
          </>
        )}
      </Card>

      {/* ── Projects against target ───────────────────────────────── */}
      <Card title="Projects against target" subtitle="Forecast from each project's measured delivery rate (Project Manager view on the Timeline tab).">
        {behind.length === 0 ? <p className="text-sm text-slate-600">No tracked project is at risk or off track. Projects without a target date are not judged.</p> : (
          <ul className="space-y-2">
            {behind.map(p => {
              const st = HEALTH_STYLE[p.health] || {};
              return (
                <li key={p.project} className="flex items-start gap-3">
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1" style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                    <AlertTriangle className="w-3 h-3" />{HEALTH_LABEL[p.health]}
                  </span>
                  <div className="text-sm">
                    <span className="font-medium text-slate-900">{p.project}</span>{p.owner && <span className="text-slate-500"> · {p.owner}</span>}
                    <div className="text-slate-600">{describeProject(p)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function LoadBar({ done, awaiting, active, capacity }) {
  const max = Math.max(capacity, done + awaiting + active, 1);
  const w = v => `${(v / max) * 100}%`;
  return (
    <div className="relative h-3 bg-slate-100 rounded min-w-[140px]" title={`Done ${r1(done)} · awaiting ${r1(awaiting)} · active ${r1(active)} · capacity ${r1(capacity)} SP`}>
      <div className="absolute inset-y-0 left-0 flex gap-[2px]" style={{ width: w(done + awaiting + active) }}>
        {done > 0 && <div style={{ flex: done, background: C.aqua }} className="rounded-l" />}
        {awaiting > 0 && <div style={{ flex: awaiting, background: C.orange }} />}
        {active > 0 && <div style={{ flex: active, background: C.blue }} className="rounded-r" />}
      </div>
      {capacity > 0 && <div className="absolute -top-1 -bottom-1 w-0.5 bg-slate-900" style={{ left: w(capacity) }} title={`Capacity ${r1(capacity)} SP`} />}
    </div>
  );
}

const STATUS_PILL = {
  'Overloaded': 'bg-red-100 text-red-800',
  'Fully Allocated': 'bg-amber-100 text-amber-800',
  'Has Capacity': 'bg-emerald-100 text-emerald-800',
};

function WorkloadTable({ people }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-slate-700">
        <thead><tr className="text-left text-slate-500 border-b border-slate-200">
          <th className="py-2 pr-3 font-semibold">Person</th>
          <th className="py-2 px-3 font-semibold">Load vs capacity</th>
          <th className="py-2 px-3 font-semibold text-right">Active SP</th>
          <th className="py-2 px-3 font-semibold text-right">Awaiting SP</th>
          <th className="py-2 px-3 font-semibold text-right">Done SP</th>
          <th className="py-2 px-3 font-semibold text-right">Capacity</th>
          <th className="py-2 px-3 font-semibold text-right">Items active</th>
          <th className="py-2 pl-3 font-semibold">Status</th>
        </tr></thead>
        <tbody>
          {people.map(p => (
            <tr key={p.name} className="border-b border-slate-100">
              <td className="py-2 pr-3 text-slate-900 whitespace-nowrap">{p.name}</td>
              <td className="py-2 px-3"><LoadBar {...p} /></td>
              <td className="py-2 px-3 text-right tabular-nums">{r1(p.active)}</td>
              <td className="py-2 px-3 text-right tabular-nums">{r1(p.awaiting)}</td>
              <td className="py-2 px-3 text-right tabular-nums">{r1(p.done)}</td>
              <td className="py-2 px-3 text-right tabular-nums">{r1(p.capacity)}</td>
              <td className="py-2 px-3 text-right tabular-nums">{p.activeItems}</td>
              <td className="py-2 pl-3 whitespace-nowrap">
                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_PILL[p.status] || 'bg-slate-100 text-slate-700'}`}>
                  {p.status}{p.remaining >= 0 ? ` · ${r1(p.remaining)} SP free` : ` · ${r1(-p.remaining)} SP over`}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-4 mt-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: C.aqua }} />Done</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: C.orange }} />Awaiting test / version</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: C.blue }} />Active (to do + in progress)</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-0.5 h-3 bg-slate-900" />Capacity</span>
        <span>Status uses active work against capacity, as on the Capacity tab.</span>
      </div>
    </div>
  );
}

function OpenLoadTable({ people }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm text-slate-700">
        <thead><tr className="text-left text-slate-500 border-b border-slate-200">
          <th className="py-2 pr-3 font-semibold">Person</th>
          <th className="py-2 px-3 font-semibold text-right">Open items</th>
          <th className="py-2 px-3 font-semibold text-right">Open SP</th>
          <th className="py-2 px-3 font-semibold text-right">In progress</th>
          <th className="py-2 px-3 font-semibold text-right">Awaiting</th>
          <th className="py-2 px-3 font-semibold text-right">Overdue</th>
          <th className="py-2 pl-3 font-semibold text-right">High / Highest</th>
        </tr></thead>
        <tbody>
          {people.map(p => (
            <tr key={p.name} className="border-b border-slate-100">
              <td className={`py-2 pr-3 whitespace-nowrap ${p.name === 'Unassigned' ? 'italic text-slate-500' : 'text-slate-900'}`}>{p.name}</td>
              <td className="py-2 px-3 text-right tabular-nums">{p.items}</td>
              <td className="py-2 px-3 text-right tabular-nums">{p.sp}</td>
              <td className="py-2 px-3 text-right tabular-nums">{p.inProgress}</td>
              <td className="py-2 px-3 text-right tabular-nums">{p.awaiting}</td>
              <td className={`py-2 px-3 text-right tabular-nums ${p.overdue ? 'text-red-600 font-semibold' : ''}`}>{p.overdue}</td>
              <td className="py-2 pl-3 text-right tabular-nums">{p.high}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
