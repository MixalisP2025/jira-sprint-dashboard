/**
 * @fileoverview CsrAnalyticsTicketGrid — sortable, exportable ticket table.
 *
 * Renders a dark-theme table of NormalizedCsrTicket objects with:
 * - Client-side sorting on any column
 * - Row cap at maxRows (default 500) with a notice when truncated
 * - Empty-state message when no tickets
 * - CSV export via Blob + URL.createObjectURL
 */

import { useState, useMemo } from 'react';
import { csvEscape, formatDate } from '../utils/csrAnalyticsFormatters.js';
import { MAX_GRID_ROWS } from '../utils/csrAnalyticsConstants.js';

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: 'key',       label: 'Key',          sortable: true },
  { key: 'summary',   label: 'Summary',      sortable: true },
  { key: 'assignee',  label: 'Assignee',     sortable: true },
  { key: 'bank',      label: 'Bank',         sortable: true },
  { key: 'status',    label: 'Status',       sortable: true },
  { key: 'ageDays',   label: 'Age (days)',   sortable: true },
  { key: 'slaState',  label: 'SLA State',    sortable: true },
  { key: 'updatedAt', label: 'Last Updated', sortable: true },
];

/** Columns that use numeric comparison instead of localeCompare. */
const NUMERIC_COLS = new Set(['ageDays', 'resolutionDays']);

/** Columns that are ISO date strings (sort lexicographically). */
const DATE_COLS = new Set(['updatedAt', 'createdAt', 'resolvedAt']);

// ---------------------------------------------------------------------------
// Sort comparator
// ---------------------------------------------------------------------------

/**
 * Compares two ticket values for the given column key.
 *
 * @param {import('../utils/csrAnalyticsTypes').NormalizedCsrTicket} a
 * @param {import('../utils/csrAnalyticsTypes').NormalizedCsrTicket} b
 * @param {string} col - Column key
 * @param {'asc'|'desc'} dir - Sort direction
 * @returns {number}
 */
function compareTickets(a, b, col, dir) {
  const aVal = a[col] ?? '';
  const bVal = b[col] ?? '';

  let cmp;
  if (NUMERIC_COLS.has(col)) {
    cmp = (aVal ?? 0) - (bVal ?? 0);
  } else if (DATE_COLS.has(col)) {
    // ISO strings sort lexicographically
    cmp = String(aVal).localeCompare(String(bVal));
  } else {
    cmp = String(aVal).localeCompare(String(bVal));
  }

  return dir === 'asc' ? cmp : -cmp;
}

// ---------------------------------------------------------------------------
// SLA State badge
// ---------------------------------------------------------------------------

/**
 * Returns the Tailwind text-colour class for a given SLA state.
 *
 * @param {'on-track'|'at-risk'|'breaching'|string} slaState
 * @returns {string}
 */
function slaStateClass(slaState) {
  switch (slaState) {
    case 'on-track':  return 'text-green-400';
    case 'at-risk':   return 'text-amber-400';
    case 'breaching': return 'text-red-400';
    default:          return 'text-slate-400';
  }
}

// ---------------------------------------------------------------------------
// CSV export helper
// ---------------------------------------------------------------------------

/**
 * Builds and triggers a CSV download for the given tickets.
 *
 * @param {import('../utils/csrAnalyticsTypes').NormalizedCsrTicket[]} tickets
 */
