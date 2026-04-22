/**
 * @fileoverview CsrSnapshotModal — generates a comprehensive CSR report snapshot.
 *
 * Shows a management summary at the top and full detail below.
 * Supports Copy to Clipboard, Print, and Download as HTML.
 */

import { useMemo, useRef } from 'react';
import { X, Copy, Printer, Download } from 'lucide-react';

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function countCreatedIn(tickets, ms) {
  const cutoff = Date.now() - ms;
  return tickets.filter(t => t.createdAt && new Date(t.createdAt).getTime() >= cutoff).length;
}

function countResolvedIn(tickets, ms) {
  const cutoff = Date.now() - ms;
  return tickets.filter(t => t.resolvedAt && new Date(t.resolvedAt).getTime() >= cutoff).length;
}

function avgDays(tickets) {
  const resolved = tickets.filter(t => t.resolutionDays != null);
  if (!resolved.length) return null;
  return Math.round(resolved.reduce((s, t) => s + t.resolutionDays, 0) / resolved.length);
}

function medianDays(tickets) {
  const vals = tickets.filter(t => t.resolutionDays != null).map(t => t.resolutionDays).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  return Math.round(vals.length % 2 === 0 ? (vals[mid - 1] + vals[mid]) / 2 : vals[mid]);
}

function topN(tickets, key, n = 8) {
  const map = {};
  tickets.forEach(t => {
    const v = t[key] || 'Unknown';
    map[v] = (map[v] || 0) + 1;
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function pct(num, den) {
  if (!den) return '—';
  return `${Math.round((num / den) * 100)}%`;
}

const H24  = 86400000;
const H7D  = 7  * H24;
const H30D = 30 * H24;
const H12M = 365 * H24;

// ---------------------------------------------------------------------------
// Report data builder
// ---------------------------------------------------------------------------

function buildReport(tickets) {
  const now = new Date();
  const total   = tickets.length;
  const open    = tickets.filter(t => t.isOpen).length;
  const resolved = tickets.filter(t => t.isResolved).length;
  const inProg  = tickets.filter(t => !t.isOpen && !t.isResolved).length;

  const created24h  = countCreatedIn(tickets, H24);
  const created7d   = countCreatedIn(tickets, H7D);
  const created30d  = countCreatedIn(tickets, H30D);
  const created12m  = countCreatedIn(tickets, H12M);

  const resolved24h = countResolvedIn(tickets, H24);
  const resolved7d  = countResolvedIn(tickets, H7D);
  const resolved30d = countResolvedIn(tickets, H30D);
  const resolved12m = countResolvedIn(tickets, H12M);

  const onTrack   = tickets.filter(t => t.slaState === 'on-track').length;
  const atRisk    = tickets.filter(t => t.slaState === 'at-risk').length;
  const breaching = tickets.filter(t => t.slaState === 'breaching').length;
  const slaTotal  = onTrack + atRisk + breaching;

  const over90    = tickets.filter(t => t.isOpen && t.ageDays >= 90).length;
  const unassigned = tickets.filter(t => t.isOpen && (!t.assignee || t.assignee === 'Unassigned' || t.assignee === '')).length;

  const avgRes    = avgDays(tickets);
  const medRes    = medianDays(tickets);

  const byBank     = topN(tickets, 'bank');
  const byAssignee = topN(tickets.filter(t => t.isOpen), 'assignee');
  const byProject  = topN(tickets, 'project');
  const byStatus   = topN(tickets, 'status');

  return {
    generatedAt: now,
    total, open, resolved, inProg,
    created24h, created7d, created30d, created12m,
    resolved24h, resolved7d, resolved30d, resolved12m,
    onTrack, atRisk, breaching, slaTotal,
    over90, unassigned,
    avgRes, medRes,
    byBank, byAssignee, byProject, byStatus,
  };
}

// ---------------------------------------------------------------------------
// HTML report builder (for download + print)
// ---------------------------------------------------------------------------

function buildHtml(r) {
  const dateStr = r.generatedAt.toLocaleString('en-GB', { dateStyle: 'full', timeStyle: 'short' });

  const row = (label, val) => `<tr><td style="padding:6px 12px;color:#64748b;font-size:13px">${label}</td><td style="padding:6px 12px;font-weight:600;font-size:13px">${val}</td></tr>`;

  const tableRows = (entries) => entries.map(([k, v]) =>
    `<tr><td style="padding:5px 12px;font-size:13px">${k}</td><td style="padding:5px 12px;font-weight:600;font-size:13px;text-align:right">${v}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>CSR Snapshot — ${dateStr}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 32px; color: #1e293b; background: #fff; }
  h1 { font-size: 22px; margin: 0 0 4px; color: #0f172a; }
  .subtitle { color: #64748b; font-size: 13px; margin-bottom: 28px; }
  h2 { font-size: 15px; font-weight: 700; color: #0f172a; margin: 24px 0 8px; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; }
  .card .val { font-size: 26px; font-weight: 700; color: #0f172a; }
  .card .lbl { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; }
  tr:nth-child(even) td { background: #f8fafc; }
  .badge-green { color: #16a34a; font-weight: 700; }
  .badge-amber { color: #d97706; font-weight: 700; }
  .badge-red   { color: #dc2626; font-weight: 700; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  @media print { body { padding: 16px; } }
</style>
</head>
<body>
<h1>CSR Snapshot Report</h1>
<div class="subtitle">Generated: ${dateStr} &nbsp;·&nbsp; Total tickets in dataset: ${r.total}</div>

<h2>Executive Summary</h2>
<div class="grid">
  <div class="card"><div class="val">${r.total}</div><div class="lbl">Total Tickets</div></div>
  <div class="card"><div class="val" style="color:#d97706">${r.open}</div><div class="lbl">Open</div></div>
  <div class="card"><div class="val" style="color:#16a34a">${r.resolved}</div><div class="lbl">Resolved</div></div>
  <div class="card"><div class="val" style="color:#dc2626">${r.breaching}</div><div class="lbl">SLA Breaching</div></div>
  <div class="card"><div class="val">${r.created7d}</div><div class="lbl">Created (7 days)</div></div>
  <div class="card"><div class="val">${r.resolved7d}</div><div class="lbl">Resolved (7 days)</div></div>
  <div class="card"><div class="val">${r.avgRes ?? '—'} days</div><div class="lbl">Avg Resolution</div></div>
  <div class="card"><div class="val">${r.over90}</div><div class="lbl">Open 90+ days</div></div>
</div>

<h2>Ticket Volume by Period</h2>
<table>
  <thead><tr style="background:#f1f5f9"><th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b">Period</th><th style="padding:8px 12px;text-align:right;font-size:12px;color:#64748b">Created</th><th style="padding:8px 12px;text-align:right;font-size:12px;color:#64748b">Resolved</th><th style="padding:8px 12px;text-align:right;font-size:12px;color:#64748b">Net</th></tr></thead>
  <tbody>
    <tr><td style="padding:7px 12px;font-size:13px">Last 24 hours</td><td style="padding:7px 12px;text-align:right;font-weight:600">${r.created24h}</td><td style="padding:7px 12px;text-align:right;font-weight:600">${r.resolved24h}</td><td style="padding:7px 12px;text-align:right;font-weight:600;color:${r.created24h - r.resolved24h > 0 ? '#dc2626' : '#16a34a'}">${r.created24h - r.resolved24h > 0 ? '+' : ''}${r.created24h - r.resolved24h}</td></tr>
    <tr style="background:#f8fafc"><td style="padding:7px 12px;font-size:13px">Last 7 days</td><td style="padding:7px 12px;text-align:right;font-weight:600">${r.created7d}</td><td style="padding:7px 12px;text-align:right;font-weight:600">${r.resolved7d}</td><td style="padding:7px 12px;text-align:right;font-weight:600;color:${r.created7d - r.resolved7d > 0 ? '#dc2626' : '#16a34a'}">${r.created7d - r.resolved7d > 0 ? '+' : ''}${r.created7d - r.resolved7d}</td></tr>
    <tr><td style="padding:7px 12px;font-size:13px">Last 30 days</td><td style="padding:7px 12px;text-align:right;font-weight:600">${r.created30d}</td><td style="padding:7px 12px;text-align:right;font-weight:600">${r.resolved30d}</td><td style="padding:7px 12px;text-align:right;font-weight:600;color:${r.created30d - r.resolved30d > 0 ? '#dc2626' : '#16a34a'}">${r.created30d - r.resolved30d > 0 ? '+' : ''}${r.created30d - r.resolved30d}</td></tr>
    <tr style="background:#f8fafc"><td style="padding:7px 12px;font-size:13px">Last 12 months</td><td style="padding:7px 12px;text-align:right;font-weight:600">${r.created12m}</td><td style="padding:7px 12px;text-align:right;font-weight:600">${r.resolved12m}</td><td style="padding:7px 12px;text-align:right;font-weight:600;color:${r.created12m - r.resolved12m > 0 ? '#dc2626' : '#16a34a'}">${r.created12m - r.resolved12m > 0 ? '+' : ''}${r.created12m - r.resolved12m}</td></tr>
    <tr><td style="padding:7px 12px;font-size:13px;font-weight:700">All time</td><td style="padding:7px 12px;text-align:right;font-weight:700">${r.total}</td><td style="padding:7px 12px;text-align:right;font-weight:700">${r.resolved}</td><td style="padding:7px 12px;text-align:right;font-weight:700">${r.total - r.resolved > 0 ? '+' : ''}${r.total - r.resolved}</td></tr>
  </tbody>
</table>

<h2>SLA Health</h2>
<table>
  ${row('On Track', `<span class="badge-green">${r.onTrack}</span> (${pct(r.onTrack, r.slaTotal)})`)}
  ${row('At Risk',  `<span class="badge-amber">${r.atRisk}</span> (${pct(r.atRisk, r.slaTotal)})`)}
  ${row('Breaching', `<span class="badge-red">${r.breaching}</span> (${pct(r.breaching, r.slaTotal)})`)}
  ${row('Avg Resolution Time', r.avgRes != null ? `${r.avgRes} days` : '—')}
  ${row('Median Resolution Time', r.medRes != null ? `${r.medRes} days` : '—')}
  ${row('Open 90+ days', r.over90)}
  ${row('Unassigned Open', `${r.unassigned} (${pct(r.unassigned, r.open)})`)}
</table>

<div class="two-col">
  <div>
    <h2>By Bank / Client</h2>
    <table><tbody>${tableRows(r.byBank)}</tbody></table>
  </div>
  <div>
    <h2>Open Tickets by Assignee</h2>
    <table><tbody>${tableRows(r.byAssignee)}</tbody></table>
  </div>
</div>

<div class="two-col">
  <div>
    <h2>By Project</h2>
    <table><tbody>${tableRows(r.byProject)}</tbody></table>
  </div>
  <div>
    <h2>By Status</h2>
    <table><tbody>${tableRows(r.byStatus)}</tbody></table>
  </div>
</div>

</body></html>`;
}

// ---------------------------------------------------------------------------
// Plain text builder (for clipboard)
// ---------------------------------------------------------------------------

function buildText(r) {
  const dateStr = r.generatedAt.toLocaleString('en-GB');
  const line = '─'.repeat(50);
  const rows = (entries) => entries.map(([k, v]) => `  ${k.padEnd(30)} ${v}`).join('\n');

  return `CSR SNAPSHOT REPORT
Generated: ${dateStr}
${line}

EXECUTIVE SUMMARY
  Total tickets:        ${r.total}
  Open:                 ${r.open}
  Resolved:             ${r.resolved}
  SLA Breaching:        ${r.breaching}
  Avg resolution:       ${r.avgRes ?? '—'} days
  Open 90+ days:        ${r.over90}

TICKET VOLUME BY PERIOD
  Period          Created   Resolved   Net
  Last 24h        ${String(r.created24h).padEnd(10)}${String(r.resolved24h).padEnd(11)}${r.created24h - r.resolved24h > 0 ? '+' : ''}${r.created24h - r.resolved24h}
  Last 7 days     ${String(r.created7d).padEnd(10)}${String(r.resolved7d).padEnd(11)}${r.created7d - r.resolved7d > 0 ? '+' : ''}${r.created7d - r.resolved7d}
  Last 30 days    ${String(r.created30d).padEnd(10)}${String(r.resolved30d).padEnd(11)}${r.created30d - r.resolved30d > 0 ? '+' : ''}${r.created30d - r.resolved30d}
  Last 12 months  ${String(r.created12m).padEnd(10)}${String(r.resolved12m).padEnd(11)}${r.created12m - r.resolved12m > 0 ? '+' : ''}${r.created12m - r.resolved12m}
  All time        ${String(r.total).padEnd(10)}${String(r.resolved).padEnd(11)}${r.total - r.resolved > 0 ? '+' : ''}${r.total - r.resolved}

SLA HEALTH
  On Track:             ${r.onTrack} (${pct(r.onTrack, r.slaTotal)})
  At Risk:              ${r.atRisk} (${pct(r.atRisk, r.slaTotal)})
  Breaching:            ${r.breaching} (${pct(r.breaching, r.slaTotal)})
  Avg resolution:       ${r.avgRes ?? '—'} days
  Median resolution:    ${r.medRes ?? '—'} days
  Unassigned open:      ${r.unassigned} (${pct(r.unassigned, r.open)})

BY BANK / CLIENT
${rows(r.byBank)}

OPEN TICKETS BY ASSIGNEE
${rows(r.byAssignee)}

BY PROJECT
${rows(r.byProject)}

BY STATUS
${rows(r.byStatus)}
${line}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * @param {{ tickets: import('../utils/csrAnalyticsTypes').NormalizedCsrTicket[], onClose: () => void }} props
 */
export default function CsrSnapshotModal({ tickets, onClose }) {
  const report = useMemo(() => buildReport(tickets), [tickets]);
  const htmlRef = useRef(null);

  function handleCopy() {
    navigator.clipboard.writeText(buildText(report)).catch(() => {});
  }

  function handleDownload() {
    const html = buildHtml(report);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = report.generatedAt.toISOString().slice(0, 10);
    a.href = url;
    a.download = `CSR_Snapshot_${date}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    const html = buildHtml(report);
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  }

  const r = report;
  const dateStr = r.generatedAt.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8 px-4">
      <div className="w-full max-w-4xl bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-slate-100">CSR Snapshot Report</h2>
            <p className="text-xs text-slate-400 mt-0.5">Generated {dateStr} · {r.total} tickets in dataset</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600">
              <Copy size={13} /> Copy text
            </button>
            <button onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600">
              <Download size={13} /> Download HTML
            </button>
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
              <Printer size={13} /> Print
            </button>
            <button onClick={onClose}
              className="ml-2 p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded-lg">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6" ref={htmlRef}>

          {/* Executive Summary cards */}
          <section>
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Executive Summary</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'Total Tickets',    val: r.total,     color: 'text-slate-100' },
                { label: 'Open',             val: r.open,      color: 'text-amber-400' },
                { label: 'Resolved',         val: r.resolved,  color: 'text-green-400' },
                { label: 'SLA Breaching',    val: r.breaching, color: 'text-red-400' },
                { label: 'Created (7d)',     val: r.created7d, color: 'text-blue-400' },
                { label: 'Resolved (7d)',    val: r.resolved7d,color: 'text-emerald-400' },
                { label: 'Avg Resolution',   val: r.avgRes != null ? `${r.avgRes}d` : '—', color: 'text-purple-400' },
                { label: 'Open 90+ days',    val: r.over90,    color: 'text-orange-400' },
              ].map(({ label, val, color }) => (
                <div key={label} className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
                  <div className={`text-2xl font-bold ${color}`}>{val}</div>
                  <div className="text-xs text-slate-400 mt-1">{label}</div>
                </div>
              ))}
            </div>
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
                    { label: 'Last 24 hours',   c: r.created24h,  res: r.resolved24h },
                    { label: 'Last 7 days',     c: r.created7d,   res: r.resolved7d },
                    { label: 'Last 30 days',    c: r.created30d,  res: r.resolved30d },
                    { label: 'Last 12 months',  c: r.created12m,  res: r.resolved12m },
                    { label: 'All time',        c: r.total,       res: r.resolved, bold: true },
                  ].map(({ label, c, res, bold }) => {
                    const net = c - res;
                    return (
                      <tr key={label} className="hover:bg-slate-700/30">
                        <td className={`px-4 py-2.5 text-slate-200 ${bold ? 'font-bold' : ''}`}>{label}</td>
                        <td className="px-4 py-2.5 text-right text-blue-400 font-semibold">{c}</td>
                        <td className="px-4 py-2.5 text-right text-green-400 font-semibold">{res}</td>
                        <td className={`px-4 py-2.5 text-right font-bold ${net > 0 ? 'text-red-400' : net < 0 ? 'text-green-400' : 'text-slate-400'}`}>
                          {net > 0 ? '+' : ''}{net}
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
                { label: 'On Track',           val: `${r.onTrack} (${pct(r.onTrack, r.slaTotal)})`,   color: 'text-green-400' },
                { label: 'At Risk',            val: `${r.atRisk} (${pct(r.atRisk, r.slaTotal)})`,     color: 'text-amber-400' },
                { label: 'Breaching',          val: `${r.breaching} (${pct(r.breaching, r.slaTotal)})`, color: 'text-red-400' },
                { label: 'Avg Resolution',     val: r.avgRes != null ? `${r.avgRes} days` : '—',      color: 'text-purple-400' },
                { label: 'Median Resolution',  val: r.medRes != null ? `${r.medRes} days` : '—',      color: 'text-indigo-400' },
                { label: 'Unassigned Open',    val: `${r.unassigned} (${pct(r.unassigned, r.open)})`, color: 'text-orange-400' },
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
              { title: 'By Bank / Client',         data: r.byBank },
              { title: 'Open Tickets by Assignee', data: r.byAssignee },
              { title: 'By Project',               data: r.byProject },
              { title: 'By Status',                data: r.byStatus },
            ].map(({ title, data }) => (
              <section key={title}>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2">{title}</h3>
                <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-slate-700">
                      {data.length === 0 ? (
                        <tr><td className="px-4 py-3 text-slate-500 text-xs">No data</td></tr>
                      ) : data.map(([k, v]) => (
                        <tr key={k} className="hover:bg-slate-700/30">
                          <td className="px-4 py-2 text-slate-300 text-xs">{k}</td>
                          <td className="px-4 py-2 text-right font-bold text-slate-100 text-xs">{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </div>

        </div>
      </div>
    </div>
  );
}
