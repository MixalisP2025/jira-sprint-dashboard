import React, { useMemo, useState } from 'react';
import { Download, Search, AlertTriangle, Copy, Check } from 'lucide-react';
import { f1, getKey, getSP, getStatus, getAssignee, getStart, getCreated, isDone, isTodoName, median, quantile } from '../utils/teamEngine';
import { workingDaysBetween } from '../utils/workingDays';

// The in-progress queue as a working list. This is the most actionable thing in the panel:
// a queue this old is a decision backlog, and it cannot be worked from a summary card.

const AGE_BANDS = [
  { key: 'all', label: 'Any age', test: () => true },
  { key: '20', label: '20+ working days', test: a => a != null && a > 20 },
  { key: '60', label: '60+ working days', test: a => a != null && a > 60 },
  { key: '120', label: '120+ working days', test: a => a != null && a > 120 },
];

const thStyle = { textAlign: 'left', padding: '7px 9px', fontSize: 9.5, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' };
const tdStyle = { textAlign: 'left', padding: '7px 9px', fontSize: 12, color: '#e2e8f0' };
const input = { background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: '#e2e8f0', padding: '6px 10px', fontSize: 12.5 };
const btn = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: '#cbd5e1', display: 'inline-flex', alignItems: 'center', gap: 6 };

const getSummary = t => t['Summary'] || t['Issue summary'] || '';
const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
const jqlStr = v => `"${String(v).replace(/(["\\])/g, '\\$1')}"`;

/**
 * The equivalent JQL for the current filters, so bulk changes happen in Jira's own issue
 * search where they belong. Deliberately a predicate, never a list of keys: the queue is
 * far larger than the ~150-key ceiling a practical JQL `key IN (...)` clause can carry,
 * and a truncated list would silently under-select.
 */
function buildJql({ project, statuses, band, assignee, q }) {
  const clauses = [];
  if (project && project !== 'all') clauses.push(`project = ${jqlStr(project)}`);
  if (statuses.length) clauses.push(`status IN (${statuses.map(jqlStr).join(', ')})`);
  if (band !== 'all') clauses.push(`updated < -${band}d`);
  if (assignee === 'Unassigned') clauses.push('assignee IS EMPTY');
  else if (assignee !== 'all') clauses.push(`assignee = ${jqlStr(assignee)}`);
  if (q.trim()) clauses.push(`text ~ ${jqlStr(q.trim())}`);
  return `${clauses.join(' AND ')} ORDER BY updated ASC`;
}

