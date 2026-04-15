/**
 * @fileoverview Aggregation and filter functions for the CSR Analytics feature.
 *
 * All functions are pure — they take data as arguments and return new arrays
 * or objects without mutating their inputs.
 *
 * This module is split into three logical sections:
 *   1. Filter logic  — `applyFilters`
 *   2. KPI section   — `computeKpis`, `classifyDeltaTone`  (Task 5)
 *   3. Chart section — `buildCreatedResolvedSeries`, etc.  (Task 6)
 */

import { DEFAULT_MANUAL_FILTERS, AGE_BUCKETS, TOP_ASSIGNEES_COUNT } from './csrAnalyticsConstants.js';
import {
  isoWeekOf,
  fourWeekWindowBounds,
  isInWindow,
} from './csrAnalyticsDates.js';

// Re-export for convenience so consumers can import from one place.
export { DEFAULT_MANUAL_FILTERS };

// ---------------------------------------------------------------------------
// applyFilters
// ---------------------------------------------------------------------------

/**
 * Applies all ManualFilter dimensions and all DrilldownFilter dimensions to
 * the given ticket array as a logical AND, returning a new filtered array.
 *
 * ManualFilter dimensions applied (in order):
 *   1. `includeLegacy`  — when `false`, excludes tickets where `isLegacy === true`
 *   2. `ticketScope`    — `'open'` keeps only `isOpen === true`;
 *                         `'resolved'` keeps only `isResolved === true`;
 *                         `'all'` passes everything through
 *   3. `dateRange.start` — excludes tickets where `createdAt < start` (when non-empty)
 *   4. `dateRange.end`   — excludes tickets where `createdAt > end`   (when non-empty)
 *   5. `project`        — when not `'all'`, keeps only `ticket.project === value`
 *   6. `bank`           — when not `'all'`, keeps only `ticket.bank === value`
 *   7. `assignee`       — when not `'all'`, keeps only `ticket.assignee === value`
 *   8. `status`         — when not `'all'`, keeps only `ticket.status === value`
 *   9. `issueType`      — when not `'all'`, keeps only `ticket.issueType === value`
 *
 * DrilldownFilter dimensions applied:
 *   - `'week-created'`  — tickets where `isoWeekOf(createdAt) === value`
 *   - `'week-resolved'` — tickets where `isoWeekOf(resolvedAt) === value`
 *   - `'week-sla'`      — tickets where `isoWeekOf(createdAt) === value.week`
 *                         AND `slaState === value.slaState`
 *   - `'age-bucket'`    — tickets where `ageDays` falls within the named bucket
 *   - unknown dimension — passes through (no filtering)
 *
 * @param {import('./csrAnalyticsTypes').NormalizedCsrTicket[]} tickets
 *   The full normalised ticket array to filter.
 * @param {import('./csrAnalyticsTypes').ManualFilters} [manualFilters]
 *   Manual filter state. Defaults to `DEFAULT_MANUAL_FILTERS` when omitted.
 * @param {Array<{ dimension: string, value: * }>} [drilldownFilters]
 *   Drilldown filter array. Defaults to `[]` when omitted or null.
 * @returns {import('./csrAnalyticsTypes').NormalizedCsrTicket[]}
 *   A new array containing only the tickets that pass all active filters.
 */
