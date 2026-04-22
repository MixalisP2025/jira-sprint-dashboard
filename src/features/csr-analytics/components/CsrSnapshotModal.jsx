import { useMemo, useState } from 'react';
import { X, Copy, Printer, Download, Filter } from 'lucide-react';

// ── Constants ────────────────────────────────────────────────────────────────
const H24  = 86400000;
const H7D  = 7  * H24;
const H30D = 30 * H24;
const H12M = 365 * H24;

// ── Pure helpers ─────────────────────────────────────────────────────────────
function countCreatedIn(tickets, ms) {
  const cutoff = Date.now() - ms;
  return tickets.filter(t => t.createdAt && new Date(t.createdAt).getTime() >= cutoff).length;
}
function countResolvedIn(tickets, ms) {
  const cutoff = Date.now() - ms;
  return tickets.filter(t => t.resolvedAt && new Date(t.resolvedAt).getTime() >= cutoff).length;
}
function medianDays(tickets) {
  const vals = tickets.filter(t => t.resolutionDays != null).map(t => t.resolutionDays).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  return Math.round(vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid]);
}
function topN(tickets, key, n = 8) {
  const map = {};
  tickets.forEach(t => { const v = t[key] || 'Unknown'; map[v] = (map[v] || 0) + 1; });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}
function pct(num, den) {
  if (!den) return '—';
  return `${Math.round((num / den) * 100)}%`;
}

// ── Report builder ───────────────────────────────────────────────────────────
function buildReport(tickets) {
  const now = new Date();
  const total    = tickets.length;
  const open     = tickets.filter(t => t.isOpen).length;
  const resolved = tickets.filter(t => t.isResolved).length;
  const onTrack  = tickets.filter(t => t.slaState === 'on-track').length;
  const atRisk   = tickets.filter(t => t.slaState === 'at-risk').length;
  const breaching = tickets.filter(t => t.slaState === 'breaching').length;
  const slaTotal = onTrack + atRisk + breaching;
  const over90   = tickets.filter(t => t.isOpen && t.ageDays >= 90).length;
  const unassigned = tickets.filter(t => t.isOpen && (!t.assignee || t.assignee === 'Unassigned' || t.assignee === '')).length;
  return {
    generatedAt: now, total, open, resolved,
    created24h: countCreatedIn(tickets, H24),
    created7d:  countCreatedIn(tickets, H7D),
    created30d: countCreatedIn(tickets, H30D),
    created12m: countCreatedIn(tickets, H12M),
    resolved24h: countResolvedIn(tickets, H24),
    resolved7d:  countResolvedIn(tickets, H7D),
    resolved30d: countResolvedIn(tickets, H30D),
    resolved12m: countResolvedIn(tickets, H12M),
    onTrack, atRisk, breaching, slaTotal,
    over90, unassigned,
    medRes: medianDays(tickets),
    byBank:     topN(tickets, 'bank'),
    byAssignee: topN(tickets.filter(t => t.isOpen), 'assignee'),
    byProject:  topN(tickets, 'project'),
    byStatus:   topN(tickets, 'status'),
  };
}

