/**
 * @fileoverview Constants for the CSR Analytics feature.
 * Centralises all shared configuration values: default filter state,
 * age bucket definitions, colour palettes, and grid limits.
 */

/**
 * Default state for the ManualFilters object used by useCsrAnalyticsFilters.
 *
 * @type {import('./csrAnalyticsTypes').ManualFilters}
 */
export const DEFAULT_MANUAL_FILTERS = {
  dateRange: { start: '', end: '' },
  project: 'all',
  bank: 'all',
  assignee: 'all',
  status: 'all',
  issueType: 'all',
  includeLegacy: false,
  ticketScope: 'all',
};

/**
 * Five age bucket definitions for the Backlog Aging chart.
 * Each bucket has a human-readable label and inclusive min/max day bounds.
 * A `max` of `Infinity` means "no upper bound".
 *
 * @type {Array<{ label: string, min: number, max: number }>}
 */
export const AGE_BUCKETS = [
  { label: '0–7 days',   min: 0,  max: 7   },
  { label: '8–30 days',  min: 8,  max: 30  },
  { label: '31–60 days', min: 31, max: 60  },
  { label: '61–90 days', min: 61, max: 90  },
  { label: '90+ days',   min: 91, max: Infinity },
];

/**
 * Colours used for individual assignee bars in the Assignee Workload chart.
 * Cycles through this array when there are more assignees than colours.
 *
 * @type {string[]}
 */
export const ASSIGNEE_COLORS = [
  '#3b82f6', // blue-500
  '#8b5cf6', // violet-500
  '#10b981', // emerald-500
  '#f59e0b', // amber-500
  '#ef4444', // red-500
  '#06b6d4', // cyan-500
  '#ec4899', // pink-500
  '#84cc16', // lime-500
  '#f97316', // orange-500
];

/**
 * Colour mapping for SLA state values used in the SLA Health chart.
 *
 * @type {{ 'on-track': string, 'at-risk': string, breaching: string }}
 */
export const SLA_COLORS = {
  'on-track': '#10b981',  // emerald-500 — green
  'at-risk':  '#f59e0b',  // amber-500  — amber
  'breaching': '#ef4444', // red-500    — red
};

/**
 * General-purpose chart colour palette used across multiple charts.
 * Includes semantic aliases for the most common series.
 *
 * @type {{ created: string, resolved: string, median: string, avg: string, backlog: string, other: string, gradient: string[] }}
 */
export const CHART_COLORS = {
  created:  '#3b82f6', // blue-500  — created tickets bar
  resolved: '#10b981', // emerald-500 — resolved tickets bar
  median:   '#8b5cf6', // violet-500 — median resolution line
  avg:      '#f59e0b', // amber-500  — average resolution line
  backlog:  '#6366f1', // indigo-500 — backlog area fill / stroke
  other:    '#64748b', // slate-500  — "Other" assignee bar
  /** Gradient from green → red used for age bucket bars (index 0 = youngest). */
  gradient: [
    '#10b981', // 0–7 days   — emerald
    '#84cc16', // 8–30 days  — lime
    '#f59e0b', // 31–60 days — amber
    '#f97316', // 61–90 days — orange
    '#ef4444', // 90+ days   — red
  ],
};

/**
 * Maximum number of rows the Ticket Grid will display.
 * When FilteredTickets exceeds this value a notice is shown.
 *
 * @type {number}
 */
export const MAX_GRID_ROWS = 500;

/**
 * Number of top assignees shown individually in the Assignee Workload chart.
 * All remaining assignees are aggregated into a single "Other" bar.
 *
 * @type {number}
 */
export const TOP_ASSIGNEES_COUNT = 8;