export function applyFilters(tickets, manualFilters, drilldownFilters) {
  // ── Guard: handle null / undefined inputs ─────────────────────────────────
  if (!Array.isArray(tickets) || tickets.length === 0) return [];

  const filters = manualFilters ?? DEFAULT_MANUAL_FILTERS;
  const drilldowns = Array.isArray(drilldownFilters) ? drilldownFilters : [];

  // ── Destructure ManualFilters with safe defaults ───────────────────────────
  const {
    includeLegacy  = DEFAULT_MANUAL_FILTERS.includeLegacy,
    ticketScope    = DEFAULT_MANUAL_FILTERS.ticketScope,
    dateRange      = DEFAULT_MANUAL_FILTERS.dateRange,
    project        = DEFAULT_MANUAL_FILTERS.project,
    bank           = DEFAULT_MANUAL_FILTERS.bank,
    assignee       = DEFAULT_MANUAL_FILTERS.assignee,
    status         = DEFAULT_MANUAL_FILTERS.status,
    issueType      = DEFAULT_MANUAL_FILTERS.issueType,
  } = filters;

  const { start: dateStart = '', end: dateEnd = '' } = dateRange ?? {};

  return tickets.filter((ticket) => {
    // ── 1. Legacy exclusion ─────────────────────────────────────────────────
    if (!includeLegacy && ticket.isLegacy === true) return false;

    // ── 2. Ticket scope ─────────────────────────────────────────────────────
    if (ticketScope === 'open'     && !ticket.isOpen)     return false;
    if (ticketScope === 'resolved' && !ticket.isResolved) return false;

    // ── 3. Date range — start ───────────────────────────────────────────────
    if (dateStart) {
      // Compare ISO date strings lexicographically (YYYY-MM-DD prefix is safe)
      const createdDay = (ticket.createdAt ?? '').slice(0, 10);
      if (createdDay < dateStart) return false;
    }

    // ── 4. Date range — end ─────────────────────────────────────────────────
    if (dateEnd) {
      const createdDay = (ticket.createdAt ?? '').slice(0, 10);
      if (createdDay > dateEnd) return false;
    }

    // ── 5. Project ──────────────────────────────────────────────────────────
    if (project !== 'all' && ticket.project !== project) return false;

    // ── 6. Bank ─────────────────────────────────────────────────────────────
    if (bank !== 'all' && ticket.bank !== bank) return false;

    // ── 7. Assignee ─────────────────────────────────────────────────────────
    if (assignee !== 'all' && ticket.assignee !== assignee) return false;

    // ── 8. Status ───────────────────────────────────────────────────────────
    if (status !== 'all' && ticket.status !== status) return false;

    // ── 9. Issue type ───────────────────────────────────────────────────────
    if (issueType !== 'all' && ticket.issueType !== issueType) return false;

    // ── Drilldown filters (logical AND across all active drilldowns) ─────────
    for (const drill of drilldowns) {
      const { dimension, value } = drill;

      switch (dimension) {
        case 'week-created':
          if (isoWeekOf(ticket.createdAt) !== value) return false;
          break;

        case 'week-resolved':
          if (isoWeekOf(ticket.resolvedAt) !== value) return false;
          break;

        case 'week-sla':
          // value is { week: string, slaState: string }
          if (
            isoWeekOf(ticket.createdAt) !== value?.week ||
            ticket.slaState !== value?.slaState
          ) return false;
          break;

        case 'age-bucket': {
          // value is the bucket label string (e.g. '0–7 days')
          const bucket = AGE_BUCKETS.find((b) => b.label === value);
          if (!bucket) return false; // unknown bucket label — exclude
          if (ticket.ageDays < bucket.min || ticket.ageDays > bucket.max) return false;
          break;
        }

        default:
          // Unknown dimension — pass through (no filtering)
          break;
      }
    }

    return true;
  });
}

// ---------------------------------------------------------------------------
// KPI section
// ---------------------------------------------------------------------------

/**
 * Computes all nine KPI metrics from a filtered ticket array.
 *
 * All window calculations use UTC-based bounds from `csrAnalyticsDates.js`.
 * The "current week" is determined by comparing `isoWeekOf(ticket.createdAt)`
 * against `isoWeekOf(new Date().toISOString())`.
 *
 * @param {import('./csrAnalyticsTypes').NormalizedCsrTicket[]} tickets
 *   The filtered ticket array (already passed through `applyFilters`).
 * @returns {import('./csrAnalyticsTypes').KpiSet}
 */