// ── HTML builder (for download + print/PDF) ──────────────────────────────────
function buildHtml(r, filterDesc) {
  const dateStr = r.generatedAt.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' });
  const row = (label, val) =>
    `<tr><td style="padding:6px 12px;color:#64748b;font-size:13px">${label}</td><td style="padding:6px 12px;font-weight:600;font-size:13px">${val}</td></tr>`;
  const tableRows = (entries) => entries.map(([k, v]) =>
    `<tr><td style="padding:5px 12px;font-size:13px">${k}</td><td style="padding:5px 12px;font-weight:600;font-size:13px;text-align:right">${v}</td></tr>`
  ).join('');
  const net = (c, res) => {
    const n = c - res;
    return `<span style="color:${n > 0 ? '#dc2626' : n < 0 ? '#16a34a' : '#64748b'};font-weight:700">${n > 0 ? '+' : ''}${n}</span>`;
  };
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>CSR Snapshot — ${dateStr}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:32px;color:#1e293b;background:#fff}
  h1{font-size:22px;margin:0 0 4px;color:#0f172a}
  .sub{color:#64748b;font-size:13px;margin-bottom:28px}
  h2{font-size:15px;font-weight:700;color:#0f172a;margin:24px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:6px}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
  .card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px}
  .card .val{font-size:26px;font-weight:700;color:#0f172a}
  .card .lbl{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-top:2px}
  table{width:100%;border-collapse:collapse}
  tr:nth-child(even) td{background:#f8fafc}
  th{background:#f1f5f9;padding:8px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600}
  td{padding:7px 12px;font-size:13px}
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:24px}
  .green{color:#16a34a;font-weight:700} .amber{color:#d97706;font-weight:700} .red{color:#dc2626;font-weight:700}
  @media print{body{padding:16px} @page{size:A4;margin:1cm}}
</style></head><body>
<h1>CSR Snapshot Report</h1>
<div class="sub">Generated: ${dateStr}${filterDesc ? ' &nbsp;·&nbsp; Filters: ' + filterDesc : ''} &nbsp;·&nbsp; ${r.total} tickets</div>
<h2>Executive Summary</h2>
<div class="grid">
  <div class="card"><div class="val">${r.total}</div><div class="lbl">Total Tickets</div></div>
  <div class="card"><div class="val" style="color:#d97706">${r.open}</div><div class="lbl">Open</div></div>
  <div class="card"><div class="val" style="color:#16a34a">${r.resolved}</div><div class="lbl">Resolved</div></div>
  <div class="card"><div class="val" style="color:#dc2626">${r.breaching}</div><div class="lbl">SLA Breaching</div></div>
  <div class="card"><div class="val">${r.created7d}</div><div class="lbl">Created (7 days)</div></div>
  <div class="card"><div class="val">${r.resolved7d}</div><div class="lbl">Resolved (7 days)</div></div>
  <div class="card"><div class="val">${r.over90}</div><div class="lbl">Open 90+ days</div></div>
  <div class="card"><div class="val">${r.unassigned}</div><div class="lbl">Unassigned Open</div></div>
</div>
<h2>Ticket Volume by Period</h2>
<table><thead><tr><th>Period</th><th style="text-align:right">Created</th><th style="text-align:right">Resolved</th><th style="text-align:right">Net</th></tr></thead><tbody>
  <tr><td>Last 24 hours</td><td style="text-align:right;font-weight:600">${r.created24h}</td><td style="text-align:right;font-weight:600">${r.resolved24h}</td><td style="text-align:right">${net(r.created24h,r.resolved24h)}</td></tr>
  <tr><td>Last 7 days</td><td style="text-align:right;font-weight:600">${r.created7d}</td><td style="text-align:right;font-weight:600">${r.resolved7d}</td><td style="text-align:right">${net(r.created7d,r.resolved7d)}</td></tr>
  <tr><td>Last 30 days</td><td style="text-align:right;font-weight:600">${r.created30d}</td><td style="text-align:right;font-weight:600">${r.resolved30d}</td><td style="text-align:right">${net(r.created30d,r.resolved30d)}</td></tr>
  <tr><td>Last 12 months</td><td style="text-align:right;font-weight:600">${r.created12m}</td><td style="text-align:right;font-weight:600">${r.resolved12m}</td><td style="text-align:right">${net(r.created12m,r.resolved12m)}</td></tr>
  <tr><td style="font-weight:700">All time</td><td style="text-align:right;font-weight:700">${r.total}</td><td style="text-align:right;font-weight:700">${r.resolved}</td><td style="text-align:right">${net(r.total,r.resolved)}</td></tr>
</tbody></table>
<h2>SLA Health</h2>
<table><tbody>
  ${row('On Track', `<span class="green">${r.onTrack} (${pct(r.onTrack, r.slaTotal)})</span>`)}
  ${row('At Risk',  `<span class="amber">${r.atRisk} (${pct(r.atRisk, r.slaTotal)})</span>`)}
  ${row('Breaching',`<span class="red">${r.breaching} (${pct(r.breaching, r.slaTotal)})</span>`)}
  ${row('Median Resolution', r.medRes != null ? r.medRes + ' days' : '—')}
  ${row('Open 90+ days', r.over90)}
  ${row('Unassigned Open', `${r.unassigned} (${pct(r.unassigned, r.open)})`)}
</tbody></table>
<div class="two-col">
  <div><h2>By Bank / Client</h2><table><tbody>${tableRows(r.byBank)}</tbody></table></div>
  <div><h2>Open Tickets by Assignee</h2><table><tbody>${tableRows(r.byAssignee)}</tbody></table></div>
</div>
<div class="two-col">
  <div><h2>By Project</h2><table><tbody>${tableRows(r.byProject)}</tbody></table></div>
  <div><h2>By Status</h2><table><tbody>${tableRows(r.byStatus)}</tbody></table></div>
</div>
</body></html>`;
}

// ── Plain text builder ────────────────────────────────────────────────────────
function buildText(r) {
  const dateStr = r.generatedAt.toLocaleString('en-GB');
  const line = '─'.repeat(50);
  const rows = (entries) => entries.map(([k, v]) => `  ${k.padEnd(30)} ${v}`).join('\n');
  const net = (c, res) => { const n = c - res; return (n > 0 ? '+' : '') + n; };
  return `CSR SNAPSHOT REPORT\nGenerated: ${dateStr}\n${line}\n\nEXECUTIVE SUMMARY\n  Total tickets:        ${r.total}\n  Open:                 ${r.open}\n  Resolved:             ${r.resolved}\n  SLA Breaching:        ${r.breaching}\n  Open 90+ days:        ${r.over90}\n\nTICKET VOLUME BY PERIOD\n  Period          Created   Resolved   Net\n  Last 24h        ${String(r.created24h).padEnd(10)}${String(r.resolved24h).padEnd(11)}${net(r.created24h,r.resolved24h)}\n  Last 7 days     ${String(r.created7d).padEnd(10)}${String(r.resolved7d).padEnd(11)}${net(r.created7d,r.resolved7d)}\n  Last 30 days    ${String(r.created30d).padEnd(10)}${String(r.resolved30d).padEnd(11)}${net(r.created30d,r.resolved30d)}\n  Last 12 months  ${String(r.created12m).padEnd(10)}${String(r.resolved12m).padEnd(11)}${net(r.created12m,r.resolved12m)}\n  All time        ${String(r.total).padEnd(10)}${String(r.resolved).padEnd(11)}${net(r.total,r.resolved)}\n\nSLA HEALTH\n  On Track:             ${r.onTrack} (${pct(r.onTrack, r.slaTotal)})\n  At Risk:              ${r.atRisk} (${pct(r.atRisk, r.slaTotal)})\n  Breaching:            ${r.breaching} (${pct(r.breaching, r.slaTotal)})\n  Median resolution:    ${r.medRes ?? '—'} days\n  Unassigned open:      ${r.unassigned} (${pct(r.unassigned, r.open)})\n\nBY BANK / CLIENT\n${rows(r.byBank)}\n\nOPEN TICKETS BY ASSIGNEE\n${rows(r.byAssignee)}\n\nBY PROJECT\n${rows(r.byProject)}\n\nBY STATUS\n${rows(r.byStatus)}\n${line}`;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function CsrSnapshotModal({ tickets, onClose }) {
  const [filterBank,     setFilterBank]     = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [filterProject,  setFilterProject]  = useState('all');
  const [filterStatus,   setFilterStatus]   = useState('all');
  const [activeKpi,      setActiveKpi]      = useState(null);

  // Derive options from ALL tickets
  const banks     = useMemo(() => [...new Set(tickets.map(t => t.bank).filter(Boolean))].sort(), [tickets]);
  const assignees = useMemo(() => [...new Set(tickets.map(t => t.assignee).filter(v => v && v !== 'Unassigned'))].sort(), [tickets]);
  const projects  = useMemo(() => [...new Set(tickets.map(t => t.project).filter(Boolean))].sort(), [tickets]);
  const statuses  = useMemo(() => [...new Set(tickets.map(t => t.status).filter(Boolean))].sort(), [tickets]);

  // Apply filters
  const filteredTickets = useMemo(() => tickets.filter(t => {
    if (filterBank     !== 'all' && t.bank     !== filterBank)     return false;
    if (filterAssignee !== 'all' && t.assignee !== filterAssignee) return false;
    if (filterProject  !== 'all' && t.project  !== filterProject)  return false;
    if (filterStatus   !== 'all' && t.status   !== filterStatus)   return false;
    return true;
  }), [tickets, filterBank, filterAssignee, filterProject, filterStatus]);

  const report = useMemo(() => buildReport(filteredTickets), [filteredTickets]);
  const r = report;

  const hasFilters = filterBank !== 'all' || filterAssignee !== 'all' || filterProject !== 'all' || filterStatus !== 'all';
  const filterDesc = [
    filterBank     !== 'all' ? `Bank: ${filterBank}`         : null,
    filterAssignee !== 'all' ? `Assignee: ${filterAssignee}` : null,
    filterProject  !== 'all' ? `Project: ${filterProject}`   : null,
    filterStatus   !== 'all' ? `Status: ${filterStatus}`     : null,
  ].filter(Boolean).join(', ');

  const dateStr = r.generatedAt.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });

  function clearFilters() {
    setFilterBank('all'); setFilterAssignee('all');
    setFilterProject('all'); setFilterStatus('all');
  }

  function handleCopy() {
    navigator.clipboard.writeText(buildText(r)).catch(() => {});
  }

  function handleDownload() {
    const html = buildHtml(r, filterDesc);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `CSR_Snapshot_${r.generatedAt.toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    const html = buildHtml(r, filterDesc);
    const win  = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  const selectCls = 'bg-slate-700 border border-slate-600 text-slate-100 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500';

  const kpiCards = [
    { label: 'Total Tickets',  val: r.total,      color: 'text-slate-100' },
    { label: 'Open',           val: r.open,       color: 'text-amber-400' },
    { label: 'Resolved',       val: r.resolved,   color: 'text-green-400' },
    { label: 'SLA Breaching',  val: r.breaching,  color: 'text-red-400'   },
    { label: 'Created (7d)',   val: r.created7d,  color: 'text-blue-400'  },
    { label: 'Resolved (7d)',  val: r.resolved7d, color: 'text-emerald-400' },
    { label: 'Open 90+ days',  val: r.over90,     color: 'text-orange-400' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm overflow-y-auto">
      <div className="min-h-full flex items-start justify-center py-6 px-4">
        <div className="w-full max-w-5xl bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col">

          {/* ── Sticky header ── */}
          <div className="sticky top-0 z-10 bg-slate-900 rounded-t-2xl border-b border-slate-700 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-100">CSR Snapshot Report</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {dateStr} · {filteredTickets.length} tickets{hasFilters ? ` (filtered from ${tickets.length})` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={handleCopy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600">
                <Copy size={13} /> Copy text
              </button>
              <button onClick={handleDownload}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600">
                <Download size={13} /> Download HTML
              </button>
              <div className="flex items-center gap-1.5">
                <button onClick={handlePrint}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
                  <Printer size={13} /> Print / Save PDF
                </button>
                <span className="text-xs text-slate-500 hidden sm:inline">← choose "Save as PDF"</span>
              </div>
              <button onClick={onClose}
                className="ml-1 p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-lg">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* ── Scrollable content ── */}
          <div className="p-6 space-y-6">

            {/* Filter bar */}
            <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Filter size={14} className="text-slate-400" />
                <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Filter Report</span>
                {hasFilters && (
                  <button onClick={clearFilters}
                    className="ml-auto text-xs text-indigo-400 hover:text-indigo-300 underline">
                    Clear filters
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Bank</label>
                  <select value={filterBank} onChange={e => setFilterBank(e.target.value)} className={selectCls}>
                    <option value="all">All Banks</option>
                    {banks.map(b => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Assignee</label>
                  <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)} className={selectCls}>
                    <option value="all">All Assignees</option>
                    {assignees.map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Project</label>
                  <select value={filterProject} onChange={e => setFilterProject(e.target.value)} className={selectCls}>
                    <option value="all">All Projects</option>
                    {projects.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500">Status</label>
                  <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className={selectCls}>
                    <option value="all">All Statuses</option>
                    {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Showing <span className="text-slate-300 font-semibold">{filteredTickets.length}</span> of {tickets.length} tickets
              </p>
            </div>

            {/* KPI cards — clickable */}
            <section>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Executive Summary</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                {kpiCards.map(({ label, val, color }) => (
                  <button key={label}
                    onClick={() => setActiveKpi(activeKpi === label ? null : label)}
                    className={`bg-slate-800 border rounded-xl p-4 text-center cursor-pointer transition-all hover:border-indigo-500 ${activeKpi === label ? 'border-indigo-500 ring-2 ring-indigo-500/50' : 'border-slate-700'}`}>
                    <div className={`text-2xl font-bold ${color}`}>{val}</div>
                    <div className="text-xs text-slate-400 mt-1 leading-tight">{label}</div>
                  </button>
                ))}
              </div>
              {activeKpi && (
                <p className="text-xs text-indigo-400 mt-2">
                  Showing detail for: <span className="font-semibold">{activeKpi}</span>
                  <button onClick={() => setActiveKpi(null)} className="ml-2 text-slate-500 hover:text-slate-300">✕ clear</button>
                </p>
              )}
            </section>

            {/* Volume by period */}
            <section>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Ticket Volume by Period</h3>
              <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-900 text-xs text-slate-400 uppercase">
                      <th className="px-4 py-2 text-left">Period</th>
                      <th className="px-4 py-2 text-right">Created</th>
                      <th className="px-4 py-2 text-right">Resolved</th>
                      <th className="px-4 py-2 text-right">Net change</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {[
                      { label: 'Last 24 hours',  c: r.created24h,  res: r.resolved24h },
                      { label: 'Last 7 days',    c: r.created7d,   res: r.resolved7d  },
                      { label: 'Last 30 days',   c: r.created30d,  res: r.resolved30d },
                      { label: 'Last 12 months', c: r.created12m,  res: r.resolved12m },
                      { label: 'All time',       c: r.total,       res: r.resolved, bold: true },
                    ].map(({ label, c, res, bold }) => {
                      const n = c - res;
                      return (
                        <tr key={label} className="hover:bg-slate-700/30">
                          <td className={`px-4 py-2.5 text-slate-200 ${bold ? 'font-bold' : ''}`}>{label}</td>
                          <td className="px-4 py-2.5 text-right text-blue-400 font-semibold">{c}</td>
                          <td className="px-4 py-2.5 text-right text-green-400 font-semibold">{res}</td>
                          <td className={`px-4 py-2.5 text-right font-bold ${n > 0 ? 'text-red-400' : n < 0 ? 'text-green-400' : 'text-slate-400'}`}>
                            {n > 0 ? '+' : ''}{n}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* SLA Health */}
            <section>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">SLA Health</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { label: 'On Track',          val: `${r.onTrack} (${pct(r.onTrack, r.slaTotal)})`,    color: 'text-green-400'  },
                  { label: 'At Risk',           val: `${r.atRisk} (${pct(r.atRisk, r.slaTotal)})`,      color: 'text-amber-400'  },
                  { label: 'Breaching',         val: `${r.breaching} (${pct(r.breaching, r.slaTotal)})`,color: 'text-red-400'    },
                  { label: 'Median Resolution', val: r.medRes != null ? `${r.medRes} days` : '—',        color: 'text-indigo-400' },
                  { label: 'Open 90+ days',     val: r.over90,                                           color: 'text-orange-400' },
                  { label: 'Unassigned Open',   val: `${r.unassigned} (${pct(r.unassigned, r.open)})`,  color: 'text-slate-300'  },
                ].map(({ label, val, color }) => (
                  <div key={label} className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex justify-between items-center">
                    <span className="text-xs text-slate-400">{label}</span>
                    <span className={`text-sm font-bold ${color}`}>{val}</span>
                  </div>
                ))}
              </div>
            </section>

            {/* Breakdowns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { title: 'By Bank / Client',         data: r.byBank     },
                { title: 'Open Tickets by Assignee', data: r.byAssignee },
                { title: 'By Project',               data: r.byProject  },
                { title: 'By Status',                data: r.byStatus   },
              ].map(({ title, data }) => (
                <section key={title}>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">{title}</h3>
                  <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-slate-700">
                        {data.length === 0
                          ? <tr><td className="px-4 py-3 text-slate-500 text-xs">No data</td></tr>
                          : data.map(([k, v]) => (
                            <tr key={k} className="hover:bg-slate-700/30">
                              <td className="px-4 py-2 text-slate-300 text-xs">{k}</td>
                              <td className="px-4 py-2 text-right font-bold text-slate-100 text-xs">{v}</td>
                            </tr>
                          ))
                        }
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>

          </div>{/* end scrollable content */}
        </div>
      </div>
    </div>
  );
}