function handleExport(tickets) {
  const headers = [
    'Key',
    'Summary',
    'Assignee',
    'Bank',
    'Status',
    'Age (days)',
    'SLA State',
    'Last Updated',
    'Created Date',
    'Resolution Days',
  ];

  const rows = tickets.map((t) => [
    csvEscape(t.key),
    csvEscape(t.summary),
    csvEscape(t.assignee),
    csvEscape(t.bank),
    csvEscape(t.status),
    t.ageDays,
    csvEscape(t.slaState),
    csvEscape(t.updatedAt),
    csvEscape(t.createdAt),
    t.resolutionDays ?? '',
  ]);

  const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `CSR_analytics_export_${date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Sortable, exportable ticket grid for CSR Analytics.
 *
 * @param {{
 *   tickets: import('../utils/csrAnalyticsTypes').NormalizedCsrTicket[],
 *   maxRows?: number
 * }} props
 */
export default function CsrAnalyticsTicketGrid({ tickets = [], maxRows = MAX_GRID_ROWS }) {
  const [sortState, setSortState] = useState({ col: 'key', dir: 'asc' });

  // Sort tickets, then slice to maxRows
  const sortedTickets = useMemo(() => {
    const copy = [...tickets];
    copy.sort((a, b) => compareTickets(a, b, sortState.col, sortState.dir));
    return copy;
  }, [tickets, sortState.col, sortState.dir]);

  const displayedTickets = useMemo(
    () => sortedTickets.slice(0, maxRows),
    [sortedTickets, maxRows],
  );

  const isTruncated = tickets.length > maxRows;

  /**
   * Handles a column header click: toggles direction if same column,
   * otherwise sets new column with ascending direction.
   *
   * @param {string} colKey
   */
  function handleHeaderClick(colKey) {
    setSortState((prev) => {
      if (prev.col === colKey) {
        return { col: colKey, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { col: colKey, dir: 'asc' };
    });
  }

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      {/* Header row: title + export button */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-slate-100 font-semibold text-sm">
          Tickets
          {isTruncated && (
            <span className="ml-2 text-amber-400 font-normal">
              Showing {maxRows} of {tickets.length} tickets
            </span>
          )}
        </h3>
        <button
          onClick={() => handleExport(displayedTickets)}
          disabled={tickets.length === 0}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          aria-label="Export CSV"
        >
          Export CSV
        </button>
      </div>

      {/* Empty state */}
      {tickets.length === 0 ? (
        <div className="py-12 text-center text-slate-400 text-sm">
          No tickets match the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-slate-100">
            <thead>
              <tr className="bg-slate-900 text-slate-400 text-xs uppercase">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    onClick={col.sortable ? () => handleHeaderClick(col.key) : undefined}
                    className={
                      'px-3 py-2 text-left select-none' +
                      (col.sortable ? ' cursor-pointer hover:text-slate-200' : '')
                    }
                    aria-sort={
                      sortState.col === col.key
                        ? sortState.dir === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : 'none'
                    }
                  >
                    {col.label}
                    {sortState.col === col.key && (
                      <span className="ml-1" aria-hidden="true">
                        {sortState.dir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayedTickets.map((ticket, idx) => (
                <tr
                  key={ticket.key}
                  className={idx % 2 === 0 ? 'bg-slate-800' : 'bg-slate-900'}
                >
                  {/* Key */}
                  <td className="px-3 py-2 font-mono text-blue-400 whitespace-nowrap">
                    {ticket.key}
                  </td>
                  {/* Summary */}
                  <td className="px-3 py-2 max-w-xs truncate" title={ticket.summary}>
                    {ticket.summary || '—'}
                  </td>
                  {/* Assignee */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {ticket.assignee || '—'}
                  </td>
                  {/* Bank */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {ticket.bank || '—'}
                  </td>
                  {/* Status */}
                  <td className="px-3 py-2 whitespace-nowrap">
                    {ticket.status || '—'}
                  </td>
                  {/* Age (days) */}
                  <td className="px-3 py-2 text-right tabular-nums">
                    {ticket.ageDays ?? '—'}
                  </td>
                  {/* SLA State */}
                  <td className={`px-3 py-2 whitespace-nowrap font-medium ${slaStateClass(ticket.slaState)}`}>
                    {ticket.slaState || '—'}
                  </td>
                  {/* Last Updated */}
                  <td className="px-3 py-2 whitespace-nowrap text-slate-300">
                    {formatDate(ticket.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
