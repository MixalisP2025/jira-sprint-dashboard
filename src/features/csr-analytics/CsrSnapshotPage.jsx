import { useMemo, useState } from "react";
import { Copy, Printer, Download, Filter, Camera } from "lucide-react";
import { useCsrAnalyticsData } from "./hooks/useCsrAnalyticsData.js";
import { useCsrAnalyticsFilters } from "./hooks/useCsrAnalyticsFilters.js";
import { DEFAULT_MANUAL_FILTERS } from "./utils/csrAnalyticsConstants.js";

const H24  = 86400000;
const H7D  = 7  * H24;
const H30D = 30 * H24;
const H12M = 365 * H24;

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
function topN(tickets, key, n) {
  const map = {};
  tickets.forEach(t => { const v = t[key] || "Unknown"; map[v] = (map[v] || 0) + 1; });
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n || 8);
}
function timeByKey(tickets, key) {
  const map = {};
  tickets.forEach(t => {
    const v = t[key] || "Unknown";
    const sec = t.timeSpentSeconds || 0;
    if (!map[v]) map[v] = { seconds: 0, tickets: 0 };
    map[v].seconds += sec;
    map[v].tickets += 1;
  });
  return Object.entries(map)
    .filter(([, v]) => v.seconds > 0)
    .sort((a, b) => b[1].seconds - a[1].seconds)
    .map(([k, v]) => [k, v.seconds, v.tickets]);
}
function fmtHours(sec) {
  if (!sec) return "0h";
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h > 0 ? (m > 0 ? h + "h " + m + "m" : h + "h") : m + "m";
}
function pct(num, den) {
  if (!den) return "—";
  return Math.round((num / den) * 100) + "%";
}
function buildReport(tickets) {
  const now = new Date();
  const total    = tickets.length;
  const open     = tickets.filter(t => t.isOpen).length;
  const resolved = tickets.filter(t => t.isResolved).length;
  const onTrack  = tickets.filter(t => t.slaState === "on-track").length;
  const atRisk   = tickets.filter(t => t.slaState === "at-risk").length;
  const breaching = tickets.filter(t => t.slaState === "breaching").length;
  const slaTotal = onTrack + atRisk + breaching;
  const over90   = tickets.filter(t => t.isOpen && t.ageDays >= 90).length;
  const unassigned = tickets.filter(t => t.isOpen && (!t.assignee || t.assignee === "Unassigned" || t.assignee === "")).length;
  return {
    generatedAt: now, total, open, resolved,
    created24h: countCreatedIn(tickets, H24), created7d: countCreatedIn(tickets, H7D),
    created30d: countCreatedIn(tickets, H30D), created12m: countCreatedIn(tickets, H12M),
    resolved24h: countResolvedIn(tickets, H24), resolved7d: countResolvedIn(tickets, H7D),
    resolved30d: countResolvedIn(tickets, H30D), resolved12m: countResolvedIn(tickets, H12M),
    onTrack, atRisk, breaching, slaTotal, over90, unassigned,
    medRes: medianDays(tickets),
    byBank: topN(tickets, "bank"), byAssignee: topN(tickets.filter(t => t.isOpen), "assignee"),
    byProject: topN(tickets, "project"), byStatus: topN(tickets, "status"),
    // Time & Effort
    totalTimeSpentSec: tickets.reduce((s, t) => s + (t.timeSpentSeconds || 0), 0),
    totalEstimateSec:  tickets.reduce((s, t) => s + (t.originalEstimateSec || 0), 0),
    totalStoryPoints:  tickets.reduce((s, t) => s + (t.storyPoints || 0), 0),
    timeByBank:     timeByKey(tickets, "bank"),
    timeByProject:  timeByKey(tickets, "project"),
    timeByAssignee: timeByKey(tickets, "assignee"),
  };
}