export function computeKpis(tickets) {
  if (!Array.isArray(tickets)) {
    return {
      createdThisWeek: 0,
      resolvedThisWeek: 0,
      netBacklogChange: 0,
      openBacklog: 0,
      avgResolutionDays4w: null,
      medianResolutionDays4w: null,
      slaBreachRate4w: null,
      openOver90Days: 0,
      unassignedOpenPct: null,
    };
  }

  const currentWeek = isoWeekOf(new Date().toISOString());
  const fw = fourWeekWindowBounds();

  // ── Count-based KPIs ──────────────────────────────────────────────────────

  let createdThisWeek = 0;
  let resolvedThisWeek = 0;
  let openBacklog = 0;
  let openOver90Days = 0;

  // ── Resolution stats (4w window) ─────────────────────────────────────────
  const resolutionDaysIn4w = [];

  // ── SLA breach rate (4w window) ──────────────────────────────────────────
  let slaBreachCount4w = 0;
  let slaDenominator4w = 0;

  // ── Unassigned open % ────────────────────────────────────────────────────
  let openCount = 0;
  let unassignedOpenCount = 0;

  for (const ticket of tickets) {
    // Created this week
    if (isoWeekOf(ticket.createdAt) === currentWeek) {
      createdThisWeek++;
    }

    // Resolved this week
    if (ticket.resolvedAt && isoWeekOf(ticket.resolvedAt) === currentWeek) {
      resolvedThisWeek++;
    }

    // Open backlog
    if (ticket.isOpen === true) {
      openBacklog++;
      openCount++;

      // Open over 90 days
      if (ticket.ageDays >= 90) {
        openOver90Days++;
      }

      // Unassigned open
      const a = ticket.assignee;
      if (a === null || a === undefined || a === '' || a === 'Unassigned') {
        unassignedOpenCount++;
      }
    }

    // Avg / median resolution days (4w): resolved tickets with resolvedAt in 4w window
    if (
      ticket.resolvedAt != null &&
      ticket.resolutionDays != null &&
      isInWindow(ticket.resolvedAt, fw)
    ) {
      resolutionDaysIn4w.push(ticket.resolutionDays);
    }

    // SLA breach rate (4w): tickets with createdAt in 4w window and non-null slaState
    if (ticket.slaState != null && isInWindow(ticket.createdAt, fw)) {
      slaDenominator4w++;
      if (ticket.slaState === 'breaching') {
        slaBreachCount4w++;
      }
    }
  }

  // ── Derived KPIs ──────────────────────────────────────────────────────────

  const netBacklogChange = createdThisWeek - resolvedThisWeek;

  // Avg resolution days (4w)
  let avgResolutionDays4w = null;
  if (resolutionDaysIn4w.length > 0) {
    const sum = resolutionDaysIn4w.reduce((acc, v) => acc + v, 0);
    avgResolutionDays4w = sum / resolutionDaysIn4w.length;
  }

  // Median resolution days (4w)
  let medianResolutionDays4w = null;
  if (resolutionDaysIn4w.length > 0) {
    const sorted = [...resolutionDaysIn4w].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    medianResolutionDays4w =
      sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
  }

  // SLA breach rate (4w)
  const slaBreachRate4w =
    slaDenominator4w === 0 ? null : slaBreachCount4w / slaDenominator4w;

  // Unassigned open %
  const unassignedOpenPct =
    openCount === 0 ? null : unassignedOpenCount / openCount;

  return {
    createdThisWeek,
    resolvedThisWeek,
    netBacklogChange,
    openBacklog,
    avgResolutionDays4w,
    medianResolutionDays4w,
    slaBreachRate4w,
    openOver90Days,
    unassignedOpenPct,
  };
}

// ---------------------------------------------------------------------------
// classifyDeltaTone
// ---------------------------------------------------------------------------

/**
 * Classifies a KPI delta value as `'good'`, `'danger'`, or `'neutral'`
 * based on the direction of the change and whether a lower value is better.
 *
 * Truth table:
 * | delta      | lowerIsBetter | tone      |
 * |------------|---------------|-----------|
 * | < 0        | true          | 'good'    |
 * | > 0        | true          | 'danger'  |
 * | > 0        | false         | 'good'    |
 * | < 0        | false         | 'danger'  |
 * | === 0      | any           | 'neutral' |
 * | null       | any           | 'neutral' |
 *
 * @param {number | null} delta - The difference between current and previous period.
 * @param {boolean} lowerIsBetter - Whether a lower value indicates improvement.
 * @returns {'good' | 'danger' | 'neutral'}
 */
export function classifyDeltaTone(delta, lowerIsBetter) {
  if (delta === null || delta === undefined || delta === 0) return 'neutral';
  if (delta < 0) return lowerIsBetter ? 'good' : 'danger';
  // delta > 0
  return lowerIsBetter ? 'danger' : 'good';
}

// ---------------------------------------------------------------------------
// Chart section
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// buildCreatedResolvedSeries
// ---------------------------------------------------------------------------

/**
 * Builds the data series for the Created vs Resolved chart.
 *
 * Groups tickets by ISO week:
 * - `created` count: tickets grouped by `isoWeekOf(createdAt)`
 * - `resolved` count: tickets grouped by `isoWeekOf(resolvedAt)` (non-null only)
 *
 * Returns one entry per week that appears in either group, sorted ascending
 * by week string.
 *
 * @param {import('./csrAnalyticsTypes').NormalizedCsrTicket[]} tickets
 * @returns {{ week: string, created: number, resolved: number }[]}
 */
