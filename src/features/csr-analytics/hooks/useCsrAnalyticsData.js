/**
 * @fileoverview React hook that orchestrates the CSR Analytics data pipeline.
 *
 * Uses a module-level cache so data survives tab switches (component unmount/remount).
 * Fetches once on first use, then auto-refreshes every 30 minutes.
 * Manual refresh is available via the returned `refresh()` function.
 */

import { useState, useEffect, useMemo } from 'react';
import { fetchCSRIssues, transformCSRIssue, enrichWithLinkedTime } from '../../../utils/csrService.js';
import { normalizeTicket } from '../utils/csrAnalyticsTypes.js';
import {
  applyFilters,
  computeKpis,
  buildCreatedResolvedSeries,
  buildResolutionTrendSeries,
  buildSlaHealthSeries,
  buildBacklogTrendSeries,
  buildAgingBuckets,
  buildAssigneeWorkload,
} from '../utils/csrAnalyticsAggregations.js';

// ---------------------------------------------------------------------------
// Module-level cache — survives component unmount/remount (tab switches)
// ---------------------------------------------------------------------------

const AUTO_REFRESH_MS = 30 * 60 * 1000; // 30 minutes

/** @type {{ tickets: object[], lastFetch: Date|null, loading: boolean, error: string|null }} */
const _cache = {
  tickets: [],
  lastFetch: null,
  loading: false,
  error: null,
};

/** Registered setState callbacks from mounted hook instances */
const _listeners = new Set();

function _notify() {
  _listeners.forEach((fn) => fn({ ..._cache }));
}

let _autoRefreshTimer = null;

async function _doFetch() {
  if (_cache.loading) return; // already in flight
  _cache.loading = true;
  _cache.error = null;
  _notify();
  try {
    const raw = await fetchCSRIssues();
    const transformed = raw.map(transformCSRIssue);
    _cache.tickets = await enrichWithLinkedTime(transformed);
    _cache.lastFetch = new Date();
  } catch (err) {
    _cache.error = err?.message ?? 'Failed to load CSR tickets';
  } finally {
    _cache.loading = false;
    _notify();
  }
}

function _ensureAutoRefresh() {
  if (_autoRefreshTimer) return;
  _autoRefreshTimer = setInterval(() => {
    _doFetch();
  }, AUTO_REFRESH_MS);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCsrAnalyticsData({ filters, drilldowns }) {
  const [, forceUpdate] = useState(0);
  const [nextRefreshIn, setNextRefreshIn] = useState(null);

  // Subscribe to cache updates — force re-render on every change
  useEffect(() => {
    const handler = () => forceUpdate(n => n + 1);
    _listeners.add(handler);

    // Fetch on first mount if we have no data yet
    if (_cache.tickets.length === 0 && !_cache.loading) {
      _doFetch();
    }

    // Ensure the 30-min auto-refresh timer is running
    _ensureAutoRefresh();

    return () => {
      _listeners.delete(handler);
    };
  }, []);

  // Countdown timer — updates every second
  useEffect(() => {
    const tick = () => {
      if (!_cache.lastFetch) { setNextRefreshIn(null); return; }
      const elapsed = Date.now() - _cache.lastFetch.getTime();
      const remaining = Math.max(0, Math.ceil((AUTO_REFRESH_MS - elapsed) / 1000));
      setNextRefreshIn(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [_cache.lastFetch]);

  /** Manual refresh — triggers an immediate fetch */
  function refresh() {
    _cache.loading = false; // allow re-entry
    _doFetch();
  }

  // Read directly from cache on every render
  const rawTickets = _cache.tickets;

  // Normalise (memoised on rawTickets reference)
  const normalizedTickets = useMemo(
    () => rawTickets.map(normalizeTicket),
    [rawTickets],
  );

  // Filter (memoised on normalizedTickets + filter state)
  const filteredTickets = useMemo(
    () => applyFilters(normalizedTickets, filters, drilldowns),
    [normalizedTickets, filters, drilldowns],
  );

  // KPIs
  const kpis = useMemo(() => computeKpis(filteredTickets), [filteredTickets]);
  const prevKpis = useMemo(() => computeKpis(filteredTickets), [filteredTickets]);

  // Chart series (each independently memoised)
  const createdResolvedSeries = useMemo(() => buildCreatedResolvedSeries(filteredTickets), [filteredTickets]);
  const resolutionTrendSeries = useMemo(() => buildResolutionTrendSeries(filteredTickets), [filteredTickets]);
  const slaHealthSeries       = useMemo(() => buildSlaHealthSeries(filteredTickets),       [filteredTickets]);
  const backlogTrendSeries    = useMemo(() => buildBacklogTrendSeries(filteredTickets),    [filteredTickets]);
  const agingBuckets          = useMemo(() => buildAgingBuckets(filteredTickets),          [filteredTickets]);
  const assigneeWorkload      = useMemo(() => buildAssigneeWorkload(filteredTickets, 'open'), [filteredTickets]);

  return {
    normalizedTickets,
    filteredTickets,
    loading:       _cache.loading,
    error:         _cache.error,
    lastFetch:     _cache.lastFetch,
    nextRefreshIn,
    refresh,
    kpis,
    prevKpis,
    createdResolvedSeries,
    resolutionTrendSeries,
    slaHealthSeries,
    backlogTrendSeries,
    agingBuckets,
    assigneeWorkload,
  };
}

export default useCsrAnalyticsData;