function buildHtml(r, filterDesc) {
  const dateStr = r.generatedAt.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });
  const net = (c, res) => { const n = c - res; return "<span style=\"color:" + (n > 0 ? "#dc2626" : n < 0 ? "#16a34a" : "#64748b") + ";font-weight:700\">" + (n > 0 ? "+" : "") + n + "</span>"; };
  const row = (label, val) => "<tr><td style=\"padding:6px 12px;color:#64748b;font-size:13px\">" + label + "</td><td style=\"padding:6px 12px;font-weight:600;font-size:13px\">" + val + "</td></tr>";
  const trows = (entries) => entries.map(([k, v]) => "<tr><td style=\"padding:5px 12px;font-size:13px\">" + k + "</td><td style=\"padding:5px 12px;font-weight:600;font-size:13px;text-align:right\">" + v + "</td></tr>").join("");
  return "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><title>CSR Snapshot</title><style>body{font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;margin:0;padding:32px;color:#1e293b;background:#fff}h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;font-weight:700;margin:24px 0 8px;border-bottom:2px solid #e2e8f0;padding-bottom:6px}.sub{color:#64748b;font-size:13px;margin-bottom:28px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}.card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px}.val{font-size:26px;font-weight:700}.lbl{font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.05em;margin-top:2px}table{width:100%;border-collapse:collapse}tr:nth-child(even) td{background:#f8fafc}th{background:#f1f5f9;padding:8px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600}td{padding:7px 12px;font-size:13px}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:24px}.green{color:#16a34a;font-weight:700}.amber{color:#d97706;font-weight:700}.red{color:#dc2626;font-weight:700}@media print{body{padding:16px}@page{size:A4;margin:1cm}}</style></head><body>" +
    "<h1>CSR Snapshot Report</h1><div class=\"sub\">Generated: " + dateStr + (filterDesc ? " &nbsp;·&nbsp; Filters: " + filterDesc : "") + " &nbsp;·&nbsp; " + r.total + " tickets</div>" +
    "<h2>Executive Summary</h2><div class=\"grid\"><div class=\"card\"><div class=\"val\">" + r.total + "</div><div class=\"lbl\">Total Tickets</div></div><div class=\"card\"><div class=\"val\" style=\"color:#d97706\">" + r.open + "</div><div class=\"lbl\">Open</div></div><div class=\"card\"><div class=\"val\" style=\"color:#16a34a\">" + r.resolved + "</div><div class=\"lbl\">Resolved</div></div><div class=\"card\"><div class=\"val\" style=\"color:#dc2626\">" + r.breaching + "</div><div class=\"lbl\">SLA Breaching</div></div><div class=\"card\"><div class=\"val\">" + r.created7d + "</div><div class=\"lbl\">Created (7d)</div></div><div class=\"card\"><div class=\"val\">" + r.resolved7d + "</div><div class=\"lbl\">Resolved (7d)</div></div><div class=\"card\"><div class=\"val\">" + r.over90 + "</div><div class=\"lbl\">Open 90+ days</div></div><div class=\"card\"><div class=\"val\">" + r.unassigned + "</div><div class=\"lbl\">Unassigned Open</div></div></div>" +
    "<h2>Ticket Volume by Period</h2><table><thead><tr><th>Period</th><th style=\"text-align:right\">Created</th><th style=\"text-align:right\">Resolved</th><th style=\"text-align:right\">Net</th></tr></thead><tbody><tr><td>Last 24 hours</td><td style=\"text-align:right;font-weight:600\">" + r.created24h + "</td><td style=\"text-align:right;font-weight:600\">" + r.resolved24h + "</td><td style=\"text-align:right\">" + net(r.created24h, r.resolved24h) + "</td></tr><tr><td>Last 7 days</td><td style=\"text-align:right;font-weight:600\">" + r.created7d + "</td><td style=\"text-align:right;font-weight:600\">" + r.resolved7d + "</td><td style=\"text-align:right\">" + net(r.created7d, r.resolved7d) + "</td></tr><tr><td>Last 30 days</td><td style=\"text-align:right;font-weight:600\">" + r.created30d + "</td><td style=\"text-align:right;font-weight:600\">" + r.resolved30d + "</td><td style=\"text-align:right\">" + net(r.created30d, r.resolved30d) + "</td></tr><tr><td>Last 12 months</td><td style=\"text-align:right;font-weight:600\">" + r.created12m + "</td><td style=\"text-align:right;font-weight:600\">" + r.resolved12m + "</td><td style=\"text-align:right\">" + net(r.created12m, r.resolved12m) + "</td></tr><tr><td style=\"font-weight:700\">All time</td><td style=\"text-align:right;font-weight:700\">" + r.total + "</td><td style=\"text-align:right;font-weight:700\">" + r.resolved + "</td><td style=\"text-align:right\">" + net(r.total, r.resolved) + "</td></tr></tbody></table>" +
    "<h2>SLA Health</h2><table><tbody>" + row("On Track", "<span class=\"green\">" + r.onTrack + " (" + pct(r.onTrack, r.slaTotal) + ")</span>") + row("At Risk", "<span class=\"amber\">" + r.atRisk + " (" + pct(r.atRisk, r.slaTotal) + ")</span>") + row("Breaching", "<span class=\"red\">" + r.breaching + " (" + pct(r.breaching, r.slaTotal) + ")</span>") + row("Median Resolution", r.medRes != null ? r.medRes + " days" : "—") + row("Open 90+ days", r.over90) + row("Unassigned Open", r.unassigned + " (" + pct(r.unassigned, r.open) + ")") + "</tbody></table>" +
    "<div class=\"two-col\"><div><h2>By Bank / Client</h2><table><tbody>" + trows(r.byBank) + "</tbody></table></div><div><h2>Open Tickets by Assignee</h2><table><tbody>" + trows(r.byAssignee) + "</tbody></table></div></div>" +
    "<div class=\"two-col\"><div><h2>By Project</h2><table><tbody>" + trows(r.byProject) + "</tbody></table></div><div><h2>By Status</h2><table><tbody>" + trows(r.byStatus) + "</tbody></table></div></div>" +
    "<h2>Time &amp; Effort Tracking</h2>" +
    "<table><tbody>" + row("Total Time Logged", fmtHours(r.totalTimeSpentSec)) + row("Total Estimated", fmtHours(r.totalEstimateSec)) + row("Total Story Points", r.totalStoryPoints || "—") + "</tbody></table>" +
    (r.timeByBank.length > 0 ? "<h2>Time by Bank / Client</h2><table><thead><tr><th>Bank</th><th style=\"text-align:right\">Time</th><th style=\"text-align:right\">Tickets</th></tr></thead><tbody>" + r.timeByBank.map(([k, s, c]) => "<tr><td style=\"padding:5px 12px;font-size:13px\">" + k + "</td><td style=\"padding:5px 12px;font-weight:600;text-align:right\">" + fmtHours(s) + "</td><td style=\"padding:5px 12px;text-align:right;color:#64748b\">" + c + "</td></tr>").join("") + "</tbody></table>" : "") +
    (r.timeByProject.length > 0 ? "<h2>Time by Project</h2><table><thead><tr><th>Project</th><th style=\"text-align:right\">Time</th><th style=\"text-align:right\">Tickets</th></tr></thead><tbody>" + r.timeByProject.map(([k, s, c]) => "<tr><td style=\"padding:5px 12px;font-size:13px\">" + k + "</td><td style=\"padding:5px 12px;font-weight:600;text-align:right\">" + fmtHours(s) + "</td><td style=\"padding:5px 12px;text-align:right;color:#64748b\">" + c + "</td></tr>").join("") + "</tbody></table>" : "") +
    (r.timeByAssignee.length > 0 ? "<h2>Time by Assignee</h2><table><thead><tr><th>Assignee</th><th style=\"text-align:right\">Time</th><th style=\"text-align:right\">Tickets</th></tr></thead><tbody>" + r.timeByAssignee.map(([k, s, c]) => "<tr><td style=\"padding:5px 12px;font-size:13px\">" + k + "</td><td style=\"padding:5px 12px;font-weight:600;text-align:right\">" + fmtHours(s) + "</td><td style=\"padding:5px 12px;text-align:right;color:#64748b\">" + c + "</td></tr>").join("") + "</tbody></table>" : "") +
    "</body></html>";
}

