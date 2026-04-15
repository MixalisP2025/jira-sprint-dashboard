import { useMemo } from 'react';

/**
 * Filter bar for the CSR Analytics page.
 *
 * Renders dropdown selects for project, bank, assignee, status, and issueType;
 * date range inputs; an includeLegacy checkbox; and a ticketScope segmented
 * control. All dropdown options are derived from the full (unfiltered) tickets
 * array so options never disappear while filtering is active.
 *
 * @param {{
 *   filters: import('../utils/csrAnalyticsTypes').ManualFilters,
 *   onFiltersChange: (key: string, value: any) => void,
 *   tickets: import('../utils/csrAnalyticsTypes').NormalizedCsrTicket[]
 * }} props
 */
export default function CsrAnalyticsFilters({ filters, onFiltersChange, tickets }) {
  // ── Derive unique sorted options from the full tickets array ─────────────

  const projectOptions = useMemo(() => {
    const values = [...new Set(tickets.map((t) => t.project).filter(Boolean))];
    return values.sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const bankOptions = useMemo(() => {
    const values = [...new Set(tickets.map((t) => t.bank).filter(Boolean))];
    return values.sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const assigneeOptions = useMemo(() => {
    const values = [...new Set(tickets.map((t) => t.assignee).filter((v) => v && v.trim() !== ''))];
    return values.sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const statusOptions = useMemo(() => {
    const values = [...new Set(tickets.map((t) => t.status).filter(Boolean))];
    return values.sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  const issueTypeOptions = useMemo(() => {
    const values = [...new Set(tickets.map((t) => t.issueType).filter(Boolean))];
    return values.sort((a, b) => a.localeCompare(b));
  }, [tickets]);

  // ── Shared class strings ──────────────────────────────────────────────────

  const selectClass =
    'bg-slate-700 border border-slate-600 text-slate-100 text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500';

  const labelClass = 'text-xs text-slate-400 font-medium';

  // ── Segmented control helpers ─────────────────────────────────────────────

  const scopeButtons = [
    { value: 'all',      label: 'All' },
    { value: 'open',     label: 'Open' },
    { value: 'resolved', label: 'Resolved' },
  ];

  function scopeButtonClass(value) {
    const isActive = filters.ticketScope === value;
    const base = 'px-3 py-1 text-sm font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-indigo-500';
    if (isActive) {
      return `${base} bg-indigo-600 text-white`;
    }
    return `${base} bg-slate-700 text-slate-300 hover:bg-slate-600`;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-slate-800 border-b border-slate-700 px-6 py-3">
      <div className="flex flex-wrap items-end gap-4">

        {/* Project */}
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Project</label>
          <select
            className={selectClass}
            value={filters.project}
            onChange={(e) => onFiltersChange('project', e.target.value)}
          >
            <option value="all">All</option>
            {projectOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {/* Bank */}
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Bank</label>
          <select
            className={selectClass}
            value={filters.bank}
            onChange={(e) => onFiltersChange('bank', e.target.value)}
          >
            <option value="all">All</option>
            {bankOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {/* Assignee */}
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Assignee</label>
          <select
            className={selectClass}
            value={filters.assignee}
            onChange={(e) => onFiltersChange('assignee', e.target.value)}
          >
            <option value="all">All</option>
            {assigneeOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {/* Status */}
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Status</label>
          <select
            className={selectClass}
            value={filters.status}
            onChange={(e) => onFiltersChange('status', e.target.value)}
          >
            <option value="all">All</option>
            {statusOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {/* Issue Type */}
        <div className="flex flex-col gap-1">
          <label className={labelClass}>Issue Type</label>
          <select
            className={selectClass}
            value={filters.issueType}
            onChange={(e) => onFiltersChange('issueType', e.target.value)}
          >
            <option value="all">All</option>
            {issueTypeOptions.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>

        {/* Date Range — Start */}
        <div className="flex flex-col gap-1">
          <label className={labelClass}>From</label>
          <input
            type="date"
            className={selectClass}
            value={filters.dateRange.start}
            onChange={(e) =>
              onFiltersChange('dateRange', { ...filters.dateRange, start: e.target.value })
            }
          />
        </div>

        {/* Date Range — End */}
        <div className="flex flex-col gap-1">
          <label className={labelClass}>To</label>
          <input
            type="date"
            className={selectClass}
            value={filters.dateRange.end}
            onChange={(e) =>
              onFiltersChange('dateRange', { ...filters.dateRange, end: e.target.value })
            }
          />
        </div>

        {/* Include Legacy checkbox */}
        <div className="flex flex-col gap-1">
          <span className={labelClass}>Legacy</span>
          <label className="flex items-center gap-2 cursor-pointer py-1">
            <input
              type="checkbox"
              checked={filters.includeLegacy}
              onChange={(e) => onFiltersChange('includeLegacy', e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-800"
            />
            <span className="text-sm text-slate-300">Include legacy tickets (2+ years old)</span>
          </label>
        </div>

        {/* Ticket Scope segmented control */}
        <div className="flex flex-col gap-1">
          <span className={labelClass}>Scope</span>
          <div className="flex rounded overflow-hidden border border-slate-600">
            {scopeButtons.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={scopeButtonClass(value)}
                onClick={() => onFiltersChange('ticketScope', value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
