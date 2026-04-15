/**
 * @fileoverview CsrKpiRow — renders nine KPI cards in a responsive horizontal grid.
 *
 * Receives the current and previous KpiSet objects, computes per-metric deltas,
 * classifies each delta's tone, and delegates rendering to CsrKpiCard.
 */

import CsrKpiCard from './CsrKpiCard.jsx';
import { classifyDeltaTone } from '../utils/csrAnalyticsAggregations.js';
import { formatPct, formatDays } from '../utils/csrAnalyticsFormatters.js';

/**
 * Computes `current - previous`, returning null when either operand is null/undefined.
 *
 * @param {number | null | undefined} current
 * @param {number | null | undefined} previous
 * @returns {number | null}
 */
function computeDelta(current, previous) {
  if (current == null || previous == null) return null;
  return current - previous;
}

/**
 * Renders nine CsrKpiCard instances in a responsive 3-column (mobile) /
 * 9-column (large screen) grid.
 *
 * @param {{
 *   kpis: import('../utils/csrAnalyticsTypes').KpiSet,
 *   prevKpis: import('../utils/csrAnalyticsTypes').KpiSet
 * }} props
 */
export default function CsrKpiRow({ kpis, prevKpis }) {
  if (!kpis || !prevKpis) return null;

  /**
   * KPI card definitions in display order.
   * Each entry describes how to extract, format, and classify a single metric.
   *
   * @type {Array<{
   *   label: string,
   *   rawValue: number | null,
   *   prevValue: number | null,
   *   format?: (v: number | null) => string,
   *   lowerIsBetter: boolean
   * }>}
   */
  const cards = [
    {
      label: 'Created this week',
      rawValue: kpis.createdThisWeek,
      prevValue: prevKpis.createdThisWeek,
      lowerIsBetter: true,
    },
    {
      label: 'Resolved this week',
      rawValue: kpis.resolvedThisWeek,
      prevValue: prevKpis.resolvedThisWeek,
      lowerIsBetter: false,
    },
    {
      label: 'Net backlog change',
      rawValue: kpis.netBacklogChange,
      prevValue: prevKpis.netBacklogChange,
      lowerIsBetter: true,
    },
    {
      label: 'Open backlog',
      rawValue: kpis.openBacklog,
      prevValue: prevKpis.openBacklog,
      lowerIsBetter: true,
    },
    {
      label: 'Avg resolution (4w)',
      rawValue: kpis.avgResolutionDays4w,
      prevValue: prevKpis.avgResolutionDays4w,
      format: formatDays,
      lowerIsBetter: true,
    },
    {
      label: 'Median resolution (4w)',
      rawValue: kpis.medianResolutionDays4w,
      prevValue: prevKpis.medianResolutionDays4w,
      format: formatDays,
      lowerIsBetter: true,
    },
    {
      label: 'SLA breach rate (4w)',
      rawValue: kpis.slaBreachRate4w,
      prevValue: prevKpis.slaBreachRate4w,
      format: formatPct,
      lowerIsBetter: true,
    },
    {
      label: '90+ day open',
      rawValue: kpis.openOver90Days,
      prevValue: prevKpis.openOver90Days,
      lowerIsBetter: true,
    },
    {
      label: 'Unassigned open %',
      rawValue: kpis.unassignedOpenPct,
      prevValue: prevKpis.unassignedOpenPct,
      format: formatPct,
      lowerIsBetter: true,
    },
  ];

  return (
    <div className="grid grid-cols-3 lg:grid-cols-9 gap-3">
      {cards.map(({ label, rawValue, prevValue, format, lowerIsBetter }) => {
        // Format the display value (null → card renders "—")
        const displayValue =
          rawValue === null || rawValue === undefined
            ? null
            : format
            ? format(rawValue)
            : rawValue;

        // Compute numeric delta for the badge
        const delta = computeDelta(rawValue, prevValue);

        // Classify tone based on delta direction and metric polarity
        const tone = classifyDeltaTone(delta, lowerIsBetter);

        return (
          <CsrKpiCard
            key={label}
            label={label}
            value={displayValue}
            delta={delta}
            tone={tone}
            lowerIsBetter={lowerIsBetter}
          />
        );
      })}
    </div>
  );
}
