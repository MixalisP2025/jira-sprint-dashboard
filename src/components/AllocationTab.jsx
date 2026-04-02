import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Copy, Check, Zap, Users, LayoutGrid, RotateCcw, Download, Briefcase } from 'lucide-react';
import { generateSuggestions } from '../utils/allocationSuggestions';
import RolesTab from './RolesTab';
import { saveEligibilityToDB, loadEligibilityFromDB, saveAllocationsToDB, pingDB } from '../utils/dbSync';

// ─── Field accessors ──────────────────────────────────────────────────────────
const getKey      = t => t['Issue key'] || t['Key'] || '';
const getSummary  = t => t['Summary'] || '';
const getProject  = t => t['Project'] || t['B'] || '';
const getType     = t => t['Issue Type'] || '';
const getSP       = t => parseFloat(t['Story Points']) || 0;
const getAssignee = t => t['Assignee'] || t['D'] || 'Unassigned';

// Active statuses that consume capacity (same logic as Capacity tab)
const isActive = t => {
  const s = (t['Status'] || '').toLowerCase();
  return s === 'to do' || s === 'in progress' || s === 'open' || s === 'new' || s === 'reopened';
};
const EXCLUDED        = ['Sotiris Mavrogianneas', 'Sofia Boustantzi'];
const ELIGIBILITY_KEY = 'assigneeEligibility';
const DEFAULT_ELIGIBLE = ['CC', 'WTR1'];

