import React, { useState, useEffect, useMemo } from 'react';
import { RefreshCw, AlertCircle, Loader2, Copy, Check, FileText, Printer, Download, ChevronDown, ChevronUp } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import {
  fetchCSRIssues, transformCSRIssue, CSR_PROJECTS, DOMAIN_MAP,
  getSLARisk, getSLATarget, SLA_RISK_STYLES, fetchSLABreaches,
} from '../utils/csrService.js';

const LEGACY_CUTOFF_YEARS = 2;
const STALE_DEFAULT_DAYS  = 180;

// ─── Pure helpers (exported for testing) ─────────────────────────────────────

export function applyFilters(issues, filters) {
  return issues.filter(t => {
    if (filters.project   !== 'all' && t.projectKey !== filters.project)   return false;
    if (filters.status    !== 'all' && t.status     !== filters.status)    return false;
    if (filters.bank      !== 'all' && t.bank       !== filters.bank)      return false;
    if (filters.assignee  !== 'all' && t.assignee   !== filters.assignee)  return false;
    if (filters.reporter  !== 'all' && t.reporter   !== filters.reporter)  return false;
    if (filters.dateFrom && (!t.created || t.created < filters.dateFrom))  return false;
    if (filters.dateTo) {
      const d = t.created ? t.created.slice(0, 10) : '';
      if (!d || d > filters.dateTo) return false;
    }
    if (filters.slaOnly   && !t.isSLABreach) return false;
    if (filters.staleOnly && !t.isStale)     return false;
    if (filters.kpiFilter) {
      const now = new Date();
      switch (filters.kpiFilter) {
        case 'open':      if (['Completed','Closed'].includes(t.status) || t.statusCat === 'Done') return false; break;
        case 'wip':       if (t.statusCat !== 'In Progress') return false; break;
        case 'completed': if (!['Completed','Closed'].includes(t.status) && t.statusCat !== 'Done') return false; break;
        case 'new24h':    if (!t.created || new Date(t.created) < new Date(now - 86400000)) return false; break;
        case 'new7':      if (!t.created || new Date(t.created) < new Date(now - 7  * 86400000)) return false; break;
        case 'new30':     if (!t.created || new Date(t.created) < new Date(now - 30 * 86400000)) return false; break;
        case 'sla':       if (!t.isSLABreach) return false; break;
        case 'at-risk':   if (t.slaRisk !== 'at-risk')   return false; break;
        case 'breaching': if (t.slaRisk !== 'breaching') return false; break;
        case 'linked':    if (!t.internalLinks || t.internalLinks.length === 0) return false; break;
        case 'unlinked':  if (t.internalLinks && t.internalLinks.length > 0) return false; break;
        default: break;
      }
    }
    return true;
  });
}

export function computeResolutionStats(tickets, excludeLegacy = true) {
  const slaBreachCount = tickets.filter(t => t.isSLABreach).length;
  const cutoff = excludeLegacy ? new Date(Date.now() - LEGACY_CUTOFF_YEARS * 365 * 86400000) : null;
  const resolved = tickets.filter(t => t.resolved && t.created && (!cutoff || new Date(t.created) >= cutoff));
  if (resolved.length === 0) return { avg: null, median: null, min: null, max: null, byProject: [], slaBreachCount };
  const times = resolved.map(t => Math.floor((new Date(t.resolved) - new Date(t.created)) / 86400000)).sort((a,b) => a-b);
  const avg = times.reduce((s,v) => s+v, 0) / times.length;
  const mid = Math.floor(times.length / 2);
  const median = times.length % 2 === 0 ? (times[mid-1] + times[mid]) / 2 : times[mid];
  const projectMap = {};
  resolved.forEach(t => {
    const proj = t.project || t.projectKey || 'Unknown';
    if (!projectMap[proj]) projectMap[proj] = [];
    projectMap[proj].push(Math.floor((new Date(t.resolved) - new Date(t.created)) / 86400000));
  });
  const byProject = Object.entries(projectMap).map(([project, vals]) => ({
    project, avg: vals.reduce((s,v) => s+v, 0) / vals.length,
  }));
  return { avg, median, min: times[0], max: times[times.length-1], byProject, slaBreachCount };
}

export function generateStandupReport(issues, today = new Date()) {
  const todayStr     = today.toISOString().slice(0, 10);
  const yesterday    = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  const closedYesterday = issues.filter(t => t.resolved && t.resolved.slice(0,10) === yesterdayStr);
  const newToday        = issues.filter(t => t.created  && t.created.slice(0,10)  === todayStr);
  const wipMap = {};
  issues.forEach(t => {
    if (t.statusCat === 'In Progress' || t.status === 'Work In Progress')
      wipMap[t.assignee] = (wipMap[t.assignee] || 0) + 1;
  });
  const inProgressByAssignee = Object.entries(wipMap).map(([assignee, count]) => ({ assignee, count })).sort((a,b) => b.count - a.count);
  const slaBreaches = issues.filter(t => t.isSLABreach);
  const atRisk      = issues.filter(t => t.slaRisk === 'at-risk').length;
  const breaching   = issues.filter(t => t.slaRisk === 'breaching').length;
  const weekAgo = new Date(today - 7 * 86400000);
  const bankCounts = {};
  issues.filter(t => t.created && new Date(t.created) >= weekAgo).forEach(t => { bankCounts[t.bank] = (bankCounts[t.bank]||0)+1; });
  const topBank = Object.entries(bankCounts).sort((a,b) => b[1]-a[1])[0] || null;
  return { generatedAt: today, closedYesterday, newToday, inProgressByAssignee, slaBreaches, atRisk, breaching, topBank };
}