export default function TeamQueueTab({ scoped = [], today = new Date(), projectLabel = 'All projects', projectKey = 'all', staleThreshold = 20 }) {
  const [q, setQ] = useState('');
  const [band, setBand] = useState('all');
  const [assignee, setAssignee] = useState('all');
  const [sortCol, setSortCol] = useState('age');
  const [sortDir, setSortDir] = useState('desc');

  const items = useMemo(() => {
    const out = [];
    for (const t of scoped) {
      const status = getStatus(t);
      if (isDone(status) || isTodoName(status)) continue;
      const from = getStart(t) || getCreated(t);
      const d = from ? new Date(from) : null;
      const age = (d && !isNaN(d)) ? workingDaysBetween(d, today) : null;
      const u = t['Updated'] ? new Date(t['Updated']) : null;
      out.push({
        key: getKey(t),
        summary: getSummary(t),
        assignee: getAssignee(t) || 'Unassigned',
        status, sp: getSP(t), age,
        startedAt: d,
        idle: (u && !isNaN(u)) ? workingDaysBetween(u, today) : null,
      });
    }
    return out;
  }, [scoped, today]);

  const assignees = useMemo(() => ['all', ...[...new Set(items.map(i => i.assignee))].sort()], [items]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const bandTest = (AGE_BANDS.find(b => b.key === band) || AGE_BANDS[0]).test;
    const rows = items.filter(i =>
      bandTest(i.age)
      && (assignee === 'all' || i.assignee === assignee)
      && (!needle || i.key.toLowerCase().includes(needle) || i.summary.toLowerCase().includes(needle) || i.status.toLowerCase().includes(needle))
    );
    const val = r => ({ age: r.age ?? -1, idle: r.idle ?? -1, sp: r.sp, key: r.key, summary: r.summary, assignee: r.assignee, status: r.status }[sortCol]);
    rows.sort((a, b) => {
      const x = val(a), y = val(b);
      const cmp = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [items, q, band, assignee, sortCol, sortDir]);

  const stats = useMemo(() => {
    const ages = items.map(i => i.age).filter(Number.isFinite);
    const unassigned = items.filter(i => i.assignee === 'Unassigned');
    const unassignedAges = unassigned.map(i => i.age).filter(Number.isFinite);
    return {
      total: items.length,
      stale: items.filter(i => i.age != null && i.age > staleThreshold).length,
      median: ages.length ? median(ages) : null,
      p90: ages.length ? quantile(ages, 0.9) : null,
      oldest: ages.length ? Math.max(...ages) : null,
      unassigned: unassigned.length,
      unassignedMedian: unassignedAges.length ? median(unassignedAges) : null,
      unassignedOldest: unassignedAges.length ? Math.max(...unassignedAges) : null,
    };
  }, [items, staleThreshold]);

  const onSort = col => {
    if (col === sortCol) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortCol(col); setSortDir(col === 'key' || col === 'summary' || col === 'assignee' || col === 'status' ? 'asc' : 'desc'); }
  };

  const exportCsv = () => {
    const header = ['Key', 'Summary', 'Assignee', 'Status', 'Story points', 'Age (working days)', 'Days since update', 'Started'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of filtered) {
      lines.push([r.key, r.summary, r.assignee, r.status, r.sp, r.age ?? '', r.idle ?? '', r.startedAt ? r.startedAt.toISOString().slice(0, 10) : ''].map(csvCell).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `in-progress-queue-${projectLabel.replace(/[^\w]+/g, '-').toLowerCase()}-${today.toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const inProgressStatuses = useMemo(() => [...new Set(items.map(i => i.status))].sort(), [items]);
  const jql = useMemo(() => buildJql({
    project: projectKey, statuses: inProgressStatuses, band, assignee, q,
  }), [projectKey, inProgressStatuses, band, assignee, q]);
  const [copied, setCopied] = useState(false);
  const copyJql = async () => {
    try { await navigator.clipboard.writeText(jql); }
    catch {
      const ta = document.createElement('textarea');
      ta.value = jql; ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* nothing more to try */ }
      document.body.removeChild(ta);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  const Th = ({ col, children, align = 'left' }) => (
    <th style={{ ...thStyle, textAlign: align }} onClick={() => onSort(col)}>
      {children}{sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="tt-print-root">
      <div className="tt-print-header">
        <div style={{ fontSize: 18, fontWeight: 800 }}>In-progress queue</div>
        <div style={{ fontSize: 12 }}>{projectLabel} · generated {today.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
      </div>

      <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.28)', borderRadius: 12, padding: '14px 17px', marginBottom: 14, display: 'flex', gap: 11, alignItems: 'flex-start' }}>
        <AlertTriangle size={16} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: '#e2e8f0', lineHeight: 1.65 }}>
          <strong>{stats.stale} of {stats.total} open tickets have not moved in {staleThreshold}+ working days</strong>
          {stats.oldest != null && <>; the oldest has been open <strong>{f1(stats.oldest)} working days</strong></>}.
          {stats.unassigned > 0 && <> <strong>{stats.unassigned}</strong> are in progress with nobody assigned{stats.unassignedMedian != null && <>, typical age {f1(stats.unassignedMedian)} days{stats.unassignedOldest != null && <>, oldest {f1(stats.unassignedOldest)}</>}</>}.</>}
          <div style={{ color: '#94a3b8', marginTop: 5 }}>
            This is a decision backlog, not a work backlog. Each of these needs one of three answers — finish it, hand it on, or close it — and none of them is a throughput problem.
          </div>
        </div>
      </div>

      <div className="tt-no-print" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 16px', marginBottom: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#94a3b8' }}>
          <Search size={13} />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="key, summary or status" style={{ ...input, width: 230 }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#94a3b8' }}>Age
          <select value={band} onChange={e => setBand(e.target.value)} style={input}>
            {AGE_BANDS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#94a3b8' }}>Assignee
          <select value={assignee} onChange={e => setAssignee(e.target.value)} style={input}>
            {assignees.map(a => <option key={a} value={a}>{a === 'all' ? 'Everyone' : a}</option>)}
          </select>
        </label>
        <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 'auto' }}>{filtered.length} of {stats.total} shown</span>
        <button onClick={exportCsv} style={btn}><Download size={13} /> Export CSV</button>
      </div>

      {/* Bulk changes belong in Jira's own issue search, not behind a dashboard button. */}
      <div className="tt-no-print" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '12px 16px', marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 7 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1' }}>Same selection as JQL — run bulk changes in Jira</span>
          <button onClick={copyJql} style={{ ...btn, background: copied ? 'rgba(34,197,94,0.18)' : 'rgba(37,99,235,0.18)', borderColor: copied ? 'rgba(34,197,94,0.5)' : 'rgba(96,165,250,0.5)', color: copied ? '#86efac' : '#bfdbfe' }}>
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy JQL'}
          </button>
        </div>
        <code style={{ display: 'block', fontSize: 11.5, color: '#93c5fd', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '9px 11px', wordBreak: 'break-word', lineHeight: 1.6, fontFamily: 'ui-monospace, monospace' }}>{jql}</code>
        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 6, lineHeight: 1.6 }}>
          Paste into Jira's issue search, then use Jira's own bulk-change tools. This is a <strong style={{ color: '#94a3b8' }}>predicate</strong>, not a list of keys — a key list would hit JQL's practical ceiling of roughly 150 keys and silently miss the rest of a queue this size.
          {' '}<strong style={{ color: '#94a3b8' }}>Age</strong> filters here map to Jira's <code style={{ color: '#93c5fd' }}>updated</code>, which is last-touched rather than time-since-started, so the JQL selection will not match this table row for row.
          {' '}This dashboard holds no Jira write access and makes no changes on your behalf.
        </div>
      </div>

      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '4px 6px 10px' }}>
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead>
              <tr>
                <Th col="age" align="right">Age (days)</Th>
                <Th col="idle" align="right">Idle (days)</Th>
                <Th col="key">Key</Th>
                <Th col="summary">Summary</Th>
                <Th col="assignee">Assignee</Th>
                <Th col="status">Status</Th>
                <Th col="sp" align="right">SP</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.key} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ ...tdStyle, textAlign: 'right', color: r.age > 120 ? '#f87171' : r.age > staleThreshold ? '#fbbf24' : '#94a3b8', fontWeight: 600 }}>{r.age != null ? f1(r.age) : '—'}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#64748b' }}>{r.idle != null ? f1(r.idle) : '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: 'ui-monospace, monospace', color: '#93c5fd', whiteSpace: 'nowrap' }}>{r.key}</td>
                  <td style={tdStyle}>{r.summary}</td>
                  <td style={{ ...tdStyle, color: r.assignee === 'Unassigned' ? '#7dd3fc' : '#e2e8f0', whiteSpace: 'nowrap' }}>{r.assignee}</td>
                  <td style={{ ...tdStyle, color: '#94a3b8', whiteSpace: 'nowrap' }}>{r.status}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', color: '#94a3b8' }}>{r.sp || '—'}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={7} style={{ ...tdStyle, textAlign: 'center', color: '#6b7280', padding: '22px 0' }}>Nothing matches those filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 10, lineHeight: 1.6 }}>
        <strong style={{ color: '#94a3b8' }}>Age</strong> is working days since the ticket started (or was created, where no start date is set). <strong style={{ color: '#94a3b8' }}>Idle</strong> is working days since Jira last recorded any update to it. Export gives you exactly the rows shown, in the order shown.
        {' '}Bulk edits back into Jira are deliberately not offered here — changing status on {stats.stale} tickets is a decision that should be made ticket by ticket, not by a dashboard button.
      </div>
    </div>
  );
}