export default function CsrSnapshotPage() {
  const { filters, setFilter } = useCsrAnalyticsFilters();
  const { normalizedTickets, loading } = useCsrAnalyticsData({ filters, drilldowns: [] });

  const [filterBank,     setFilterBank]     = useState("all");
  const [filterAssignee, setFilterAssignee] = useState("all");
  const [filterProject,  setFilterProject]  = useState("all");
  const [filterStatus,   setFilterStatus]   = useState("all");
  const [activeKpi,      setActiveKpi]      = useState(null);
  const [copied,         setCopied]         = useState(false);

  const banks     = useMemo(() => [...new Set(normalizedTickets.map(t => t.bank).filter(Boolean))].sort(), [normalizedTickets]);
  const assignees = useMemo(() => [...new Set(normalizedTickets.map(t => t.assignee).filter(v => v && v !== "Unassigned"))].sort(), [normalizedTickets]);
  const projects  = useMemo(() => [...new Set(normalizedTickets.map(t => t.project).filter(Boolean))].sort(), [normalizedTickets]);
  const statuses  = useMemo(() => [...new Set(normalizedTickets.map(t => t.status).filter(Boolean))].sort(), [normalizedTickets]);

  const filteredTickets = useMemo(() => normalizedTickets.filter(t => {
    if (filterBank     !== "all" && t.bank     !== filterBank)     return false;
    if (filterAssignee !== "all" && t.assignee !== filterAssignee) return false;
    if (filterProject  !== "all" && t.project  !== filterProject)  return false;
    if (filterStatus   !== "all" && t.status   !== filterStatus)   return false;
    return true;
  }), [normalizedTickets, filterBank, filterAssignee, filterProject, filterStatus]);

  const report = useMemo(() => buildReport(filteredTickets), [filteredTickets]);
  const r = report;

  const hasFilters = filterBank !== "all" || filterAssignee !== "all" || filterProject !== "all" || filterStatus !== "all";
  const filterDesc = [
    filterBank     !== "all" ? "Bank: " + filterBank         : null,
    filterAssignee !== "all" ? "Assignee: " + filterAssignee : null,
    filterProject  !== "all" ? "Project: " + filterProject   : null,
    filterStatus   !== "all" ? "Status: " + filterStatus     : null,
  ].filter(Boolean).join(", ");

  function clearFilters() { setFilterBank("all"); setFilterAssignee("all"); setFilterProject("all"); setFilterStatus("all"); }

  function handleCopy() {
    const dateStr = r.generatedAt.toLocaleString("en-GB");
    const line = "─".repeat(50);
    const rows = (entries) => entries.map(([k, v]) => "  " + k.padEnd(30) + " " + v).join("\n");
    const net = (c, res) => { const n = c - res; return (n > 0 ? "+" : "") + n; };
    const text = "CSR SNAPSHOT REPORT\nGenerated: " + dateStr + "\n" + line + "\n\nEXECUTIVE SUMMARY\n  Total: " + r.total + "  Open: " + r.open + "  Resolved: " + r.resolved + "  Breaching: " + r.breaching + "\n\nVOLUME BY PERIOD\n  Last 24h:       Created " + r.created24h + "  Resolved " + r.resolved24h + "  Net " + net(r.created24h, r.resolved24h) + "\n  Last 7 days:    Created " + r.created7d + "  Resolved " + r.resolved7d + "  Net " + net(r.created7d, r.resolved7d) + "\n  Last 30 days:   Created " + r.created30d + "  Resolved " + r.resolved30d + "  Net " + net(r.created30d, r.resolved30d) + "\n  Last 12 months: Created " + r.created12m + "  Resolved " + r.resolved12m + "  Net " + net(r.created12m, r.resolved12m) + "\n  All time:       Created " + r.total + "  Resolved " + r.resolved + "  Net " + net(r.total, r.resolved) + "\n\nSLA HEALTH\n  On Track: " + r.onTrack + " (" + pct(r.onTrack, r.slaTotal) + ")  At Risk: " + r.atRisk + " (" + pct(r.atRisk, r.slaTotal) + ")  Breaching: " + r.breaching + " (" + pct(r.breaching, r.slaTotal) + ")\n  Median Resolution: " + (r.medRes ?? "—") + " days  Open 90+: " + r.over90 + "  Unassigned: " + r.unassigned + "\n\nBY BANK\n" + rows(r.byBank) + "\n\nBY ASSIGNEE (open)\n" + rows(r.byAssignee) + "\n\nBY PROJECT\n" + rows(r.byProject) + "\n\nBY STATUS\n" + rows(r.byStatus) + "\n" + line;
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }

  function handleDownload() {
    const html = buildHtml(r, filterDesc);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "CSR_Snapshot_" + r.generatedAt.toISOString().slice(0, 10) + ".html";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handlePrint() {
    const html = buildHtml(r, filterDesc);
    const win  = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  }

  const selectCls = "bg-slate-700 border border-slate-600 text-slate-100 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500";

  const kpiCards = [
    { label: "Total Tickets",  val: r.total,      color: "text-slate-100",   section: "volume"    },
    { label: "Open",           val: r.open,       color: "text-amber-400",   section: "sla"       },
    { label: "Resolved",       val: r.resolved,   color: "text-green-400",   section: "volume"    },
    { label: "SLA Breaching",  val: r.breaching,  color: "text-red-400",     section: "sla"       },
    { label: "Created (7d)",   val: r.created7d,  color: "text-blue-400",    section: "volume"    },
    { label: "Resolved (7d)",  val: r.resolved7d, color: "text-emerald-400", section: "volume"    },
    { label: "Open 90+ days",  val: r.over90,     color: "text-orange-400",  section: "sla"       },
    { label: "Unassigned Open",val: r.unassigned, color: "text-slate-300",   section: "sla"       },
  ];

  const dateStr = r.generatedAt.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });

  if (loading && normalizedTickets.length === 0) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <div className="animate-spin w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full mr-3" />
        Loading CSR data...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 pb-16">

      {/* Page header */}
      <div className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Camera size={20} className="text-indigo-400" />
          <div>
            <h1 className="text-lg font-bold text-slate-100">CSR Snapshot</h1>
            <p className="text-xs text-slate-400">{dateStr} · {filteredTickets.length} tickets{hasFilters ? " (filtered from " + normalizedTickets.length + ")" : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleCopy}
            className={"flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors " + (copied ? "bg-green-700 border-green-600 text-white" : "bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600")}>
            <Copy size={13} /> {copied ? "Copied!" : "Copy text"}
          </button>
          <button onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg border border-slate-600">
            <Download size={13} /> Download HTML
          </button>
          <button onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg">
            <Printer size={13} /> Print / Save PDF
          </button>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6">

        {/* Filter bar */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter size={14} className="text-slate-400" />
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Filter Snapshot</span>
            {hasFilters && (
              <button onClick={clearFilters} className="ml-auto text-xs text-indigo-400 hover:text-indigo-300 underline">Clear filters</button>
            )}
          </div>
          <div className="flex flex-wrap gap-4">
            {[
              { label: "Bank",     val: filterBank,     set: setFilterBank,     opts: banks,     placeholder: "All Banks"     },
              { label: "Assignee", val: filterAssignee, set: setFilterAssignee, opts: assignees, placeholder: "All Assignees" },
              { label: "Project",  val: filterProject,  set: setFilterProject,  opts: projects,  placeholder: "All Projects"  },
              { label: "Status",   val: filterStatus,   set: setFilterStatus,   opts: statuses,  placeholder: "All Statuses"  },
            ].map(({ label, val, set, opts, placeholder }) => (
              <div key={label} className="flex flex-col gap-1">
                <label className="text-xs text-slate-500">{label}</label>
                <select value={val} onChange={e => set(e.target.value)} className={selectCls}>
                  <option value="all">{placeholder}</option>
                  {opts.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Showing <span className="text-slate-300 font-semibold">{filteredTickets.length}</span> of {normalizedTickets.length} tickets
          </p>
        </div>

        {/* KPI cards */}
        <section>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Executive Summary — click a card to highlight its section</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            {kpiCards.map(({ label, val, color, section }) => (
              <button key={label}
                onClick={() => setActiveKpi(activeKpi === label ? null : label)}
                className={"bg-slate-800 border rounded-xl p-4 text-center cursor-pointer transition-all hover:border-indigo-500 " + (activeKpi === label ? "border-indigo-500 ring-2 ring-indigo-500/40" : "border-slate-700")}>
                <div className={"text-2xl font-bold " + color}>{val}</div>
                <div className="text-xs text-slate-400 mt-1 leading-tight">{label}</div>
              </button>
            ))}
          </div>
          {activeKpi && (
            <p className="text-xs text-indigo-400 mt-2">
              Highlighted: <span className="font-semibold">{activeKpi}</span>
              <button onClick={() => setActiveKpi(null)} className="ml-2 text-slate-500 hover:text-slate-300">✕</button>
            </p>
          )}
        </section>

        {/* Volume by period */}
        <section className={"rounded-xl overflow-hidden border transition-all " + (activeKpi && ["Total Tickets","Resolved","Created (7d)","Resolved (7d)"].includes(activeKpi) ? "border-indigo-500 ring-1 ring-indigo-500/30" : "border-slate-700")}>
          <div className="bg-slate-800 px-4 py-3 border-b border-slate-700">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Ticket Volume by Period</h2>
          </div>
          <table className="w-full text-sm bg-slate-800">
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
                { label: "Last 24 hours",  c: r.created24h,  res: r.resolved24h },
                { label: "Last 7 days",    c: r.created7d,   res: r.resolved7d  },
                { label: "Last 30 days",   c: r.created30d,  res: r.resolved30d },
                { label: "Last 12 months", c: r.created12m,  res: r.resolved12m },
                { label: "All time",       c: r.total,       res: r.resolved, bold: true },
              ].map(({ label, c, res, bold }) => {
                const n = c - res;
                return (
                  <tr key={label} className="hover:bg-slate-700/30">
                    <td className={"px-4 py-3 text-slate-200 " + (bold ? "font-bold" : "")}>{label}</td>
                    <td className="px-4 py-3 text-right text-blue-400 font-semibold">{c}</td>
                    <td className="px-4 py-3 text-right text-green-400 font-semibold">{res}</td>
                    <td className={"px-4 py-3 text-right font-bold " + (n > 0 ? "text-red-400" : n < 0 ? "text-green-400" : "text-slate-400")}>
                      {n > 0 ? "+" : ""}{n}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* SLA Health */}
        <section className={"rounded-xl border transition-all " + (activeKpi && ["Open","SLA Breaching","Open 90+ days","Unassigned Open"].includes(activeKpi) ? "border-indigo-500 ring-1 ring-indigo-500/30" : "border-slate-700")}>
          <div className="bg-slate-800 px-4 py-3 border-b border-slate-700 rounded-t-xl">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">SLA Health</h2>
          </div>
          <div className="bg-slate-800 rounded-b-xl p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[
              { label: "On Track",          val: r.onTrack + " (" + pct(r.onTrack, r.slaTotal) + ")",    color: "text-green-400"  },
              { label: "At Risk",           val: r.atRisk + " (" + pct(r.atRisk, r.slaTotal) + ")",      color: "text-amber-400"  },
              { label: "Breaching",         val: r.breaching + " (" + pct(r.breaching, r.slaTotal) + ")",color: "text-red-400"    },
              { label: "Median Resolution", val: r.medRes != null ? r.medRes + " days" : "—",             color: "text-indigo-400" },
              { label: "Open 90+ days",     val: r.over90,                                                color: "text-orange-400" },
              { label: "Unassigned Open",   val: r.unassigned + " (" + pct(r.unassigned, r.open) + ")",  color: "text-slate-300"  },
            ].map(({ label, val, color }) => (
              <div key={label} className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 flex justify-between items-center">
                <span className="text-xs text-slate-400">{label}</span>
                <span className={"text-sm font-bold " + color}>{val}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Breakdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { title: "By Bank / Client",         data: r.byBank     },
            { title: "Open Tickets by Assignee", data: r.byAssignee },
            { title: "By Project",               data: r.byProject  },
            { title: "By Status",                data: r.byStatus   },
          ].map(({ title, data }) => (
            <section key={title} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-700">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest">{title}</h2>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-700">
                  {data.length === 0
                    ? <tr><td className="px-4 py-3 text-slate-500 text-xs">No data</td></tr>
                    : data.map(([k, v]) => (
                      <tr key={k} className="hover:bg-slate-700/30">
                        <td className="px-4 py-2.5 text-slate-300 text-sm">{k}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-slate-100 text-sm">{v}</td>
                      </tr>
                    ))
                  }
                </tbody>
              </table>
            </section>
          ))}
        </div>

        {/* Time & Effort Tracking */}
        <section>
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">Time &amp; Effort Tracking</h2>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
            <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex justify-between items-center">
              <span className="text-xs text-slate-400">Total Time Logged</span>
              <span className="text-sm font-bold text-cyan-400">{fmtHours(r.totalTimeSpentSec)}</span>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex justify-between items-center">
              <span className="text-xs text-slate-400">Total Estimated</span>
              <span className="text-sm font-bold text-violet-400">{fmtHours(r.totalEstimateSec)}</span>
            </div>
            <div className="bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 flex justify-between items-center">
              <span className="text-xs text-slate-400">Total Story Points</span>
              <span className="text-sm font-bold text-blue-400">{r.totalStoryPoints || "—"}</span>
            </div>
          </div>

          {/* Time by Bank, Project, Assignee */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { title: "Time by Bank / Client",  data: r.timeByBank     },
              { title: "Time by Project",        data: r.timeByProject  },
              { title: "Time by Assignee",       data: r.timeByAssignee },
            ].map(({ title, data }) => (
              <div key={title} className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-700">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">{title}</h3>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-900 text-xs text-slate-500">
                      <th className="px-4 py-1.5 text-left">Name</th>
                      <th className="px-4 py-1.5 text-right">Time</th>
                      <th className="px-4 py-1.5 text-right">Tickets</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700">
                    {data.length === 0
                      ? <tr><td colSpan="3" className="px-4 py-3 text-slate-500 text-xs">No time logged</td></tr>
                      : data.map(([name, sec, count]) => (
                        <tr key={name} className="hover:bg-slate-700/30">
                          <td className="px-4 py-2 text-slate-300 text-xs">{name}</td>
                          <td className="px-4 py-2 text-right font-bold text-cyan-400 text-xs">{fmtHours(sec)}</td>
                          <td className="px-4 py-2 text-right text-slate-400 text-xs">{count}</td>
                        </tr>
                      ))
                    }
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
