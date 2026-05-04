/**
 * @fileoverview Multi-select checkbox dropdown filters for the CSR Analytics page.
 *
 * Each filter dimension (project, bank, assignee, status, issueType) renders as
 * a dropdown button that opens a list of options with checkbox styling.  Only one
 * value can be active at a time (single-select with checkbox visuals) to stay
 * compatible with the existing single-value ManualFilters model.  Clicking the
 * same item again deselects it (reverts to 'all').
 *
 * Also renders date-range inputs, the "Include legacy" toggle, and the
 * ticket-scope segmented control.
 *
 * @param {{
 *   filters: { project: string, bank: string, assignee: string, status: string, issueType: string, dateRange: { start: string, end: string }, includeLegacy: boolean, ticketScope: 'all'|'open'|'resolved' },
 *   onFiltersChange: (key: string, value: any) => void,
 *   tickets: Array<{ project: string, bank: string, assignee: string, status: string, issueType: string }>
 * }} props
 */

import { useMemo, useState, useEffect, useRef, useCallback } from 'react';

export default function CsrAnalyticsFilters({ filters, onFiltersChange, tickets }) {
  const [openDropdown, setOpenDropdown] = useState(null);
  const containerRef = useRef(null);

  // ── Close dropdown on outside click ──────────────────────────────────────
  useEffect(() => {
    if (!openDropdown) return;

    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpenDropdown(null);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openDropdown]);

  // ── Derive unique, sorted option lists from the ticket data ──────────────
  const projectOptions = useMemo(
    () => [...new Set(tickets.map((t) => t.project).filter(Boolean))].sort(),
    [tickets],
  );
  const bankOptions = useMemo(
    () => [...new Set(tickets.map((t) => t.bank).filter(Boolean))].sort(),
    [tickets],
  );
  const assigneeOptions = useMemo(
    () =>
      [...new Set(tickets.map((t) => t.assignee).filter((v) => v && v.trim() !== ''))].sort(),
    [tickets],
  );
  const statusOptions = useMemo(
    () => [...new Set(tickets.map((t) => t.status).filter(Boolean))].sort(),
    [tickets],
  );
  const issueTypeOptions = useMemo(
    () => [...new Set(tickets.map((t) => t.issueType).filter(Boolean))].sort(),
    [tickets],
  );

  // ── Shared Tailwind class strings ────────────────────────────────────────
  const selectCls =
    'bg-slate-700 border border-slate-600 text-slate-100 text-sm rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500';
  const labelCls = 'text-xs text-slate-400 font-medium';

  // ── Toggle handler — single-select with deselect ─────────────────────────
  const handleSelect = useCallback(
    (filterKey, value) => {
      // If the same value is already selected, deselect → 'all'
      const newValue = filters[filterKey] === value ? 'all' : value;
      onFiltersChange(filterKey, newValue);
    },
    [filters, onFiltersChange],
  );

  // ── Filter dropdown definitions ──────────────────────────────────────────
  const filterDropdowns = [
    { key: 'project', label: 'Project', options: projectOptions, current: filters.project },
    { key: 'bank', label: 'Bank', options: bankOptions, current: filters.bank },
    { key: 'assignee', label: 'Assignee', options: assigneeOptions, current: filters.assignee },
    { key: 'status', label: 'Status', options: statusOptions, current: filters.status },
    { key: 'issueType', label: 'Issue Type', options: issueTypeOptions, current: filters.issueType },
  ];

  // ── Ticket scope segmented control options ───────────────────────────────
  const scopeButtons = [
    { value: 'all', label: 'All' },
    { value: 'open', label: 'Open' },
    { value: 'resolved', label: 'Resolved' },
  ];

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} className="bg-slate-800 border-b border-slate-700 px-6 py-3">
      <div className="flex flex-wrap items-end gap-4">

        {/* Checkbox dropdown filters */}
        {filterDropdowns.map(({ key, label, options, current }) => (
          <div key={key} className="flex flex-col gap-1 relative">
            <label className={labelCls}>{label}</label>
            <button
              type="button"
              onClick={() => setOpenDropdown(openDropdown === key ? null : key)}
              className={
                selectCls + ' text-left min-w-[130px] flex items-center justify-between gap-2'
              }
            >
              <span className="truncate">{current === 'all' ? 'All' : current}</span>
              <span className="text-slate-500 text-xs">
                {openDropdown === key ? '▲' : '▼'}
              </span>
            </button>

            {openDropdown === key && (
              <div className="absolute top-full left-0 z-20 mt-1 w-56 max-h-60 overflow-y-auto bg-slate-700 border border-slate-600 rounded-lg shadow-xl">
                {/* "All" option — always first, separated by a border */}
                <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-600 cursor-pointer text-xs text-slate-200 border-b border-slate-600">
                  <input
                    type="checkbox"
                    checked={current === 'all'}
                    onChange={() => {
                      onFiltersChange(key, 'all');
                      setOpenDropdown(null);
                    }}
                    className="w-3.5 h-3.5 rounded border-slate-500 bg-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
                  />
                  All
                </label>

                {/* Individual value options */}
                {options.map((opt) => (
                  <label
                    key={opt}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-600 cursor-pointer text-xs text-slate-200"
                  >
                    <input
                      type="checkbox"
                      checked={current === opt}
                      onChange={() => {
                        handleSelect(key, opt);
                        setOpenDropdown(null);
                      }}
                      className="w-3.5 h-3.5 rounded border-slate-500 bg-slate-800 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
                    />
                    {opt}
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* Date Range — Start */}
        <div className="flex flex-col gap-1">
          <label className={labelCls}>From</label>
          <input
            type="date"
            className={selectCls}
            value={filters.dateRange.start}
            onChange={(e) =>
              onFiltersChange('dateRange', { ...filters.dateRange, start: e.target.value })
            }
          />
        </div>

        {/* Date Range — End */}
        <div className="flex flex-col gap-1">
          <label className={labelCls}>To</label>
          <input
            type="date"
            className={selectCls}
            value={filters.dateRange.end}
            onChange={(e) =>
              onFiltersChange('dateRange', { ...filters.dateRange, end: e.target.value })
            }
          />
        </div>

        {/* Include Legacy checkbox */}
        <div className="flex flex-col gap-1">
          <span className={labelCls}>Legacy</span>
          <label className="flex items-center gap-2 cursor-pointer py-1">
            <input
              type="checkbox"
              checked={filters.includeLegacy}
              onChange={(e) => onFiltersChange('includeLegacy', e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-indigo-600 focus:ring-indigo-500 focus:ring-offset-slate-800"
            />
            <span className="text-sm text-slate-300">Include legacy (2+ years)</span>
          </label>
        </div>

        {/* Ticket Scope segmented control */}
        <div className="flex flex-col gap-1">
          <span className={labelCls}>Scope</span>
          <div className="flex rounded overflow-hidden border border-slate-600">
            {scopeButtons.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={
                  'px-3 py-1 text-sm font-medium transition-colors ' +
                  (filters.ticketScope === value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600')
                }
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