export function buildCreatedResolvedSeries(tickets) {
  if (!Array.isArray(tickets) || tickets.length === 0) return [];

  /** @type {Map<string, { created: number, resolved: number }>} */
  const map = new Map();

  const getOrCreate = (week) => {
    if (!week) return null;
    if (!map.has(week)) map.set(week, { created: 0, resolved: 0 });
    return map.get(week);
  };

  for (const ticket of tickets) {
    const createdWeek = isoWeekOf(ticket.createdAt);
    const entry = getOrCreate(createdWeek);
    if (entry) entry.created++;

    if (ticket.resolvedAt != null) {
      const resolvedWeek = isoWeekOf(ticket.resolvedAt);
      const rEntry = getOrCreate(resolvedWeek);
      if (rEntry) rEntry.resolved++;
    }
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([week, counts]) => ({ week, ...counts }));
}

// ---------------------------------------------------------------------------
// buildResolutionTrendSeries
// ---------------------------------------------------------------------------

/**
 * Computes a helper median for an array of numbers.
 *
 * @param {number[]} sorted - A pre-sorted array of numbers.
 * @returns {number}
 */
function medianOfSorted(sorted) {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Builds the data series for the Resolution Trend chart.
 *
 * Groups resolved tickets (non-null `resolvedAt` AND non-null `resolutionDays`)
 * by `isoWeekOf(resolvedAt)`. For each week computes:
 * - `median`: statistical median of `resolutionDays`
 * - `avg`: arithmetic mean of `resolutionDays`
 * - `sampleSize`: count of resolved tickets in that week
 *
 * Returns entries sorted ascending by week string.
 *
 * @param {import('./csrAnalyticsTypes').NormalizedCsrTicket[]} tickets
 * @returns {{ week: string, median: number, avg: number, sampleSize: number }[]}
 */
export function buildResolutionTrendSeries(tickets) {
  if (!Array.isArray(tickets) || tickets.length === 0) return [];

  /** @type {Map<string, number[]>} */
  const map = new Map();

  for (const ticket of tickets) {
    if (ticket.resolvedAt == null || ticket.resolutionDays == null) continue;
    const week = isoWeekOf(ticket.resolvedAt);
    if (!week) continue;
    if (!map.has(week)) map.set(week, []);
    map.get(week).push(ticket.resolutionDays);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([week, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const avg = values.reduce((s, v) => s + v, 0) / values.length;
      const median = medianOfSorted(sorted);
      return { week, median, avg, sampleSize: values.length };
    });
}

// ---------------------------------------------------------------------------
// buildSlaHealthSeries
// ---------------------------------------------------------------------------

/**
 * Builds the data series for the SLA Health stacked bar chart.
 *
 * Groups tickets by `isoWeekOf(createdAt)` and buckets each ticket by its
 * `slaState` value (`'on-track'`, `'at-risk'`, `'breaching'`).
 *
 * Returns entries sorted ascending by week string.
 *
 * @param {import('./csrAnalyticsTypes').NormalizedCsrTicket[]} tickets
 * @returns {{ week: string, onTrack: number, atRisk: number, breaching: number }[]}
 */
export function buildSlaHealthSeries(tickets) {
  if (!Array.isArray(tickets) || tickets.length === 0) return [];

  /** @type {Map<string, { onTrack: number, atRisk: number, breaching: number }>} */
  const map = new Map();

  for (const ticket of tickets) {
    const week = isoWeekOf(ticket.createdAt);
    if (!week) continue;
    if (!map.has(week)) map.set(week, { onTrack: 0, atRisk: 0, breaching: 0 });
    const entry = map.get(week);
    if (ticket.slaState === 'on-track')  entry.onTrack++;
    else if (ticket.slaState === 'at-risk')   entry.atRisk++;
    else if (ticket.slaState === 'breaching') entry.breaching++;
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([week, counts]) => ({ week, ...counts }));
}

// ---------------------------------------------------------------------------
// buildBacklogTrendSeries
// ---------------------------------------------------------------------------

/**
 * Builds the data series for the Open Backlog Trend area chart.
 *
 * For each ISO week that appears in the ticket set (via `createdAt` or
 * `resolvedAt`), computes:
 * - `netChange`: (tickets created that week) − (tickets resolved that week)
 * - `cumulative`: running sum of `netChange` across all weeks up to and
 *   including this week (ascending order)
 *
 * Returns entries sorted ascending by week string.
 *
 * @param {import('./csrAnalyticsTypes').NormalizedCsrTicket[]} tickets
 * @returns {{ week: string, cumulative: number, netChange: number }[]}
 */
export function buildBacklogTrendSeries(tickets) {
  if (!Array.isArray(tickets) || tickets.length === 0) return [];

  /** @type {Map<string, { created: number, resolved: number }>} */
  const map = new Map();

  const getOrCreate = (week) => {
    if (!week) return null;
    if (!map.has(week)) map.set(week, { created: 0, resolved: 0 });
    return map.get(week);
  };

  for (const ticket of tickets) {
    const createdWeek = isoWeekOf(ticket.createdAt);
    const entry = getOrCreate(createdWeek);
    if (entry) entry.created++;

    if (ticket.resolvedAt != null) {
      const resolvedWeek = isoWeekOf(ticket.resolvedAt);
      const rEntry = getOrCreate(resolvedWeek);
      if (rEntry) rEntry.resolved++;
    }
  }

  const sorted = Array.from(map.entries()).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  let cumulative = 0;
  return sorted.map(([week, { created, resolved }]) => {
    const netChange = created - resolved;
    cumulative += netChange;
    return { week, cumulative, netChange };
  });
}

// ---------------------------------------------------------------------------
// buildAgingBuckets
// ---------------------------------------------------------------------------

/**
 * Builds the data for the Backlog Aging horizontal bar chart.
 *
 * Counts only open tickets (`isOpen === true`) and assigns each to exactly
 * one of the five age buckets defined in `AGE_BUCKETS` based on `ageDays`.
 *
 * Returns one entry per bucket in the same order as `AGE_BUCKETS`.
 *
 * @param {import('./csrAnalyticsTypes').NormalizedCsrTicket[]} tickets
 * @returns {{ bucket: string, count: number }[]}
 */
export function buildAgingBuckets(tickets) {
  // Initialise all buckets to 0 so the chart always has all five bars.
  const counts = AGE_BUCKETS.map((b) => ({ bucket: b.label, count: 0 }));

  if (!Array.isArray(tickets) || tickets.length === 0) return counts;

  for (const ticket of tickets) {
    if (!ticket.isOpen) continue;
    const idx = AGE_BUCKETS.findIndex(
      (b) => ticket.ageDays >= b.min && ticket.ageDays <= b.max,
    );
    if (idx !== -1) counts[idx].count++;
  }

  return counts;
}

// ---------------------------------------------------------------------------
// buildAssigneeWorkload
// ---------------------------------------------------------------------------

/**
 * Builds the data for the Assignee Workload horizontal bar chart.
 *
 * Supports three modes:
 * - `'open'`:     counts tickets where `isOpen === true` per assignee
 * - `'created'`:  counts tickets where `isoWeekOf(createdAt)` equals the
 *                 current ISO week per assignee
 * - `'resolved'`: counts tickets where `isoWeekOf(resolvedAt)` equals the
 *                 current ISO week per assignee
 *
 * Returns the top `TOP_ASSIGNEES_COUNT` (8) assignees by count, sorted
 * descending, plus a single `'Other'` entry aggregating all remaining
 * assignees (only when there are more than 8 distinct assignees).
 *
 * @param {import('./csrAnalyticsTypes').NormalizedCsrTicket[]} tickets
 * @param {'open'|'created'|'resolved'} mode
 * @returns {{ assignee: string, count: number }[]}
 */
export function buildAssigneeWorkload(tickets, mode) {
  if (!Array.isArray(tickets) || tickets.length === 0) return [];

  const currentWeek = isoWeekOf(new Date().toISOString());

  /** @type {Map<string, number>} */
  const map = new Map();

  for (const ticket of tickets) {
    let include = false;

    if (mode === 'open') {
      include = ticket.isOpen === true;
    } else if (mode === 'created') {
      include = isoWeekOf(ticket.createdAt) === currentWeek;
    } else if (mode === 'resolved') {
      include =
        ticket.resolvedAt != null &&
        isoWeekOf(ticket.resolvedAt) === currentWeek;
    }

    if (!include) continue;

    const assignee = ticket.assignee || 'Unassigned';
    map.set(assignee, (map.get(assignee) ?? 0) + 1);
  }

  if (map.size === 0) return [];

  // Sort by count descending
  const sorted = Array.from(map.entries())
    .sort(([, a], [, b]) => b - a);

  if (sorted.length <= TOP_ASSIGNEES_COUNT) {
    return sorted.map(([assignee, count]) => ({ assignee, count }));
  }

  // Top 8 + 'Other'
  const top = sorted.slice(0, TOP_ASSIGNEES_COUNT);
  const otherCount = sorted
    .slice(TOP_ASSIGNEES_COUNT)
    .reduce((sum, [, c]) => sum + c, 0);

  return [
    ...top.map(([assignee, count]) => ({ assignee, count })),
    { assignee: 'Other', count: otherCount },
  ];
}
