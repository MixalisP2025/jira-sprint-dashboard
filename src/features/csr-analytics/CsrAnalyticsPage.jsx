/**
 * @fileoverview Top-level container component for the CSR Analytics feature.
 *
 * Orchestrates the three hooks (filters, drilldown, data), renders the loading
 * spinner, error banner, and the full analytics layout on success.
 *
 * Requirements: 1.1, 1.4, 3.1–3.4
 */

import { useState, useMemo } from 'react';
import { Loader2, AlertCircle } from 'lucide-react';
import { useCsrAnalyticsFilters } from './hooks/useCsrAnalyticsFilters.js';
import { useCsrAnalyticsDrilldown } from './hooks/useCsrAnalyticsDrilldown.js';
import { useCsrAnalyticsData } from './hooks/useCsrAnalyticsData.js';
import CsrAnalyticsHeader from './components/CsrAnalyticsHeader.jsx';
import CsrAnalyticsFilters from './components/CsrAnalyticsFilters.jsx';
import CsrAnalyticsActiveChips from './components/CsrAnalyticsActiveChips.jsx';
import CsrKpiRow from './components/CsrKpiRow.jsx';
import CsrCreatedResolvedChart from './components/CsrCreatedResolvedChart.jsx';
import CsrResolutionTrendChart from './components/CsrResolutionTrendChart.jsx';
import CsrSlaHealthChart from './components/CsrSlaHealthChart.jsx';
import CsrBacklogTrendChart from './components/CsrBacklogTrendChart.jsx';
import CsrBacklogAgingChart from './components/CsrBacklogAgingChart.jsx';
import CsrAssigneeWorkloadChart from './components/CsrAssigneeWorkloadChart.jsx';
import CsrAnalyticsTicketGrid from './components/CsrAnalyticsTicketGrid.jsx';

/**
 * Top-level CSR Analytics page component.
 *
 * Fetches, normalises, filters, and aggregates CSR ticket data via the three
 * analytics hooks, then renders the full analytics layout.
 *
 * @returns {JSX.Element}
 */
export default function CsrAnalyticsPage() {
  // ── Hook instantiation ─────────────────────────────────────────────────────
  const { filters, setFilter, resetFilters } = useCsrAnalyticsFilters();
  const { drilldowns, setDrilldown, clearDrilldown, clearDrilldownDimension } =
    useCsrAnalyticsDrilldown();
  const {
    normalizedTickets,
    filteredTickets,
    loading,
    error,
    refresh,
    lastFetch,
    nextRefreshIn,
    kpis,
    prevKpis,
    createdResolvedSeries,
    resolutionTrendSeries,
    slaHealthSeries,
    backlogTrendSeries,
    agingBuckets,
    assigneeWorkload,
  } = useCsrAnalyticsData({ filters, drilldowns });

  // ── Local state ────────────────────────────────────────────────────────────
  const [assigneeWorkloadMode, setAssigneeWorkloadMode] = useState('open');
  const [searchQuery, setSearchQuery] = useState('');

  // ── Search filter applied to the ticket grid ──────────────────────────────
  const searchedTickets = useMemo(() => {
    if (!searchQuery.trim()) return filteredTickets;
    const q = searchQuery.trim().toLowerCase();
    return filteredTickets.filter(t =>
      (t.key && t.key.toLowerCase().includes(q)) ||
      (t.summary && t.summary.toLowerCase().includes(q)) ||
      (t.assignee && t.assignee.toLowerCase().includes(q)) ||
      (t.bank && t.bank.toLowerCase().includes(q)) ||
      (t.project && t.project.toLowerCase().includes(q))
    );
  }, [filteredTickets, searchQuery]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  /**
   * Resets a single filter dimension to its default value.
   * Handles nested `dateRange.start` / `dateRange.end` keys specially.
   *
   * @param {string} key - The filter dimension key to reset.
   */
  function handleResetDimension(key) {
    if (key === 'dateRange.start') {
      setFilter('dateRange', { ...filters.dateRange, start: '' });
    } else if (key === 'dateRange.end') {
      setFilter('dateRange', { ...filters.dateRange, end: '' });
    } else {
      // Reset to default value
      const defaults = {
        project: 'all',
        bank: 'all',
        assignee: 'all',
        status: 'all',
        issueType: 'all',
        includeLegacy: false,
        ticketScope: 'all',
      };
      setFilter(key, defaults[key]);
    }
  }

  /**
   * Clears all manual filters and all drilldown filters simultaneously.
   */
  function handleClearAll() {
    resetFilters();
    clearDrilldown();
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-900">
      {/* Header is always visible so the user can refresh even during load/error */}
      <CsrAnalyticsHeader title="CSR Analytics" loading={loading} onRefresh={refresh} />

      {/* Last fetch time + auto-refresh countdown */}
      {(lastFetch || nextRefreshIn !== null) && (
        <div className="flex items-center gap-4 px-6 py-2 bg-slate-800/50 border-b border-slate-700 text-xs text-slate-400">
          {lastFetch && <span>Updated {lastFetch.toLocaleTimeString('en-GB')}</span>}
          {nextRefreshIn !== null && !loading && (
            <span>
              Auto-refresh in {Math.floor(nextRefreshIn / 60)}:{String(nextRefreshIn % 60).padStart(2, '0')}
            </span>
          )}
        </div>
      )}

      {/* Loading state — only show spinner on first load (no data yet) */}
      {loading && normalizedTickets.length === 0 && (
        <div className="flex items-center justify-center py-16 text-slate-400">
          <Loader2 size={28} className="animate-spin mr-2" />
          Loading analytics…
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-700 text-red-400 text-sm rounded-lg mx-6 mt-4">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Full analytics layout — rendered once we have data (stays visible during background refresh) */}
      {normalizedTickets.length > 0 && !error && (
        <>
          <CsrAnalyticsFilters
            filters={filters}
            onFiltersChange={setFilter}
            tickets={normalizedTickets}
          />

          {/* Search bar */}
          <div className="px-6 pt-3">
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search tickets (key, summary, assignee, bank...)"
                className="w-full px-4 py-2.5 pl-10 bg-slate-700 border border-slate-600 rounded-xl text-sm text-slate-100 placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 text-sm">✕</button>
              )}
            </div>
          </div>

          <CsrAnalyticsActiveChips
            filters={filters}
            drilldowns={drilldowns}
            onResetDimension={handleResetDimension}
            onClearDrilldownDimension={clearDrilldownDimension}
            onClearAll={handleClearAll}
          />

          <div className="p-6">
            <CsrKpiRow kpis={kpis} prevKpis={prevKpis} />
          </div>

          {/* Chart grid — 1 column on mobile, 2 columns on lg+ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-6 pb-4">
            <CsrCreatedResolvedChart
              data={createdResolvedSeries}
              onDrilldown={setDrilldown}
            />
            <CsrResolutionTrendChart
              data={resolutionTrendSeries}
              onDrilldown={setDrilldown}
            />
            <CsrSlaHealthChart
              data={slaHealthSeries}
              onDrilldown={setDrilldown}
            />
            <CsrBacklogTrendChart data={backlogTrendSeries} />
            <CsrBacklogAgingChart
              data={agingBuckets}
              onDrilldown={setDrilldown}
            />
            <CsrAssigneeWorkloadChart
              data={assigneeWorkload}
              mode={assigneeWorkloadMode}
              onModeChange={setAssigneeWorkloadMode}
            />
          </div>

          {/* Ticket grid */}
          <div className="px-6 pb-6">
            <CsrAnalyticsTicketGrid tickets={searchedTickets} />
          </div>
        </>
      )}
    </div>
  );
}