export function serializeStandupToText(report) {
  const lines = [`Stand-up Report — ${report.generatedAt instanceof Date ? report.generatedAt.toLocaleDateString('en-GB') : report.generatedAt}`, ''];
  lines.push(`## New (24h) / Today (${report.newToday.length})`);
  report.newToday.length === 0 ? lines.push('  None') : report.newToday.forEach(t => lines.push(`  - ${t.key}: ${t.summary}`));
  lines.push('', `## Closed Yesterday (${report.closedYesterday.length})`);
  report.closedYesterday.length === 0 ? lines.push('  None') : report.closedYesterday.forEach(t => lines.push(`  - ${t.key}: ${t.summary}`));
  lines.push('', `## In Progress by Assignee`);
  report.inProgressByAssignee.length === 0 ? lines.push('  None') : report.inProgressByAssignee.forEach(({ assignee, count }) => lines.push(`  - ${assignee}: ${count} ticket${count!==1?'s':''}`));
  lines.push('', `## SLA Risk — At Risk: ${report.atRisk} | Breaching: ${report.breaching}`);
  report.slaBreaches.forEach(t => lines.push(`  - ${t.key}: ${t.summary} (${t.age}d, ${t.assignee})`));
  if (report.topBank) lines.push('', `## Top Reporting Bank This Week`, `  ${report.topBank[0]}: ${report.topBank[1]} tickets`);
  return lines.join('\n');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_FILTERS = {
  project: 'all', status: 'all', bank: 'all', assignee: 'all', reporter: 'all',
  dateFrom: '', dateTo: '', slaOnly: false, staleOnly: false, kpiFilter: null,
};

function isFiltersActive(f) {
  return f.project !== 'all' || f.status !== 'all' || f.bank !== 'all' || f.assignee !== 'all' || f.reporter !== 'all' ||
    f.dateFrom !== '' || f.dateTo !== '' || f.slaOnly || f.staleOnly || !!f.kpiFilter;
}

function fmtDays(v) {
  if (v === null || v === undefined) return '—';
  if (Math.round(v) === 0) return '<1d';
  return `${Math.round(v)}d`;
}

function exportCSV(tickets, filename = `CSR_tickets_export_${new Date().toISOString().slice(0,10)}.csv`) {
  const headers = ['Key','Summary','Project','Reporter','Bank/Client','Assignee','Status','SLA Status','Age (days)','Internal Ref','Internal Status','Created Date','Last Updated','Resolution Time (days)'];
  const rows = tickets.map(t => {
    const link = t.internalLinks?.[0];
    const resolutionDays = t.resolved && t.created
      ? Math.floor((new Date(t.resolved) - new Date(t.created)) / 86400000)
      : '';
    return [
      t.key,
      `"${(t.summary||'').replace(/"/g,'""')}"`,
      t.project, t.reporter, t.bank,
      t.assignee || 'Unassigned',
      t.status, t.slaRisk || '',
      t.age,
      link?.key || '',
      link?.status || '',
      t.created ? new Date(t.created).toLocaleDateString('en-GB') : '',
      t.updated ? new Date(t.updated).toLocaleDateString('en-GB') : '',
      resolutionDays,
    ];
  });
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Filter Panel ─────────────────────────────────────────────────────────────

function FilterPanel({ issues, filters, setFilters }) {
  const statuses  = useMemo(() => [...new Set(issues.map(i => i.status))].filter(Boolean).sort(), [issues]);
  const banks     = useMemo(() => [...new Set(issues.map(i => i.bank))].filter(Boolean).sort(), [issues]);
  const assignees = useMemo(() => [...new Set(issues.map(i => i.assignee))].filter(Boolean).sort(), [issues]);
  const reporters = useMemo(() => [...new Set(issues.map(i => i.reporter))].filter(Boolean).sort(), [issues]);
  const set = (key, val) => setFilters(f => ({ ...f, [key]: val }));
  const [openDrop, setOpenDrop] = useState(null);

  function handleSelect(filterKey, value) {
    const newValue = filters[filterKey] === value ? 'all' : value;
    set(filterKey, newValue);
    setOpenDrop(null);
  }

  const btnCls = 'px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-400 outline-none text-left min-w-[130px] flex items-center justify-between gap-2';

  const filterDropdowns = [
    { key: 'project',  label: 'Project',  options: CSR_PROJECTS.map(p => ({ value: p.key, label: p.name })), current: filters.project },
    { key: 'status',   label: 'Status',   options: statuses.map(s => ({ value: s, label: s })),              current: filters.status },
    { key: 'bank',     label: 'Bank',     options: banks.map(b => ({ value: b, label: b })),                 current: filters.bank },
    { key: 'assignee', label: 'Assignee', options: assignees.map(a => ({ value: a, label: a })),             current: filters.assignee },
    { key: 'reporter', label: 'Reporter', options: reporters.map(r => ({ value: r, label: r })),             current: filters.reporter },
  ];

  return (
    <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-sm">
      <div className="flex flex-wrap gap-3 items-end">
        {filterDropdowns.map(({ key, label, options, current }) => (
          <div key={key} className="flex flex-col gap-1 relative">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</label>
            <button type="button" onClick={() => setOpenDrop(openDrop === key ? null : key)} className={btnCls}>
              <span className="truncate">{current === 'all' ? 'All ' + label + 's' : options.find(o => o.value === current)?.label || current}</span>
              <span className="text-slate-400 text-xs">{openDrop === key ? '▲' : '▼'}</span>
            </button>
            {openDrop === key && (
              <div className="absolute top-full left-0 z-20 mt-1 w-56 max-h-60 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl">
                <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-xs text-slate-700 border-b border-slate-200">
                  <input type="checkbox" checked={current === 'all'} onChange={() => { set(key, 'all'); setOpenDrop(null); }}
                    className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  All {label}s
                </label>
                {options.map(opt => (
                  <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-xs text-slate-700">
                    <input type="checkbox" checked={current === opt.value} onChange={() => handleSelect(key, opt.value)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                    {opt.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
        {/* Date From */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Date From</label>
          <input type="date" value={filters.dateFrom} onChange={e => set('dateFrom', e.target.value)}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-400 outline-none" />
        </div>
        {/* Date To */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Date To</label>
          <input type="date" value={filters.dateTo} onChange={e => set('dateTo', e.target.value)}
            className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-indigo-400 outline-none" />
        </div>
        {/* Toggle pills */}
        <div className="flex gap-2 items-end pb-0.5">
          <button onClick={() => set('slaOnly', !filters.slaOnly)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${filters.slaOnly ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-slate-600 border-slate-300 hover:border-orange-400'}`}>
            SLA Breached only
          </button>
          <button onClick={() => set('staleOnly', !filters.staleOnly)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${filters.staleOnly ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-slate-600 border-slate-300 hover:border-amber-400'}`}>
            Stale &gt; 7 days
          </button>
          <button onClick={() => set('kpiFilter', filters.kpiFilter === 'linked' ? null : 'linked')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${filters.kpiFilter === 'linked' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:border-indigo-400'}`}>
            Has internal link
          </button>
          <button onClick={() => set('kpiFilter', filters.kpiFilter === 'unlinked' ? null : 'unlinked')}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${filters.kpiFilter === 'unlinked' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-500'}`}>
            No internal link
          </button>
        </div>
        {isFiltersActive(filters) && (
          <button onClick={() => setFilters(DEFAULT_FILTERS)}
            className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-red-600 border border-slate-300 bg-white rounded-lg hover:border-red-300 transition-colors">
            Clear All
          </button>
        )}
      </div>
      {filters.kpiFilter && (
        <div className="mt-2 flex items-center gap-2 text-xs text-indigo-700">
          <span className="px-2 py-0.5 bg-indigo-100 rounded-full font-semibold">Filtered by: {filters.kpiFilter}</span>
          <button onClick={() => set('kpiFilter', null)} className="text-indigo-500 hover:text-red-500">✕ clear</button>
        </div>
      )}
    </div>
  );
}

// ─── KPI Row ──────────────────────────────────────────────────────────────────

function KPICard({ label, value, color, sub, active, onClick, badge }) {
  return (
    <button onClick={onClick}
      className={`bg-white rounded-xl p-3 border shadow-sm text-left w-full transition-all hover:shadow-md ${active ? 'ring-2 ring-blue-500 border-blue-400' : 'border-slate-200 hover:border-indigo-300'}`}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mt-0.5 leading-tight">{label}</div>
      {sub && <div className="text-xs text-slate-400 mt-0.5">{sub}</div>}
      {active && <div className="text-xs text-blue-600 mt-0.5 font-semibold">✓ active</div>}
    </button>
  );
}

function KPIRow({ filtered, allIssues, filters, setFilters }) {
  const kpis = useMemo(() => {
    const now = new Date();
    const h24  = new Date(now - 86400000);
    const d7   = new Date(now - 7  * 86400000);
    const d30  = new Date(now - 30 * 86400000);
    const new24h  = filtered.filter(i => i.created && new Date(i.created) >= h24).length;
    const new7    = filtered.filter(i => i.created && new Date(i.created) >= d7).length;
    const new30   = filtered.filter(i => i.created && new Date(i.created) >= d30).length;
    const open    = filtered.filter(i => !['Completed','Closed'].includes(i.status) && i.statusCat !== 'Done').length;
    const wip     = filtered.filter(i => i.statusCat === 'In Progress').length;
    const completed = filtered.filter(i => ['Completed','Closed'].includes(i.status) || i.statusCat === 'Done').length;
    const atRisk    = filtered.filter(i => i.slaRisk === 'at-risk').length;
    const breaching = filtered.filter(i => i.slaRisk === 'breaching').length;
    const linked    = filtered.filter(i => i.internalLinks && i.internalLinks.length > 0).length;
    const resolvedTickets = filtered.filter(i => i.resolved && i.created);
    const avgRes = resolvedTickets.length
      ? Math.round(resolvedTickets.reduce((s,i) => s + (new Date(i.resolved) - new Date(i.created)) / 86400000, 0) / resolvedTickets.length)
      : null;
    return { total: filtered.length, new24h, new7, new30, open, wip, completed, atRisk, breaching, linked, avgRes };
  }, [filtered]);

  const toggle = (key) => setFilters(f => ({ ...f, kpiFilter: f.kpiFilter === key ? null : key }));
  const a = filters.kpiFilter;
  const new24hColor = kpis.new24h === 0 ? 'text-green-600' : kpis.new24h <= 5 ? 'text-amber-600' : 'text-red-600';

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 lg:grid-cols-11 gap-2">
      <KPICard label="Total"       value={kpis.total}     color="text-slate-700"   active={false}          onClick={() => setFilters(f => ({...f, kpiFilter: null}))} />
      <KPICard label="New (24h)"   value={kpis.new24h}    color={new24hColor}      active={a==='new24h'}   onClick={() => toggle('new24h')} />
      <KPICard label="New (7d)"    value={kpis.new7}      color="text-blue-600"    active={a==='new7'}     onClick={() => toggle('new7')} />
      <KPICard label="New (30d)"   value={kpis.new30}     color="text-indigo-600"  active={a==='new30'}    onClick={() => toggle('new30')} />
      <KPICard label="Open"        value={kpis.open}      color="text-amber-600"   active={a==='open'}     onClick={() => toggle('open')} />
      <KPICard label="In Progress" value={kpis.wip}       color="text-blue-500"    active={a==='wip'}      onClick={() => toggle('wip')} />
      <KPICard label="Completed"   value={kpis.completed} color="text-green-600"   active={a==='completed'} onClick={() => toggle('completed')} />
      <KPICard label="Avg Res."    value={fmtDays(kpis.avgRes)} color="text-purple-600" sub="calendar days" active={false} onClick={() => {}} />
      <KPICard label="At Risk"     value={kpis.atRisk}    color="text-amber-600"   active={a==='at-risk'}  onClick={() => toggle('at-risk')} />
      <KPICard label="Breaching"   value={kpis.breaching} color="text-red-600"     active={a==='breaching'} onClick={() => toggle('breaching')} />
      <KPICard label="Linked"      value={kpis.linked}    color="text-indigo-600"  active={a==='linked'}   onClick={() => toggle('linked')} sub="has internal ref" />
    </div>
  );
}

// ─── SLA Summary Bar ─────────────────────────────────────────────────────────

function SLASummaryBar({ issues }) {
  const breached  = issues.filter(t => t.jiraBreached || t.slaRisk === 'breaching').length;
  const atRisk    = issues.filter(t => !t.jiraBreached && t.slaRisk === 'at-risk').length;
  const onTrack   = issues.filter(t => t.slaRisk === 'on-track').length;
  const hasLiveData = issues.some(t => t.jiraSLA);

  if (!hasLiveData && breached === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-4 px-4 py-3 bg-slate-800 rounded-xl border border-slate-700 text-sm">
      <span className="text-slate-400 text-xs font-semibold uppercase tracking-wide">
        {hasLiveData ? 'Live Jira SLA' : 'Calculated SLA'}
      </span>
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block"></span>
        <span className="text-red-400 font-bold">{breached}</span>
        <span className="text-slate-400">Breached</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
        <span className="text-amber-400 font-bold">{atRisk}</span>
        <span className="text-slate-400">At Risk</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block"></span>
        <span className="text-green-400 font-bold">{onTrack}</span>
        <span className="text-slate-400">On Track</span>
      </div>
      {breached > 0 && (
        <span className="ml-auto text-xs text-red-400 font-semibold animate-pulse">
          ⚠ {breached} ticket{breached !== 1 ? 's' : ''} breaching SLA
        </span>
      )}
    </div>
  );
}

// ─── SLA Progress Bar ─────────────────────────────────────────────────────────

function SLABar({ ticket }) {
  const isClosed = ['Completed','Closed'].includes(ticket.status) || ticket.statusCat === 'Done';
  const target = ticket.slaTarget || 14;
  const pct = isClosed ? Math.min(100, Math.round((ticket.age / target) * 100)) : Math.round((ticket.age / target) * 100);
  const displayPct = Math.min(100, pct); // cap bar at 100% visually
  // Badge and bar must agree — use slaRisk as single source of truth
  const color = isClosed ? 'bg-green-500' : ticket.slaRisk === 'breaching' ? 'bg-red-500' : ticket.slaRisk === 'at-risk' ? 'bg-amber-500' : 'bg-green-500';
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${displayPct}%` }} />
      </div>
      <span className="text-xs text-slate-500 whitespace-nowrap">{ticket.age}d/{target}d</span>
    </div>
  );
}

// ─── Bank Breakdown Panel ─────────────────────────────────────────────────────

const BANK_COLORS = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6','#f97316','#84cc16'];

function BankBreakdownPanel({ filtered, filters, setFilters, excludeLegacy }) {
  const [expandedUnknown, setExpandedUnknown] = useState(false);

  const bankStats = useMemo(() => {
    const cutoff = excludeLegacy ? new Date(Date.now() - LEGACY_CUTOFF_YEARS * 365 * 86400000) : null;
    const map = {};
    filtered.forEach(t => {
      const b = t.bank || 'Unknown';
      if (!map[b]) map[b] = { bank: b, total: 0, open: 0, inProgress: 0, completed: 0, onTrack: 0, atRisk: 0, breaching: 0, resTimes: [] };
      map[b].total++;
      if (['Completed','Closed'].includes(t.status) || t.statusCat === 'Done') map[b].completed++;
      else if (t.statusCat === 'In Progress') map[b].inProgress++;
      else map[b].open++;
      if (t.slaRisk === 'on-track')  map[b].onTrack++;
      if (t.slaRisk === 'at-risk')   map[b].atRisk++;
      if (t.slaRisk === 'breaching') map[b].breaching++;
      if (t.resolved && t.created && (!cutoff || new Date(t.created) >= cutoff))
        map[b].resTimes.push(Math.floor((new Date(t.resolved) - new Date(t.created)) / 86400000));
    });
    return Object.values(map)
      .map(s => ({ ...s, avgResolution: s.resTimes.length ? Math.round(s.resTimes.reduce((a,v)=>a+v,0)/s.resTimes.length) : null }))
      .sort((a,b) => b.total - a.total);
  }, [filtered, excludeLegacy]);

  const unknownDomains = useMemo(() => {
    const dc = {};
    filtered.filter(t => t.bank === 'Unknown' || !t.bank).forEach(t => {
      const email = t.reporterEmail || '';
      const domain = email.includes('@') ? email.split('@')[1] : '(no email)';
      dc[domain] = (dc[domain]||0) + 1;
    });
    return Object.entries(dc).sort((a,b) => b[1]-a[1]).slice(0, 10);
  }, [filtered]);

  const activeBank = filters.bank;
  const clickBank = (bank) => setFilters(f => ({ ...f, bank: f.bank === bank ? 'all' : bank }));

  if (bankStats.length === 0) return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-2">Bank / Client Breakdown</h3>
      <p className="text-sm text-slate-400">No data available.</p>
    </div>
  );

  // Overall SLA health dot per bank
  const healthDot = (s) => {
    if (s.breaching > s.atRisk && s.breaching > s.onTrack) return '🔴';
    if (s.atRisk > s.onTrack) return '🟡';
    return '🟢';
  };

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-4">Bank / Client Breakdown</h3>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 min-w-0" style={{ height: Math.max(200, bankStats.length * 40) }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart layout="vertical" data={bankStats} margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="bank" width={130} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => [v, 'Total']} />
              <Bar dataKey="total" radius={[0,4,4,0]} onClick={(d) => clickBank(d.bank)}>
                {bankStats.map((entry, idx) => (
                  <Cell key={entry.bank} fill={BANK_COLORS[idx % BANK_COLORS.length]}
                    opacity={activeBank === 'all' || activeBank === entry.bank ? 1 : 0.4} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto">
          <table className="text-xs w-full min-w-max">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-3 py-2 text-left font-semibold text-slate-600">Bank</th>
                <th className="px-3 py-2 text-center font-semibold text-slate-600">Total</th>
                <th className="px-3 py-2 text-center font-semibold text-amber-600">Open</th>
                <th className="px-3 py-2 text-center font-semibold text-blue-600">WIP</th>
                <th className="px-3 py-2 text-center font-semibold text-green-600">Done</th>
                <th className="px-3 py-2 text-center font-semibold text-purple-600" title="Avg resolution days for resolved tickets (legacy >2yr excluded when toggle is on)">Avg Res. ⓘ</th>
                <th className="px-3 py-2 text-center font-semibold text-green-600">On Track</th>
                <th className="px-3 py-2 text-center font-semibold text-amber-600">At Risk</th>
                <th className="px-3 py-2 text-center font-semibold text-red-600">Breaching</th>
                <th className="px-3 py-2 text-center font-semibold text-slate-600">SLA Health</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bankStats.map(s => (
                <React.Fragment key={s.bank}>
                  <tr onClick={() => { clickBank(s.bank); if (s.bank === 'Unknown') setExpandedUnknown(v => !v); }}
                    className={`cursor-pointer transition-colors ${activeBank === s.bank ? 'bg-indigo-50 ring-1 ring-indigo-300' : 'hover:bg-slate-50'}`}>
                    <td className="px-3 py-1.5 font-medium text-slate-800">
                      <span className="mr-1">{healthDot(s)}</span>{s.bank}
                      {s.bank === 'Unknown' && <span className="ml-1 text-slate-400">{expandedUnknown ? '▲' : '▼'}</span>}
                      {activeBank === s.bank && <span className="ml-1 text-indigo-500 text-xs">✓</span>}
                    </td>
                    <td className="px-3 py-1.5 text-center font-bold text-slate-700">{s.total}</td>
                    <td className="px-3 py-1.5 text-center text-amber-600">{s.open}</td>
                    <td className="px-3 py-1.5 text-center text-blue-600">{s.inProgress}</td>
                    <td className="px-3 py-1.5 text-center text-green-600">{s.completed}</td>
                    <td className="px-3 py-1.5 text-center text-purple-600">{s.avgResolution !== null ? `${s.avgResolution}d` : '—'}</td>
                    <td className="px-3 py-1.5 text-center"><span className="px-1.5 py-0.5 bg-green-100 text-green-800 rounded font-semibold">{s.onTrack}</span></td>
                    <td className="px-3 py-1.5 text-center"><span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-semibold">{s.atRisk}</span></td>
                    <td className="px-3 py-1.5 text-center"><span className="px-1.5 py-0.5 bg-red-100 text-red-800 rounded font-semibold">{s.breaching}</span></td>
                    <td className="px-3 py-1.5">
                      <div className="w-20 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${s.total > 0 ? Math.round((s.onTrack/s.total)*100) : 0}%` }} />
                      </div>
                    </td>
                  </tr>
                  {s.bank === 'Unknown' && expandedUnknown && unknownDomains.length > 0 && (
                    <tr className="bg-slate-50">
                      <td colSpan="10" className="px-4 py-2">
                        <div className="text-xs font-semibold text-slate-500 mb-1">Top unrecognised domains — add to DOMAIN_MAP to fix:</div>
                        <div className="flex flex-wrap gap-1.5">
                          {unknownDomains.map(([domain, count]) => (
                            <span key={domain} className="px-2 py-0.5 bg-white border border-slate-200 rounded text-xs text-slate-700">
                              {domain} <span className="font-bold">({count})</span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Resolution Stats Panel ───────────────────────────────────────────────────

function ResolutionStatsPanel({ filtered, excludeLegacy }) {
  const stats = useMemo(() => computeResolutionStats(filtered, excludeLegacy), [filtered, excludeLegacy]);
  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
      <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide mb-4">
        Resolution Time Statistics
        {excludeLegacy && <span className="ml-2 text-xs font-normal text-slate-400">(legacy &gt;2yr excluded)</span>}
      </h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {[
          { label: 'Average',  val: stats.avg,    color: 'text-purple-600' },
          { label: 'Median',   val: stats.median, color: 'text-indigo-600' },
          { label: 'Fastest',  val: stats.min,    color: 'text-green-600',  tooltip: stats.min === 0 ? 'Same-day resolution' : undefined },
          { label: 'Slowest',  val: stats.max,    color: 'text-red-600' },
        ].map(({ label, val, color, tooltip }) => (
          <div key={label} className="text-center" title={tooltip}>
            <div className={`text-2xl font-bold ${color}`}>{fmtDays(val)}</div>
            <div className="text-xs text-slate-500 mt-0.5">{label}{tooltip ? ' ⓘ' : ''}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-6">
        <div>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">SLA Breaches: </span>
          <span className={`text-sm font-bold ${stats.slaBreachCount > 0 ? 'text-red-600' : 'text-slate-700'}`}>{stats.slaBreachCount}</span>
        </div>
        {stats.byProject.length > 0 && (
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Avg by Project</div>
            <div className="flex flex-wrap gap-2">
              {stats.byProject.map(p => (
                <div key={p.project} className="px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                  <span className="font-semibold text-slate-700">{p.project}</span>
                  <span className="text-slate-500 ml-1">{fmtDays(p.avg)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stale Panel ──────────────────────────────────────────────────────────────

function StalePanel({ filtered, selectedKeys, setSelectedKeys }) {
  const [showAll, setShowAll] = useState(false);
  const [sortBy, setSortBy]   = useState('updated');
  const cutoffDate = useMemo(() => {
    if (showAll) return null;
    const d = new Date(); d.setDate(d.getDate() - STALE_DEFAULT_DAYS); return d;
  }, [showAll]);

  const staleTickets = useMemo(() => {
    let tickets = filtered.filter(t => t.isStale);
    if (cutoffDate) tickets = tickets.filter(t => !t.created || new Date(t.created) >= cutoffDate);
    return tickets.sort((a, b) => {
      if (sortBy === 'age') return b.age - a.age;
      return (b.updated ? new Date(b.updated).getTime() : 0) - (a.updated ? new Date(a.updated).getTime() : 0);
    });
  }, [filtered, cutoffDate, sortBy]);

  const totalStale = filtered.filter(t => t.isStale).length;

  const allKeys = staleTickets.map(t => t.key);
  const allSelected = allKeys.length > 0 && allKeys.every(k => selectedKeys.has(k));
  const toggleAll = () => {
    if (allSelected) setSelectedKeys(prev => { const n = new Set(prev); allKeys.forEach(k => n.delete(k)); return n; });
    else setSelectedKeys(prev => { const n = new Set(prev); allKeys.forEach(k => n.add(k)); return n; });
  };
  const toggleRow = (key) => setSelectedKeys(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
  });

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">
          Stale Tickets
          {staleTickets.length > 0 && <span className="ml-1 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-bold">{staleTickets.length}</span>}
          {!showAll && totalStale > staleTickets.length && <span className="ml-2 text-xs font-normal text-slate-400">({totalStale - staleTickets.length} legacy hidden)</span>}
        </h3>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 text-xs text-slate-500">
            Sort:
            <button onClick={() => setSortBy('updated')} className={`px-2 py-0.5 rounded ${sortBy==='updated' ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'hover:bg-slate-100'}`}>Last Updated</button>
            <button onClick={() => setSortBy('age')}     className={`px-2 py-0.5 rounded ${sortBy==='age'     ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'hover:bg-slate-100'}`}>Age</button>
          </div>
          <button onClick={() => setShowAll(v => !v)} className="text-xs text-slate-500 hover:text-indigo-600 border border-slate-200 rounded px-2 py-0.5">
            {showAll ? 'Hide legacy' : 'Show all incl. legacy'}
          </button>
          <button onClick={() => exportCSV(staleTickets, `CSR_stale_tickets_${new Date().toISOString().slice(0,10)}.csv`)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-600 hover:bg-slate-50 font-medium bg-white">
            <Download className="w-3.5 h-3.5" />Export CSV
          </button>
        </div>
      </div>
      {staleTickets.length === 0 ? (
        <p className="text-sm text-slate-400">No stale tickets found{!showAll ? ' in the last 180 days' : ''}.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600 uppercase font-bold">
              <tr>
                <th className="px-3 py-2 text-center w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                </th>
                <th className="px-3 py-2 text-left">Key</th>
                <th className="px-3 py-2 text-left">Summary</th>
                <th className="px-3 py-2 text-left">Assignee</th>
                <th className="px-3 py-2 text-left">Reporter</th>
                <th className="px-3 py-2 text-left">Bank</th>
                <th className="px-3 py-2 text-left min-w-[120px]">Internal Ref</th>
                <th className="px-3 py-2 text-center">Age</th>
                <th className="px-3 py-2 text-left">SLA</th>
                <th className="px-3 py-2 text-left">Progress</th>
                <th className="px-3 py-2 text-left">Last Updated</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {staleTickets.map(t => {
                const slaStyle = SLA_RISK_STYLES[t.slaRisk] || SLA_RISK_STYLES['on-track'];
                const borderColor = t.slaRisk === 'breaching' ? '#ef4444' : t.slaRisk === 'at-risk' ? '#f59e0b' : '#22c55e';
                const primaryLink = t.internalLinks?.[0];
                return (
                  <tr key={t.key} className={`hover:bg-slate-50 ${selectedKeys.has(t.key) ? 'bg-blue-50' : ''}`} style={{ borderLeft: `4px solid ${borderColor}` }}>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" checked={selectedKeys.has(t.key)} onChange={() => toggleRow(t.key)}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-red-600 whitespace-nowrap">{t.key}</td>
                    <td className="px-3 py-2 text-slate-700 max-w-xs truncate" title={t.summary}>{t.summary}</td>
                    <td className={`px-3 py-2 whitespace-nowrap ${t.assignee === 'Unassigned' && t.slaRisk !== 'on-track' ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>{t.assignee}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-500">{t.reporter || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{t.bank}</td>
                    <td className="px-3 py-2 whitespace-nowrap min-w-[120px]">
                      {primaryLink ? (
                        <div className="flex items-center gap-1.5">
                          <a href={`https://advancedinformationservices.atlassian.net/browse/${primaryLink.key}`} target="_blank" rel="noopener noreferrer"
                            className="text-blue-600 font-mono font-medium hover:underline text-xs">{primaryLink.key}</a>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-bold border ${internalStatusBadge(primaryLink.status)}`}>{primaryLink.status}</span>
                        </div>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="px-3 py-2 text-center font-semibold text-amber-700">{t.age}d</td>
                    <td className="px-3 py-2"><span className={`px-1.5 py-0.5 rounded text-xs font-bold border ${slaStyle.badge}`}>{slaStyle.label}</span></td>
                    <td className="px-3 py-2"><SLABar ticket={t} /></td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap text-xs">{t.updated ? new Date(t.updated).toLocaleDateString('en-GB') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Stand-up Panel ───────────────────────────────────────────────────────────

function StandupPanel({ issues }) {
  const [report, setReport] = useState(null);
  const [copied, setCopied] = useState(false);
  const [err, setErr]       = useState('');

  const generate = () => { try { setReport(generateStandupReport(issues)); setErr(''); } catch(e) { setErr(e.message); } };
  const handlePrint = () => { try { window.print(); } catch(e) { setErr('PDF failed: ' + e.message); } };
  const handleCopy = async () => {
    if (!report) return;
    try { await navigator.clipboard.writeText(serializeStandupToText(report)); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch(e) { setErr('Clipboard failed: ' + e.message); }
  };

  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Stand-up Report</h3>
        <button onClick={generate} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 text-sm font-medium">
          <FileText className="w-4 h-4" />Generate Stand-up Report
        </button>
      </div>
      {err && <div className="mb-3 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"><AlertCircle className="w-4 h-4 flex-shrink-0" />{err}</div>}
      {report && (
        <>
          <div className="flex gap-2 mb-4">
            <button onClick={handlePrint} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50"><Printer className="w-4 h-4" />Export as PDF</button>
            <button onClick={handleCopy} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
              {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}{copied ? 'Copied!' : 'Copy to Clipboard'}
            </button>
          </div>
          <div className="print-section space-y-3">
            <div className="text-xs text-slate-400">Generated {report.generatedAt.toLocaleString('en-GB')}</div>
            {[
              { label: `New Today (${report.newToday.length})`,           items: report.newToday,        bg: 'bg-blue-50',   border: 'border-blue-200',  text: 'text-blue-800',  sub: 'text-blue-700' },
              { label: `Closed Yesterday (${report.closedYesterday.length})`, items: report.closedYesterday, bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-800', sub: 'text-green-700' },
            ].map(({ label, items, bg, border, text, sub }) => (
              <div key={label} className={`p-4 ${bg} border ${border} rounded-lg`}>
                <div className={`text-sm font-bold ${text} mb-2`}>{label}</div>
                {items.length === 0 ? <p className={`text-sm ${sub}`}>None</p> : <ul className="space-y-0.5">{items.map(t => <li key={t.key} className={`text-sm ${sub}`}><span className="font-mono font-bold">{t.key}</span>: {t.summary}</li>)}</ul>}
              </div>
            ))}
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="text-sm font-bold text-amber-800 mb-2">In Progress by Assignee</div>
              {report.inProgressByAssignee.length === 0 ? <p className="text-sm text-amber-600">None</p> :
                <ul className="space-y-0.5">{report.inProgressByAssignee.map(({ assignee, count }) => <li key={assignee} className="text-sm text-amber-700"><span className="font-semibold">{assignee}</span>: {count} ticket{count!==1?'s':''}</li>)}</ul>}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-center">
                <div className="text-2xl font-bold text-amber-600">{report.atRisk}</div>
                <div className="text-xs font-semibold text-amber-700 mt-0.5">At Risk</div>
              </div>
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-center">
                <div className="text-2xl font-bold text-red-600">{report.breaching}</div>
                <div className="text-xs font-semibold text-red-700 mt-0.5">Breaching SLA</div>
              </div>
            </div>
            {report.topBank && (
              <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
                <div className="text-sm font-bold text-indigo-800 mb-1">Top Reporting Bank This Week</div>
                <p className="text-sm text-indigo-700"><span className="font-semibold">{report.topBank[0]}</span>: {report.topBank[1]} tickets</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Internal link badge ──────────────────────────────────────────────────────

const JIRA_BASE = 'https://advancedinformationservices.atlassian.net';

function internalStatusBadge(status) {
  const s = (status || '').toLowerCase();
  if (s === 'done' || s === 'completed' || s === 'closed') return 'bg-green-100 text-green-800 border-green-300';
  if (s.includes('progress')) return 'bg-blue-100 text-blue-800 border-blue-300';
  return 'bg-slate-100 text-slate-600 border-slate-300';
}

// ─── Ticket Table ─────────────────────────────────────────────────────────────

function statusBadgeClass(status) {
  const s = (status || '').toLowerCase();
  if (s === 'open' || s === 'to do') return 'bg-blue-100 text-blue-800 border-blue-300';
  if (s.includes('progress') || s === 'work in progress') return 'bg-amber-100 text-amber-800 border-amber-300';
  if (s === 'completed' || s === 'done' || s === 'closed') return 'bg-green-100 text-green-800 border-green-300';
  return 'bg-slate-100 text-slate-700 border-slate-300';
}

function TicketTable({ filtered, selectedKeys, setSelectedKeys, onExportSelected }) {
  const [sortCol, setSortCol] = useState('updated');
  const [sortDir, setSortDir] = useState('desc');
  const [expandedKey, setExpandedKey] = useState(null);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('desc'); }
  };

  const slaOrder = { 'breaching': 0, 'at-risk': 1, 'on-track': 2 };

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortCol === 'age')        cmp = (a.age || 0) - (b.age || 0);
      else if (sortCol === 'sla')   cmp = (slaOrder[a.slaRisk] ?? 2) - (slaOrder[b.slaRisk] ?? 2);
      else if (sortCol === 'key')   cmp = (a.key || '').localeCompare(b.key || '');
      else if (sortCol === 'summary') cmp = (a.summary || '').localeCompare(b.summary || '');
      else if (sortCol === 'assignee') cmp = (a.assignee || '').localeCompare(b.assignee || '');
      else if (sortCol === 'reporter') cmp = (a.reporter || '').localeCompare(b.reporter || '');
      else if (sortCol === 'bank')  cmp = (a.bank || '').localeCompare(b.bank || '');
      else if (sortCol === 'status') cmp = (a.status || '').localeCompare(b.status || '');
      else if (sortCol === 'updated') cmp = (a.updated || '').localeCompare(b.updated || '');
      else if (sortCol === 'created') cmp = (a.created || '').localeCompare(b.created || '');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const visible = sorted.slice(0, 200);

  /** Returns sort indicator arrow for a column header */
  const sortIcon = (col) => {
    if (sortCol !== col) return <span className="ml-1 text-slate-300">↕</span>;
    return <span className="ml-1 text-indigo-500">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  /** Shared class for sortable header cells */
  const thSort = 'px-4 py-3 text-left cursor-pointer hover:text-indigo-600 hover:bg-slate-100 select-none transition-colors';
  const thFixed = 'px-4 py-3 text-left';

  const allVisibleKeys = visible.map(t => t.key);
  const allSelected = allVisibleKeys.length > 0 && allVisibleKeys.every(k => selectedKeys.has(k));

  const toggleAll = () => {
    if (allSelected) setSelectedKeys(prev => { const n = new Set(prev); allVisibleKeys.forEach(k => n.delete(k)); return n; });
    else setSelectedKeys(prev => { const n = new Set(prev); allVisibleKeys.forEach(k => n.add(k)); return n; });
  };

  const toggleRow = (key) => setSelectedKeys(prev => {
    const n = new Set(prev);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Tickets</h3>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <span className="w-3 h-3 rounded-sm bg-green-500 inline-block"></span>On Track
            <span className="w-3 h-3 rounded-sm bg-amber-500 inline-block ml-2"></span>At Risk
            <span className="w-3 h-3 rounded-sm bg-red-500 inline-block ml-2"></span>Breaching
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400">Showing {visible.length} of {filtered.length}</span>
          <button onClick={() => exportCSV(filtered)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg text-xs text-slate-600 hover:bg-slate-50 font-medium">
            <Download className="w-3.5 h-3.5" />Export all (CSV)
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth: '1300px' }}>
          <thead className="bg-slate-50 text-xs text-slate-600 uppercase font-bold border-b border-slate-200">
            <tr>
              <th className="px-3 py-3 text-center w-10">
                <input type="checkbox" checked={allSelected} onChange={toggleAll}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
              </th>
              <th className={thSort} onClick={() => toggleSort('key')}>Key{sortIcon('key')}</th>
              <th className={thSort} onClick={() => toggleSort('summary')}>Summary / Bank{sortIcon('summary')}</th>
              <th className={thSort} onClick={() => toggleSort('assignee')}>Assignee{sortIcon('assignee')}</th>
              <th className={thSort} onClick={() => toggleSort('reporter')}>Reporter{sortIcon('reporter')}</th>
              <th className={thFixed} style={{ minWidth: '120px' }}>Internal Ref</th>
              <th className={thSort} onClick={() => toggleSort('status')}>Status{sortIcon('status')}</th>
              <th className={`${thSort} text-center`} onClick={() => toggleSort('age')}>Age{sortIcon('age')}</th>
              <th className={thSort} onClick={() => toggleSort('sla')}>SLA{sortIcon('sla')}</th>
              <th className={thFixed}>Progress</th>
              <th className={thSort} onClick={() => toggleSort('updated')}>Last Updated{sortIcon('updated')}</th>
              <th className={thSort} onClick={() => toggleSort('created')}>Created{sortIcon('created')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.length === 0 ? (
              <tr><td colSpan="12" className="px-4 py-8 text-center text-slate-400">No tickets match the current filters.</td></tr>
            ) : visible.map(t => {
              const slaStyle = SLA_RISK_STYLES[t.slaRisk] || SLA_RISK_STYLES['on-track'];
              const isSelected = selectedKeys.has(t.key);
              const isExpanded = expandedKey === t.key;
              const primaryLink = t.internalLinks?.[0];
              const borderColor = t.slaRisk === 'breaching' ? '#ef4444' : t.slaRisk === 'at-risk' ? '#f59e0b' : '#22c55e';
              return (
                <React.Fragment key={t.key}>
                  <tr className={`transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                    style={{ borderLeft: `4px solid ${borderColor}` }}>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" checked={isSelected} onChange={() => toggleRow(t.key)}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                    </td>
                    <td className="px-4 py-2 font-mono font-medium text-indigo-600 whitespace-nowrap cursor-pointer"
                      onClick={() => setExpandedKey(isExpanded ? null : t.key)}>
                      {t.key} {isExpanded ? '▲' : '▼'}
                    </td>
                    <td className="px-4 py-2 max-w-xs">
                      <div className="truncate text-slate-800 text-sm" title={t.summary}>{t.summary}</div>
                      <div className="text-xs text-slate-400">{t.bank} · {t.project}</div>
                    </td>
                    <td className={`px-4 py-2 whitespace-nowrap text-sm ${t.assignee === 'Unassigned' && t.slaRisk !== 'on-track' ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>{t.assignee}</td>
                    <td className="px-4 py-2 whitespace-nowrap text-sm text-slate-500">{t.reporter || '—'}</td>
                    <td className="px-4 py-2 whitespace-nowrap">
                      {primaryLink ? (
                        <div className="flex items-center gap-1.5">
                          <a href={`${JIRA_BASE}/browse/${primaryLink.key}`} target="_blank" rel="noopener noreferrer"
                            className="text-blue-600 font-mono font-medium hover:underline text-xs" onClick={e => e.stopPropagation()}>
                            {primaryLink.key}
                          </a>
                          <span className={`px-1.5 py-0.5 rounded text-xs font-bold border ${internalStatusBadge(primaryLink.status)}`}>{primaryLink.status}</span>
                        </div>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold border whitespace-nowrap ${statusBadgeClass(t.status)}`}>{t.status}</span>
                    </td>
                    <td className={`px-4 py-2 text-center font-semibold whitespace-nowrap ${t.isSLABreach ? 'text-red-600' : 'text-slate-700'}`}>{t.age}d</td>
                    <td className="px-4 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-bold border whitespace-nowrap ${slaStyle.badge}`}>{slaStyle.label}</span>
                      {t.slaRemaining && (
                        <div className="text-xs text-slate-400 mt-0.5 whitespace-nowrap">
                          {t.jiraBreached ? <span className="text-red-500 font-semibold">BREACHED</span> : `${t.slaRemaining} left`}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2"><SLABar ticket={t} /></td>
                    <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                      {t.updated ? new Date(t.updated).toLocaleDateString('en-GB') : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                      {t.created ? new Date(t.created).toLocaleDateString('en-GB') : '—'}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr className="bg-slate-50">
                      <td colSpan="11" className="px-6 py-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                          <div>
                            <div className="font-semibold text-slate-700 mb-2">Ticket Details</div>
                            <div className="space-y-1 text-xs text-slate-600">
                              <div><span className="font-medium">Reporter:</span> {t.reporter} ({t.reporterEmail})</div>
                              <div><span className="font-medium">Priority:</span> {t.priority}</div>
                              <div><span className="font-medium">Created:</span> {t.created ? new Date(t.created).toLocaleDateString('en-GB') : '—'}</div>
                              <div><span className="font-medium">Updated:</span> {t.updated ? new Date(t.updated).toLocaleDateString('en-GB') : '—'}</div>
                              <div><span className="font-medium">SLA Target:</span> {t.slaTarget}d ({t.slaRisk})</div>
                            </div>
                          </div>
                          {t.internalLinks && t.internalLinks.length > 0 && (
                            <div>
                              <div className="font-semibold text-slate-700 mb-2">Linked Internal Tickets ({t.internalLinks.length})</div>
                              <div className="space-y-2">
                                {t.internalLinks.map(link => (
                                  <div key={link.key} className="flex items-start gap-2 p-2 bg-white border border-slate-200 rounded-lg">
                                    <a href={`${JIRA_BASE}/browse/${link.key}`} target="_blank" rel="noopener noreferrer"
                                      className="text-blue-600 font-mono font-bold text-xs hover:underline whitespace-nowrap">
                                      {link.key}
                                    </a>
                                    <div className="flex-1 min-w-0">
                                      <div className="text-xs text-slate-700 truncate">{link.summary}</div>
                                      <div className="flex items-center gap-2 mt-0.5">
                                        <span className={`px-1.5 py-0.5 rounded text-xs font-bold border ${internalStatusBadge(link.status)}`}>{link.status}</span>
                                        <span className="text-xs text-slate-400">{link.assignee}</span>
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {(!t.internalLinks || t.internalLinks.length === 0) && (
                            <div>
                              <div className="font-semibold text-slate-700 mb-2">Linked Internal Tickets</div>
                              <p className="text-xs text-slate-400 italic">No internal ticket linked — this CSR ticket may not have been picked up as internal work.</p>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Module-level cache (survives tab switches / component unmount) ───────────

const AUTO_REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

const _csrCache = {
  issues: [],
  loading: false,
  error: '',
  lastFetch: null,
};
const _csrListeners = new Set();

function _csrNotify() {
  _csrListeners.forEach((fn) => fn({ ..._csrCache }));
}

let _csrAutoRefreshTimer = null;

async function _csrDoFetch() {
  if (_csrCache.loading) return;
  _csrCache.loading = true;
  _csrCache.error = '';
  _csrNotify();
  try {
    const raw = await fetchCSRIssues();
    const transformed = raw.map(transformCSRIssue);
    const slaData = await fetchSLABreaches(transformed);
    const withSLA = transformed.map(t => {
      const sla = slaData[t.key];
      if (!sla) return t;
      const responseBreached   = sla.firstResponse?.breached === true;
      const resolutionBreached = sla.resolution?.breached === true;
      const jiraBreached = responseBreached || resolutionBreached;
      const jiraAtRisk = !jiraBreached && (
        sla.firstResponse?.remaining?.includes('h') ||
        sla.resolution?.remaining?.includes('h')
      );
      return {
        ...t,
        jiraSLA: sla,
        jiraBreached,
        slaRisk: jiraBreached ? 'breaching' : (jiraAtRisk ? 'at-risk' : t.slaRisk),
        isSLABreach: jiraBreached || t.isSLABreach,
        slaRemaining: sla.resolution?.remaining || sla.firstResponse?.remaining || null,
        slaBreachTime: sla.resolution?.breachTime || sla.firstResponse?.breachTime || null,
      };
    });
    _csrCache.issues = withSLA;
    _csrCache.lastFetch = new Date();
  } catch (e) {
    _csrCache.error = e.message || 'Failed to load CSR tickets';
  } finally {
    _csrCache.loading = false;
    _csrNotify();
  }
}

function _csrEnsureAutoRefresh() {
  if (_csrAutoRefreshTimer) return;
  _csrAutoRefreshTimer = setInterval(() => { _csrDoFetch(); }, AUTO_REFRESH_INTERVAL_MS);
}

// ─── Main export ─────────────────────────────────────────────────────────────

export default function CSRTicketsTab() {
  const [, forceUpdate] = useState(0);
  const [filters, setFilters]             = useState(DEFAULT_FILTERS);
  const [excludeLegacy, setExcludeLegacy] = useState(true);
  const [selectedKeys, setSelectedKeys]   = useState(new Set());
  const [nextRefreshIn, setNextRefreshIn] = useState(null);
  const [searchQuery, setSearchQuery]     = useState('');

  // Read directly from the module cache on every render
  const issues    = _csrCache.issues;
  const loading   = _csrCache.loading;
  const error     = _csrCache.error;
  const lastFetch = _csrCache.lastFetch;

  // Subscribe to cache; fetch once if empty; start auto-refresh timer
  useEffect(() => {
    // Force a re-render whenever the cache changes
    const handler = () => forceUpdate(n => n + 1);
    _csrListeners.add(handler);
    if (_csrCache.issues.length === 0 && !_csrCache.loading) {
      _csrDoFetch();
    }
    _csrEnsureAutoRefresh();
    return () => { _csrListeners.delete(handler); };
  }, []);

  // Manual refresh
  const load = () => {
    _csrCache.loading = false; // allow re-entry
    _csrDoFetch();
  };

  // Countdown timer — updates every second
  useEffect(() => {
    const tick = () => {
      if (!_csrCache.lastFetch) { setNextRefreshIn(null); return; }
      const elapsed = Date.now() - _csrCache.lastFetch.getTime();
      const remaining = Math.max(0, Math.ceil((AUTO_REFRESH_INTERVAL_MS - elapsed) / 1000));
      setNextRefreshIn(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastFetch]);

  const filtered = useMemo(() => {
    let result = applyFilters(issues, filters);
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(t =>
        (t.key && t.key.toLowerCase().includes(q)) ||
        (t.summary && t.summary.toLowerCase().includes(q)) ||
        (t.assignee && t.assignee.toLowerCase().includes(q)) ||
        (t.bank && t.bank.toLowerCase().includes(q)) ||
        (t.reporter && t.reporter.toLowerCase().includes(q)) ||
        (t.project && t.project.toLowerCase().includes(q))
      );
    }
    return result;
  }, [issues, filters, searchQuery]);

  const selectedTickets = useMemo(
    () => filtered.filter(t => selectedKeys.has(t.key)),
    [filtered, selectedKeys]
  );

  return (
    <div className="space-y-6 p-2 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">CSR Tickets</h2>
          <p className="text-sm text-slate-500 mt-0.5">External Jira — client-raised requests · SLA: High 7d, Medium 14d, Low 30d</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {lastFetch && <span className="text-xs text-slate-400">Updated {lastFetch.toLocaleTimeString('en-GB')}</span>}
          {nextRefreshIn !== null && !loading && (
            <span className="text-xs text-slate-400">
              Auto-refresh in {Math.floor(nextRefreshIn / 60)}:{String(nextRefreshIn % 60).padStart(2, '0')}
            </span>
          )}
          <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer bg-white border border-slate-200 rounded-lg px-3 py-1.5">
            <input type="checkbox" checked={excludeLegacy} onChange={e => setExcludeLegacy(e.target.checked)} className="rounded" />
            Exclude legacy (&gt;2yr) from stats
          </label>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-50 text-sm font-medium">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}

      <FilterPanel issues={issues} filters={filters} setFilters={setFilters} />

      {/* Search bar */}
      <div className="relative">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search tickets (key, summary, assignee, bank, reporter...)"
          className="w-full px-4 py-2.5 pl-10 bg-white border border-slate-300 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 outline-none shadow-sm"
        />
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm">✕</button>
        )}
      </div>
      {/* SLA Summary Bar — live breach data from Jira */}
      <SLASummaryBar issues={issues} />
      <KPIRow filtered={filtered} allIssues={issues} filters={filters} setFilters={setFilters} />
      <BankBreakdownPanel filtered={filtered} filters={filters} setFilters={setFilters} excludeLegacy={excludeLegacy} />
      <ResolutionStatsPanel filtered={filtered} excludeLegacy={excludeLegacy} />
      <StalePanel filtered={filtered} selectedKeys={selectedKeys} setSelectedKeys={setSelectedKeys} />
      <StandupPanel issues={issues} />
      <TicketTable
        filtered={filtered}
        selectedKeys={selectedKeys}
        setSelectedKeys={setSelectedKeys}
        onExportSelected={() => exportCSV(selectedTickets, `CSR_tickets_export_${new Date().toISOString().slice(0,10)}.csv`)}
      />

      {/* Floating action bar */}
      {selectedKeys.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700">
          <span className="text-sm font-semibold">{selectedKeys.size} ticket{selectedKeys.size !== 1 ? 's' : ''} selected</span>
          <button
            onClick={() => exportCSV(selectedTickets, `CSR_tickets_export_${new Date().toISOString().slice(0,10)}.csv`)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium">
            <Download className="w-4 h-4" />Export selected (CSV)
          </button>
          <button onClick={() => setSelectedKeys(new Set())}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm">
            ✕ Clear
          </button>
        </div>
      )}
    </div>
  );
}