// ─── CapacityBar ─────────────────────────────────────────────────────────────
function CapacityBar({ allocated, cap }) {
  const pct = cap > 0 ? Math.min(100, (allocated / cap) * 100) : 0;
  const full = cap > 0 && allocated >= cap;
  return (
    <div className="mt-1">
      <div className="flex justify-between text-xs text-slate-400 mb-0.5">
        <span>{allocated} / {cap} SP</span>
        {full && <span className="text-red-400 font-semibold">Full</span>}
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${full ? 'bg-red-500' : 'bg-blue-500'}`}
          style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── ProjectTag (draggable, used in Eligibility view) ────────────────────────
function ProjectTag({ projectKey, assignee, onRemove, onDragStart }) {
  return (
    <span
      draggable
      onDragStart={e => onDragStart(e, projectKey, assignee)}
      className="inline-flex items-center gap-1 bg-blue-900/60 border border-blue-700/50 text-blue-300 text-xs px-2 py-0.5 rounded cursor-grab active:cursor-grabbing select-none hover:bg-blue-800/60 transition-colors"
    >
      {projectKey}
      <button
        onClick={e => { e.stopPropagation(); onRemove(assignee, projectKey); }}
        className="text-blue-400 hover:text-red-400 transition-colors ml-0.5 leading-none"
        title="Remove"
      >×</button>
    </span>
  );
}

// ─── EligibilityView ──────────────────────────────────────────────────────────
function EligibilityView({ assignees, projectKeys, eligibility, onEligibilityChange, filteredData }) {
  const [dragInfo, setDragInfo]   = useState(null); // { projectKey, sourceAssignee }
  const [dropRow, setDropRow]     = useState(null);  // assignee name being hovered

  const totalTickets = filteredData.length;

  function handleTagDragStart(e, projectKey, sourceAssignee) {
    e.dataTransfer.setData('projectKey', projectKey);
    e.dataTransfer.setData('sourceAssignee', sourceAssignee);
    setDragInfo({ projectKey, sourceAssignee });
  }

  function handleRowDragOver(e, assignee) {
    e.preventDefault();
    setDropRow(assignee);
  }

  function handleRowDragLeave() {
    setDropRow(null);
  }

  function handleRowDrop(e, targetAssignee) {
    e.preventDefault();
    const projectKey     = e.dataTransfer.getData('projectKey');
    const sourceAssignee = e.dataTransfer.getData('sourceAssignee');
    const isCopy         = e.ctrlKey;

    if (!projectKey || targetAssignee === sourceAssignee) { setDropRow(null); setDragInfo(null); return; }

    onEligibilityChange(prev => {
      const next = Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, new Set(v)]));
      // Add to target
      if (!next[targetAssignee]) next[targetAssignee] = new Set();
      next[targetAssignee].add(projectKey);
      // Remove from source unless copying
      if (!isCopy && sourceAssignee && next[sourceAssignee]) {
        next[sourceAssignee].delete(projectKey);
      }
      return next;
    });
    setDropRow(null);
    setDragInfo(null);
  }

  function handleRemove(assignee, projectKey) {
    onEligibilityChange(prev => {
      const next = Object.fromEntries(Object.entries(prev).map(([k, v]) => [k, new Set(v)]));
      next[assignee]?.delete(projectKey);
      return next;
    });
  }

  function handleReset() {
    if (!window.confirm('Reset all eligibility to defaults (CC + WTR1 for everyone)?')) return;
    onEligibilityChange(() => {
      const defaults = {};
      assignees.forEach(a => { defaults[a] = new Set(projectKeys.filter(p => DEFAULT_ELIGIBLE.includes(p))); });
      return defaults;
    });
  }

  function handleExport() {
    const rows = [['Assignee', ...projectKeys]];
    assignees.forEach(a => {
      const eligible = eligibility[a] || new Set();
      rows.push([a, ...projectKeys.map(p => eligible.has(p) ? '✓' : '')]);
    });
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'eligibility.csv'; link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Stats bar */}
      <div className="flex items-center gap-6 bg-slate-800 border border-slate-700 rounded-xl px-5 py-3">
        <div className="text-center">
          <div className="text-2xl font-bold text-slate-100">{assignees.length}</div>
          <div className="text-xs text-slate-400">Assignees</div>
        </div>
        <div className="w-px h-8 bg-slate-700" />
        <div className="text-center">
          <div className="text-2xl font-bold text-slate-100">{projectKeys.length}</div>
          <div className="text-xs text-slate-400">Projects</div>
        </div>
        <div className="w-px h-8 bg-slate-700" />
        <div className="text-center">
          <div className="text-2xl font-bold text-slate-100">{totalTickets}</div>
          <div className="text-xs text-slate-400">Tickets</div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 text-xs text-slate-400 italic">
          Drag to move · Ctrl+Drag to copy · × to remove
        </div>
        <div className="flex gap-2">
          <button onClick={handleReset}
            className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs px-3 py-1.5 rounded-lg transition-colors">
            <RotateCcw size={12} /> Reset All
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs px-3 py-1.5 rounded-lg transition-colors">
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-xs text-slate-400 font-medium px-4 py-2.5 w-8">#</th>
              <th className="text-left text-xs text-slate-400 font-medium px-4 py-2.5 w-44">Assignee</th>
              <th className="text-left text-xs text-slate-400 font-medium px-4 py-2.5">Eligible Projects — drag to reassign</th>
            </tr>
          </thead>
          <tbody>
            {assignees.map((a, idx) => {
              const eligible = eligibility[a] || new Set();
              const isDropTarget = dropRow === a;
              return (
                <tr key={a}
                  className={`border-b border-slate-700/50 transition-colors ${isDropTarget ? 'bg-blue-900/20' : idx % 2 === 0 ? 'bg-slate-800' : 'bg-slate-800/50'}`}
                  onDragOver={e => handleRowDragOver(e, a)}
                  onDragLeave={handleRowDragLeave}
                  onDrop={e => handleRowDrop(e, a)}
                >
                  <td className="px-4 py-2.5 text-xs text-slate-500">{idx + 1}</td>
                  <td className="px-4 py-2.5 text-sm text-slate-200 font-medium whitespace-nowrap">
                    <div>{a}</div>
                    <div className="text-xs text-green-400 font-normal mt-0.5">
                      {filteredData.filter(t => getAssignee(t) === a).length} tickets
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap gap-1.5 min-h-[28px] items-center">
                      {[...eligible].sort().map(pk => (
                        <ProjectTag key={pk} projectKey={pk} assignee={a}
                          onRemove={handleRemove} onDragStart={handleTagDragStart} />
                      ))}
                      {eligible.size === 0 && (
                        <span className="text-slate-500 text-xs italic">No projects — drag a tag here</span>
                      )}
                      {/* Drop zone hint */}
                      {isDropTarget && dragInfo && !eligible.has(dragInfo.projectKey) && (
                        <span className="inline-flex items-center bg-blue-600/30 border border-blue-500 border-dashed text-blue-300 text-xs px-2 py-0.5 rounded">
                          + {dragInfo.projectKey}
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── TicketCard ───────────────────────────────────────────────────────────────
function TicketCard({ ticket, currentAssignee, isDragging, onDragStart, onDragEnd }) {
  const key     = getKey(ticket);
  const summary = getSummary(ticket);
  const project = getProject(ticket);
  const type    = getType(ticket);
  const sp      = getSP(ticket);

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, key, currentAssignee)}
      onDragEnd={onDragEnd}
      className={`bg-slate-700 border border-slate-600 rounded-lg p-2.5 cursor-grab active:cursor-grabbing select-none transition-opacity ${isDragging ? 'opacity-40' : 'opacity-100'}`}
    >
      <div className="flex items-start justify-between gap-1 mb-1">
        <span className="text-blue-400 text-xs font-mono font-semibold shrink-0">{key}</span>
        <div className="flex items-center gap-1 shrink-0">
          <span className="bg-slate-600 text-slate-300 text-xs px-1.5 py-0.5 rounded">{project}</span>
          {sp > 0 && <span className="bg-blue-900 text-blue-300 text-xs px-1.5 py-0.5 rounded font-semibold">{sp}sp</span>}
        </div>
      </div>
      <p className="text-slate-200 text-xs leading-snug line-clamp-2 mb-1">{summary}</p>
      {type && <span className="text-slate-400 text-xs">{type}</span>}
    </div>
  );
}

// ─── AssigneeCard (board view — compact, no ticket list) ─────────────────────
function AssigneeCard({ assignee, tickets, allocatedSP, sprintCap, dragging, dropTarget, onDragOver, onDragLeave, onDrop, onDragStart, onDragEnd, movedIn, movedOut }) {
  const remaining = Math.max(0, sprintCap - allocatedSP);
  const isFull    = sprintCap > 0 && remaining === 0;
  const isDropTarget = dropTarget?.id === assignee;
  const dropClass = isDropTarget
    ? dropTarget.valid ? 'ring-2 ring-green-400 bg-green-900/10' : 'ring-2 ring-red-400 bg-red-900/10'
    : '';

  return (
    <div
      className={`bg-slate-800 border border-slate-700 rounded-xl flex flex-col transition-all ${dropClass}`}
      onDragOver={e => onDragOver(e, assignee)}
      onDragLeave={onDragLeave}
      onDrop={e => onDrop(e, assignee)}
    >
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <span className={`text-sm font-semibold truncate ${isFull ? 'text-red-400' : 'text-slate-100'}`}>{assignee}</span>
          <span className="text-xs text-slate-400 shrink-0 ml-1">{tickets.length} tickets</span>
        </div>
        <CapacityBar allocated={allocatedSP} cap={sprintCap} />
        {(movedIn > 0 || movedOut > 0) && (
          <div className="flex gap-3 mt-2 text-xs">
            {movedIn  > 0 && <span className="text-green-400">+{movedIn} moved in</span>}
            {movedOut > 0 && <span className="text-amber-400">−{movedOut} moved out</span>}
          </div>
        )}
      </div>
      {/* Drop zone hint when dragging */}
      {isDropTarget && (
        <div className={`mx-3 mb-3 border-2 border-dashed rounded-lg py-3 text-center text-xs ${dropTarget.valid ? 'border-green-500/50 text-green-400' : 'border-red-500/50 text-red-400'}`}>
          {dropTarget.valid ? 'Drop here' : 'Not eligible'}
        </div>
      )}
    </div>
  );
}

// ─── UnassignedPool ───────────────────────────────────────────────────────────
function UnassignedPool({ tickets, dragging, dropTarget, onDragOver, onDragLeave, onDrop, onDragStart, onDragEnd }) {
  const [filter, setFilter] = useState('');
  const isDropTarget = dropTarget?.id === 'unassigned';
  const dropClass    = isDropTarget ? 'ring-2 ring-green-400 bg-green-900/10' : '';

  const visible = filter
    ? tickets.filter(t => getProject(t).toLowerCase().includes(filter.toLowerCase()) || getKey(t).toLowerCase().includes(filter.toLowerCase()))
    : tickets;

  return (
    <div className={`w-72 shrink-0 bg-slate-800 border border-slate-700 rounded-xl flex flex-col transition-all ${dropClass}`}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <div className="p-3 border-b border-slate-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-100">Unassigned</h3>
          <span className="bg-slate-600 text-slate-300 text-xs px-2 py-0.5 rounded-full font-semibold">{tickets.length}</span>
        </div>
        <input
          type="text" placeholder="Filter by project or key…"
          value={filter} onChange={e => setFilter(e.target.value)}
          className="w-full bg-slate-700 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
      <div className="flex-1 p-2 flex flex-col gap-1.5 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 340px)' }}>
        {visible.length === 0
          ? <p className="text-green-400 text-xs text-center py-6 font-medium">✓ All tickets assigned</p>
          : visible.map(t => (
            <TicketCard key={getKey(t)} ticket={t} currentAssignee={null}
              isDragging={dragging?.ticketId === getKey(t)}
              onDragStart={onDragStart} onDragEnd={onDragEnd} />
          ))
        }
      </div>
    </div>
  );
}

// ─── ChangesPanel ─────────────────────────────────────────────────────────────
function ChangesPanel({ filteredData, allocation, onReset }) {
  const changes = useMemo(() => {
    return Object.entries(allocation)
      .filter(([, target]) => target !== null && target !== 'NO_SUGGESTION')
      .map(([id, target]) => {
        const ticket = filteredData.find(t => getKey(t) === id);
        if (!ticket) return null;
        const original = getAssignee(ticket);
        const from = (!original || original === 'Unassigned') ? 'Unassigned' : original;
        // Always show if from Unassigned, or if assignee changed
        if (from !== 'Unassigned' && original === target) return null;
        return { id, summary: getSummary(ticket), project: getProject(ticket), sp: getSP(ticket), from, to: target };
      })
      .filter(Boolean);
  }, [filteredData, allocation]);

  // Also include tickets explicitly moved to unassigned (allocation[id] === null) that had an assignee
  const unassigned = useMemo(() => {
    return Object.entries(allocation)
      .filter(([, target]) => target === null)
      .map(([id]) => {
        const ticket = filteredData.find(t => getKey(t) === id);
        if (!ticket) return null;
        const original = getAssignee(ticket);
        if (!original || original === 'Unassigned') return null;
        return { id, summary: getSummary(ticket), project: getProject(ticket), sp: getSP(ticket), from: original, to: 'Unassigned' };
      })
      .filter(Boolean);
  }, [filteredData, allocation]);

  const all = [...changes, ...unassigned];

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-100">Allocation Changes</span>
          <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">{all.length} moves</span>
        </div>
        <button onClick={onReset}
          className="flex items-center gap-1.5 bg-red-900/40 hover:bg-red-900/60 border border-red-700/50 text-red-400 text-xs px-3 py-1.5 rounded-lg transition-colors">
          <RotateCcw size={12} /> Reset All Allocations
        </button>
      </div>
      {all.length === 0 ? (
        <div className="px-4 py-6 text-center text-slate-500 text-sm">No changes yet — drag tickets between lanes to allocate</div>
      ) : (
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-700">
              <th className="text-left text-xs text-slate-400 font-medium px-4 py-2">Key</th>
              <th className="text-left text-xs text-slate-400 font-medium px-4 py-2">Summary</th>
              <th className="text-left text-xs text-slate-400 font-medium px-4 py-2">Project</th>
              <th className="text-left text-xs text-slate-400 font-medium px-4 py-2">SP</th>
              <th className="text-left text-xs text-slate-400 font-medium px-4 py-2">From</th>
              <th className="text-left text-xs text-slate-400 font-medium px-4 py-2">To</th>
              <th className="px-4 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {all.map((c, i) => (
              <tr key={c.id} className={`border-b border-slate-700/40 ${i % 2 === 0 ? '' : 'bg-slate-800/50'}`}>
                <td className="px-4 py-2 text-xs text-blue-400 font-mono font-semibold whitespace-nowrap">{c.id}</td>
                <td className="px-4 py-2 text-xs text-slate-200 max-w-xs truncate">{c.summary}</td>
                <td className="px-4 py-2"><span className="bg-slate-700 text-slate-300 text-xs px-1.5 py-0.5 rounded">{c.project}</span></td>
                <td className="px-4 py-2 text-xs text-blue-300">{c.sp > 0 ? `${c.sp}sp` : '—'}</td>
                <td className="px-4 py-2 text-xs text-slate-400 whitespace-nowrap">{c.from}</td>
                <td className="px-4 py-2 text-xs text-green-400 font-medium whitespace-nowrap">{c.to}</td>
                <td className="px-4 py-2"></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── SummaryPanel ─────────────────────────────────────────────────────────────
function SummaryPanel({ selectedSprint, assignees, assigneeTickets, unassignedTickets, assigneeCaps, stats, allocation }) {
  const [copied, setCopied] = useState(false);

  const summaryText = useMemo(() => {
    const lines = [`Sprint: ${selectedSprint}`, `Generated: ${new Date().toISOString()}`, '', '=== ALLOCATION PLAN ===', ''];
    assignees.forEach(a => {
      const tickets = assigneeTickets[a] || [];
      const cap  = assigneeCaps[a] ?? stats?.[a]?.sprintCapacity ?? 0;
      const used = tickets.reduce((s, t) => s + Math.max(getSP(t), 0), 0);
      lines.push(`[${a}]  (${used} / ${cap} SP)`);
      tickets.length === 0 ? lines.push('  (no tickets)') : tickets.forEach(t => lines.push(`  - ${getKey(t)}  [${getSP(t)} SP]  ${getSummary(t)}`));
      lines.push('');
    });
    const noSug = unassignedTickets.filter(t => allocation[getKey(t)] === 'NO_SUGGESTION');
    const rest  = unassignedTickets.filter(t => allocation[getKey(t)] !== 'NO_SUGGESTION');
    if (noSug.length)  { lines.push('=== UNASSIGNED (No Suggestion) ==='); noSug.forEach(t => lines.push(`  - ${getKey(t)}  [${getSP(t)} SP]  ${getSummary(t)}`)); lines.push(''); }
    if (rest.length)   { lines.push('=== UNASSIGNED ==='); rest.forEach(t => lines.push(`  - ${getKey(t)}  [${getSP(t)} SP]  ${getSummary(t)}`)); }
    return lines.join('\n');
  }, [selectedSprint, assignees, assigneeTickets, unassignedTickets, assigneeCaps, stats, allocation]);

  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(summaryText); }
    catch (_) {
      const ta = document.createElement('textarea');
      ta.value = summaryText; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mt-2 bg-slate-800 border border-slate-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-100">Allocation Summary</h3>
        <button onClick={handleCopy}
          className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs px-3 py-1.5 rounded-lg transition-colors">
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          {copied ? 'Copied!' : 'Copy to Clipboard'}
        </button>
      </div>
      <pre className="text-xs text-slate-300 font-mono bg-slate-900 rounded-lg p-3 overflow-auto max-h-64 whitespace-pre-wrap">{summaryText}</pre>
    </div>
  );
}

// ─── AllocationTab ────────────────────────────────────────────────────────────
export default function AllocationTab({ filteredData, selectedSprint, assigneeCaps, stats }) {
  const [view, setView] = useState('eligibility'); // 'eligibility' | 'board' | 'roles'
  const [eligibility, setEligibility]   = useState({});
  const [allocation, setAllocation]     = useState({});
  const [dragging, setDragging]         = useState(null);
  const [dropTarget, setDropTarget]     = useState(null);
  const [showSummary, setShowSummary]   = useState(false);
  const [showChanges, setShowChanges]   = useState(false);

  const projectKeys = useMemo(() =>
    [...new Set(filteredData.map(getProject).filter(Boolean))].sort(), [filteredData]);

  const assignees = useMemo(() =>
    [...new Set(filteredData.map(getAssignee).filter(a => a && a !== 'Unassigned' && !EXCLUDED.includes(a)))].sort(),
  [filteredData]);

  // Seed eligibility from live data — always re-seed from actual ticket assignments
  // DB/localStorage is only used to persist manual changes made after seeding
  useEffect(() => {
    if (!filteredData.length) return;

    // Build fresh seed from actual Jira assignee→project relationships
    const fresh = {};
    assignees.forEach(a => { fresh[a] = new Set(); });
    filteredData.forEach(t => {
      const a = getAssignee(t);
      const p = getProject(t);
      if (a && a !== 'Unassigned' && !EXCLUDED.includes(a) && p && fresh[a]) {
        fresh[a].add(p);
      }
    });

    async function loadAndMerge() {
      let savedData = null;

      // Try DB first
      try {
        const online = await pingDB();
        if (online) {
          const dbData = await loadEligibilityFromDB();
          if (dbData && Object.keys(dbData).length > 0) savedData = dbData;
        }
      } catch (_) {}

      // Fallback to localStorage
      if (!savedData) {
        try {
          const raw = localStorage.getItem(ELIGIBILITY_KEY);
          if (raw) savedData = JSON.parse(raw);
        } catch (_) {}
      }

      if (savedData) {
        const restored = Object.fromEntries(Object.entries(savedData).map(([k, v]) => [k, new Set(v)]));
        const hasData = Object.values(restored).some(s => s.size > 0);
        if (hasData) {
          assignees.forEach(a => { if (!restored[a]) restored[a] = fresh[a]; });
          setEligibility(restored);
          return;
        }
      }
      setEligibility(fresh);
    }

    loadAndMerge();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredData]);

  // Persist eligibility to DB + localStorage
  useEffect(() => {
    if (Object.keys(eligibility).length === 0) return;
    const plain = Object.fromEntries(Object.entries(eligibility).map(([k, v]) => [k, [...v]]));
    localStorage.setItem(ELIGIBILITY_KEY, JSON.stringify(plain));
    pingDB().then(online => {
      if (online) saveEligibilityToDB(plain).catch(() => {});
    }).catch(() => {});
  }, [eligibility]);

  const unassignedTickets = useMemo(() =>
    filteredData.filter(t => {
      const id = getKey(t); if (!id) return false;
      const explicitTarget = allocation[id];
      if (explicitTarget !== undefined) return explicitTarget === null;
      // No explicit allocation — show in unassigned only if Jira assignee is blank
      const a = getAssignee(t);
      return !a || a === 'Unassigned';
    }), [filteredData, allocation]);

  const assigneeTickets = useMemo(() => {
    const map = {}; assignees.forEach(a => { map[a] = []; });
    filteredData.forEach(t => {
      const id = getKey(t);
      const explicitTarget = allocation[id];
      // If explicitly moved/suggested, use that; if explicitly unassigned (null), skip;
      // otherwise fall back to the ticket's Jira assignee
      let target;
      if (explicitTarget !== undefined) {
        if (!explicitTarget || explicitTarget === 'NO_SUGGESTION') return;
        target = explicitTarget;
      } else {
        target = getAssignee(t);
        if (!target || target === 'Unassigned' || EXCLUDED.includes(target)) return;
      }
      if (map[target]) map[target].push(t);
    });
    return map;
  }, [filteredData, allocation, assignees]);

  const remainingCap = useMemo(() => {
    const r = {};
    assignees.forEach(a => {
      const cap  = assigneeCaps[a] ?? stats?.[a]?.sprintCapacity ?? 0;
      const used = (assigneeTickets[a] || []).filter(isActive).reduce((s, t) => s + Math.max(getSP(t), 0), 0);
      r[a] = Math.max(0, cap - used);
    });
    return r;
  }, [assignees, assigneeCaps, stats, assigneeTickets]);

  const suggestionCounts = useMemo(() => {
    let suggested = 0, noSuggestion = 0;
    unassignedTickets.forEach(t => { if (allocation[getKey(t)] === 'NO_SUGGESTION') noSuggestion++; });
    Object.values(allocation).forEach(v => { if (v && v !== 'NO_SUGGESTION' && assignees.includes(v)) suggested++; });
    return { total: unassignedTickets.length, suggested, noSuggestion };
  }, [unassignedTickets, allocation, assignees]);

  const isEligible = useCallback((ticketId, assigneeName) => {
    const ticket = filteredData.find(t => getKey(t) === ticketId);
    if (!ticket) return false;
    return eligibility[assigneeName]?.has(getProject(ticket)) ?? false;
  }, [filteredData, eligibility]);

  const handleDragStart = useCallback((e, ticketId, sourceAssignee) => {
    e.dataTransfer.setData('ticketId', ticketId);
    e.dataTransfer.setData('sourceAssignee', sourceAssignee ?? '');
    setDragging({ ticketId, sourceAssignee: sourceAssignee ?? null });
  }, []);

  const handleDragEnd = useCallback(() => { setDragging(null); setDropTarget(null); }, []);

  const handleLaneDragOver = useCallback((e, assigneeName) => {
    e.preventDefault();
    const valid = dragging ? isEligible(dragging.ticketId, assigneeName) : false;
    setDropTarget({ id: assigneeName, valid });
  }, [dragging, isEligible]);

  const handleLaneDragLeave = useCallback(() => setDropTarget(null), []);

  const handleLaneDrop = useCallback((e, assigneeName) => {
    e.preventDefault();
    const ticketId = e.dataTransfer.getData('ticketId');
    if (ticketId && isEligible(ticketId, assigneeName)) {
      setAllocation(prev => ({ ...prev, [ticketId]: assigneeName }));
    }
    setDropTarget(null); setDragging(null);
  }, [isEligible]);

  const handlePoolDragOver  = useCallback(e => { e.preventDefault(); setDropTarget({ id: 'unassigned', valid: true }); }, []);
  const handlePoolDragLeave = useCallback(() => setDropTarget(null), []);
  const handlePoolDrop      = useCallback(e => {
    e.preventDefault();
    setAllocation(prev => ({ ...prev, [e.dataTransfer.getData('ticketId')]: null }));
    setDropTarget(null); setDragging(null);
  }, []);

  const handleGenerateSuggestions = useCallback(() => {
    const suggestions = generateSuggestions(unassignedTickets, eligibility, remainingCap);
    setAllocation(prev => {
      const next = { ...prev };
      Object.entries(suggestions).forEach(([id, a]) => { if (prev[id] === undefined || prev[id] === null) next[id] = a; });
      return next;
    });
  }, [unassignedTickets, eligibility, remainingCap]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 min-h-0">
      {/* Tab bar + actions */}
      <div className="flex items-center justify-between flex-wrap gap-3 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3">
        <div className="flex items-center gap-1 bg-slate-900 rounded-lg p-1">
          <button onClick={() => setView('eligibility')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'eligibility' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            <Users size={14} /> Eligibility
          </button>
          <button onClick={() => setView('board')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'board' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            <LayoutGrid size={14} /> Board
          </button>
          <button onClick={() => setView('roles')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${view === 'roles' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}>
            <Briefcase size={14} /> Roles
          </button>
        </div>

        {view === 'board' && (
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={handleGenerateSuggestions}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
              <Zap size={14} /> Generate Suggestions
            </button>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span><span className="text-slate-200 font-semibold">{suggestionCounts.total}</span> unassigned</span>
              <span><span className="text-green-400 font-semibold">{suggestionCounts.suggested}</span> suggested</span>
              {suggestionCounts.noSuggestion > 0 && <span><span className="text-red-400 font-semibold">{suggestionCounts.noSuggestion}</span> no match</span>}
            </div>
            <button onClick={() => setShowChanges(s => !s)}
              className={`text-xs border px-3 py-1.5 rounded-lg transition-colors ${showChanges ? 'bg-amber-900/30 border-amber-600 text-amber-400' : 'text-slate-400 hover:text-slate-200 border-slate-600 hover:border-slate-500'}`}>
              {showChanges ? 'Hide Changes' : 'Show Changes'}
            </button>
            <button onClick={() => setShowSummary(s => !s)}
              className="text-xs text-slate-400 hover:text-slate-200 border border-slate-600 hover:border-slate-500 px-3 py-1.5 rounded-lg transition-colors">
              {showSummary ? 'Hide Summary' : 'Show Summary'}
            </button>
          </div>
        )}
      </div>

      {/* Eligibility view */}
      {view === 'eligibility' && (
        <EligibilityView
          assignees={assignees}
          projectKeys={projectKeys}
          eligibility={eligibility}
          onEligibilityChange={setEligibility}
          filteredData={filteredData}
        />
      )}

      {/* Board view */}
      {view === 'board' && (
        <div className="flex gap-4 min-h-0">
          {/* Unassigned pool — fixed left column */}
          <UnassignedPool
            tickets={unassignedTickets}
            dragging={dragging}
            dropTarget={dropTarget}
            onDragOver={handlePoolDragOver}
            onDragLeave={handlePoolDragLeave}
            onDrop={handlePoolDrop}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          />
          {/* Assignee grid — wraps instead of scrolling off-screen */}
          <div className="flex-1 grid gap-3 overflow-y-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', alignContent: 'start' }}>
            {assignees.map(a => {
              const cap         = assigneeCaps[a] ?? stats?.[a]?.sprintCapacity ?? 0;
              const tickets     = assigneeTickets[a] || [];
              const allocatedSP = tickets.filter(isActive).reduce((s, t) => s + Math.max(getSP(t), 0), 0);
              // Count moves in/out for this assignee
              const movedIn  = Object.entries(allocation).filter(([id, target]) => target === a && getAssignee(filteredData.find(t => getKey(t) === id) || {}) !== a).length;
              const movedOut = Object.entries(allocation).filter(([id, target]) => (target === null || (target !== a)) && getAssignee(filteredData.find(t => getKey(t) === id) || {}) === a).length;
              return (
                <AssigneeCard key={a} assignee={a} tickets={tickets}
                  allocatedSP={allocatedSP} sprintCap={cap} movedIn={movedIn} movedOut={movedOut}
                  dragging={dragging} dropTarget={dropTarget}
                  onDragOver={handleLaneDragOver} onDragLeave={handleLaneDragLeave} onDrop={handleLaneDrop}
                  onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
              );
            })}
          </div>
        </div>
      )}

      {/* Changes panel */}
      {view === 'board' && showChanges && (
        <ChangesPanel
          filteredData={filteredData}
          allocation={allocation}
          onReset={() => { if (window.confirm('Reset all allocation changes?')) setAllocation({}); }}
        />
      )}

      {/* Roles view */}
      {view === 'roles' && <RolesTab />}

      {/* Summary panel */}
      {view === 'board' && showSummary && (
        <SummaryPanel selectedSprint={selectedSprint} assignees={assignees}
          assigneeTickets={assigneeTickets} unassignedTickets={unassignedTickets}
          assigneeCaps={assigneeCaps} stats={stats} allocation={allocation} />
      )}
    </div>
  );
}
