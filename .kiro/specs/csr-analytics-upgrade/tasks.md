# Implementation Plan: CSR Analytics Upgrade

## Overview

Replace `src/components/CSRAnalyticsTab.jsx` with a fully-featured analytics layer in `src/features/csr-analytics/`. Implementation proceeds in three phases: Foundation (utilities, hooks, data pipeline), Core Charts (KPI row + first three charts), then Remaining Charts + polish (last three charts, ticket grid, wiring). All files are `.jsx` / `.js` with JSDoc — no TypeScript.

## Tasks

- [x] 1. Scaffold feature directory and utility modules
  - Create the directory tree: `src/features/csr-analytics/components/`, `hooks/`, `utils/`
  - Create `src/features/csr-analytics/utils/csrAnalyticsConstants.js` — export `DEFAULT_MANUAL_FILTERS`, `AGE_BUCKETS` (five bucket definitions), `ASSIGNEE_COLORS`, `SLA_COLORS`, `CHART_COLORS`, `MAX_GRID_ROWS = 500`, `TOP_ASSIGNEES_COUNT = 8`
  - Create `src/features/csr-analytics/utils/csrAnalyticsFormatters.js` — export `formatPct(decimal)`, `formatDays(n)`, `formatDelta(n)`, `formatDate(isoStr)`, `csvEscape(str)`
  - _Requirements: 2.3, 2.6_

- [x] 2. Implement date utilities (`csrAnalyticsDates.js`)
  - Create `src/features/csr-analytics/utils/csrAnalyticsDates.js`
  - Move the `getISOWeek` logic from `src/components/CSRAnalyticsTab.jsx` into this module and export it as `isoWeekOf(dateStr)` — same ISO 8601 algorithm, same edge-case handling for Sunday
  - Export `currentWeekBounds()` — returns `{ start: Date, end: Date }` for Monday 00:00:00 UTC to Sunday 23:59:59 UTC of the current ISO week
  - Export `previousWeekBounds()` — same shape, one week earlier
  - Export `fourWeekWindowBounds()` — returns `{ start: Date, end: Date }` for the 28-day period ending at 23:59:59 on the last day of the current week
  - Export `previousFourWeekWindowBounds()` — same shape, shifted back 28 days
  - Export `isInWindow(isoDateStr, bounds)` — returns boolean
  - _Requirements: 17.10, 17.11, 17.12_

  - [ ]* 2.1 Write property test for `isoWeekOf` (Property 21)
    - **Property 21: ISO week function consistency**
    - Generate `fc.date()` values; assert output matches `YYYY-Www` pattern and that two dates in the same ISO week return the same string
    - **Validates: Requirements 17.10**

- [x] 3. Implement data normalisation (`csrAnalyticsTypes.js`)
  - Create `src/features/csr-analytics/utils/csrAnalyticsTypes.js`
  - Export `normalizeTicket(rawTicket)` — maps from `transformCSRIssue` output (fields: `key`, `summary`, `status`, `statusCat`, `assignee`, `bank`, `project`, `projectKey`, `issueType`, `priority`, `created`, `updated`, `resolved`, `age`, `isSLABreach`, `slaRisk`, `jiraBreached`) to `NormalizedCsrTicket`
  - Derive `isOpen`: `true` when `status` is not `'Completed'` or `'Closed'` and `statusCat` is not `'Done'`
  - Derive `isResolved`: `true` when `resolved` is a non-null, non-empty string
  - Derive `ageDays`: `Math.floor((Date.now() - new Date(created)) / 86400000)`
  - Derive `resolutionDays`: `Math.floor((new Date(resolved) - new Date(created)) / 86400000)` when `resolved` is non-null, else `null`
  - Derive `slaState` by calling `getSLARisk` from `csrService.js` (pass the raw ticket through)
  - Derive `isLegacy`: `new Date(created) < new Date(Date.now() - 2 * 365 * 86400000)`
  - Map `created → createdAt`, `updated → updatedAt`, `resolved → resolvedAt`
  - _Requirements: 4.1–4.7_

  - [ ]* 3.1 Write property test for normalisation shape (Property 1)
    - **Property 1: Normalisation preserves ticket count and shape**
    - Generate `fc.array(rawCsrTicketArbitrary)` — build a minimal arbitrary that produces objects with the fields `transformCSRIssue` outputs; assert output length equals input length and every element has all required `NormalizedCsrTicket` fields
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**

  - [ ]* 3.2 Write property test for `isOpen` derivation (Property 2)
    - **Property 2: isOpen derivation is correct for all status values**
    - Generate `fc.record({ status: fc.string(), statusCat: fc.string() })` with arbitrary status strings; assert `isOpen` is `true` iff status is not `'Completed'`/`'Closed'` and statusCat is not `'Done'`
    - **Validates: Requirements 4.2**

  - [ ]* 3.3 Write property test for `resolutionDays` round-trip (Property 3)
    - **Property 3: resolutionDays round-trip**
    - Generate `fc.record({ createdAt: isoDateArbitrary, resolvedAt: fc.option(isoDateArbitrary) })`; assert `resolutionDays` equals the floor-division formula when `resolvedAt` is non-null, and `null` otherwise
    - **Validates: Requirements 4.5**

  - [ ]* 3.4 Write property test for `isLegacy` threshold (Property 4)
    - **Property 4: isLegacy threshold**
    - Generate `fc.date()` values; assert `isLegacy` matches `new Date(createdAt) < new Date(Date.now() - 2 * 365 * 86400000)`
    - **Validates: Requirements 4.7**

- [x] 4. Implement filter logic (`csrAnalyticsAggregations.js` — filter section)
  - Create `src/features/csr-analytics/utils/csrAnalyticsAggregations.js`
  - Export `applyFilters(tickets, manualFilters, drilldownFilters)` — applies all ManualFilter dimensions (legacy exclusion, ticketScope, dateRange, project, bank, assignee, status, issueType) and all DrilldownFilter dimensions as a logical AND; returns a new array
  - Export `DEFAULT_MANUAL_FILTERS` re-export (or import from constants)
  - _Requirements: 5.1–5.7, 6.7_

  - [ ]* 4.1 Write property test for legacy exclusion (Property 5)
    - **Property 5: Legacy exclusion filter**
    - Generate `fc.array(normalizedTicketArbitrary)`; apply `applyFilters` with `includeLegacy = false`; assert no ticket in output has `isLegacy = true`
    - **Validates: Requirements 5.2**

  - [ ]* 4.2 Write property test for ticket scope filter (Property 6)
    - **Property 6: Ticket scope filter correctness**
    - Generate `fc.array(normalizedTicketArbitrary)`; apply with `ticketScope = 'open'` and assert all output tickets have `isOpen = true`; apply with `ticketScope = 'resolved'` and assert all have `isResolved = true`
    - **Validates: Requirements 5.3, 5.4**

  - [ ]* 4.3 Write property test for date range filter (Property 7)
    - **Property 7: Date range filter correctness**
    - Generate `fc.tuple(isoDateArbitrary, fc.array(normalizedTicketArbitrary))`; apply with a `start` date and assert all output tickets have `createdAt >= start`; repeat for `end` date
    - **Validates: Requirements 5.5, 5.6**

  - [ ]* 4.4 Write property test for combined filter intersection (Property 9)
    - **Property 9: Combined filter intersection**
    - Generate `fc.tuple(fc.array(normalizedTicketArbitrary), manualFiltersArbitrary, drilldownFiltersArbitrary)`; assert output is a subset of both the manual-only result and the drilldown-only result
    - **Validates: Requirements 6.7**

- [x] 5. Implement KPI aggregations (`csrAnalyticsAggregations.js` — KPI section)
  - Add `computeKpis(tickets)` to `csrAnalyticsAggregations.js` — returns a `KpiSet` object with all nine metrics using the exact definitions from Requirements 17.1–17.9
  - Add `classifyDeltaTone(delta, lowerIsBetter)` — returns `'good'` | `'danger'` | `'neutral'`
  - Use `currentWeekBounds()`, `previousWeekBounds()`, `fourWeekWindowBounds()`, `previousFourWeekWindowBounds()` from `csrAnalyticsDates.js` for all window calculations
  - Handle zero-denominator cases: return `null` for `slaBreachRate4w` and `unassignedOpenPct` when denominator is 0
  - _Requirements: 8.2–8.16, 17.1–17.9_

  - [ ]* 5.1 Write property test for KPI count aggregations (Property 13)
    - **Property 13: KPI aggregations are correct for all ticket sets**
    - Generate `fc.array(normalizedTicketArbitrary)`; assert `createdThisWeek`, `resolvedThisWeek`, `netBacklogChange`, `openBacklog`, `openOver90Days` match their exact definitions
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.9, 17.1–17.4, 17.8**

  - [ ]* 5.2 Write property test for resolution statistics (Property 14)
    - **Property 14: Resolution statistics are correct for all ticket sets**
    - Generate `fc.array(normalizedTicketArbitrary)` with at least one resolved ticket in the 4-week window; assert `avgResolutionDays4w` equals arithmetic mean and `medianResolutionDays4w` equals statistical median
    - **Validates: Requirements 8.6, 8.7, 17.5, 17.6**

  - [ ]* 5.3 Write property test for SLA breach rate (Property 15)
    - **Property 15: SLA breach rate is correct for all ticket sets**
    - Generate `fc.array(normalizedTicketArbitrary)`; assert `slaBreachRate4w` equals the ratio formula or `null` when denominator is zero
    - **Validates: Requirements 8.8, 17.7**

  - [ ]* 5.4 Write property test for delta tone classification (Property 16)
    - **Property 16: KPI delta tone classification**
    - Generate `fc.tuple(fc.integer(), fc.boolean())`; assert `classifyDeltaTone` returns `'good'`/`'danger'`/`'neutral'` per the four-case truth table
    - **Validates: Requirements 8.12–8.15**

- [x] 6. Implement chart series aggregations (`csrAnalyticsAggregations.js` — chart section)
  - Add `buildCreatedResolvedSeries(tickets)` — returns `{ week, created, resolved }[]` sorted ascending by week
  - Add `buildResolutionTrendSeries(tickets)` — returns `{ week, median, avg, sampleSize }[]` sorted ascending; `sampleSize` is the count of resolved tickets in that week
  - Add `buildSlaHealthSeries(tickets)` — returns `{ week, onTrack, atRisk, breaching }[]` sorted ascending, bucketed by `isoWeekOf(createdAt)`
  - Add `buildBacklogTrendSeries(tickets)` — returns `{ week, cumulative, netChange }[]` sorted ascending; `netChange` is created minus resolved for that week
  - Add `buildAgingBuckets(tickets)` — returns `{ bucket, count }[]` for the five age buckets, open tickets only
  - Add `buildAssigneeWorkload(tickets, mode)` — `mode` is `'open'|'created'|'resolved'`; returns `{ assignee, count }[]` with top 8 + `'Other'` entry
  - _Requirements: 9.1–9.5, 10.1–10.5, 11.1–11.4, 12.1–12.5, 13.1–13.4, 14.1–14.5_

  - [ ]* 6.1 Write property test for cumulative backlog (Property 17)
    - **Property 17: Cumulative backlog computation**
    - Generate `fc.array(normalizedTicketArbitrary)`; assert `cumulative[W]` equals the running sum of `(created[w] - resolved[w])` for all weeks w ≤ W
    - **Validates: Requirements 11.2**

  - [ ]* 6.2 Write property test for age bucket assignment (Property 18)
    - **Property 18: Age bucket assignment is exhaustive and mutually exclusive**
    - Generate `fc.array(normalizedTicketArbitrary)`; assert every open ticket appears in exactly one bucket and the sum of all bucket counts equals the open ticket count
    - **Validates: Requirements 12.2, 12.4**

  - [ ]* 6.3 Write property test for assignee top-8 aggregation (Property 19)
    - **Property 19: Assignee workload top-8 aggregation**
    - Generate `fc.array(normalizedTicketArbitrary)` with > 8 distinct assignees; assert at most 9 entries returned, first 8 are highest-count assignees, 9th is `'Other'` with correct summed count
    - **Validates: Requirements 14.4**

- [x] 7. Implement `useCsrAnalyticsFilters` hook
  - Create `src/features/csr-analytics/hooks/useCsrAnalyticsFilters.js`
  - Initialise state from `DEFAULT_MANUAL_FILTERS`
  - Export `filters`, `setFilter(key, value)`, `resetFilters()` — `resetFilters` restores all fields to defaults
  - _Requirements: 5.1, 5.7_

  - [ ]* 7.1 Write property test for filter reset round-trip (Property 8)
    - **Property 8: Filter reset round-trip**
    - Generate `fc.record(manualFiltersArbitrary)` with arbitrary non-default values; call `resetFilters()`; assert result deep-equals `DEFAULT_MANUAL_FILTERS`
    - **Validates: Requirements 5.7**

- [x] 8. Implement `useCsrAnalyticsDrilldown` hook
  - Create `src/features/csr-analytics/hooks/useCsrAnalyticsDrilldown.js`
  - State: `drilldowns` array of `DrilldownFilter` objects
  - Export `drilldowns`, `setDrilldown(filter)` (upserts by `dimension`), `clearDrilldown()`, `clearDrilldownDimension(key)`
  - _Requirements: 6.1–6.6_

  - [ ]* 8.1 Write property test for drilldown clear (Property 10)
    - **Property 10: Drilldown clear removes all dimensions**
    - Generate `fc.array(drilldownFilterArbitrary)`; call `clearDrilldown()`; assert result is an empty array
    - **Validates: Requirements 6.5**

  - [ ]* 8.2 Write property test for drilldown dimension removal (Property 11)
    - **Property 11: Drilldown dimension removal preserves others**
    - Generate `fc.array(drilldownFilterArbitrary, { minLength: 2 })`; call `clearDrilldownDimension(key)` for one dimension; assert all other dimensions are unchanged
    - **Validates: Requirements 6.6**

- [x] 9. Implement `useCsrAnalyticsData` hook
  - Create `src/features/csr-analytics/hooks/useCsrAnalyticsData.js`
  - Fetch raw tickets via `fetchCSRIssues()` + `transformCSRIssue` on mount; store in `rawTickets` state
  - Normalise with `useMemo` keyed on `rawTickets` reference: `normalizedTickets = useMemo(() => rawTickets.map(normalizeTicket), [rawTickets])`
  - Filter with `useMemo` keyed on `normalizedTickets`, `filters`, `drilldowns`: `filteredTickets = useMemo(() => applyFilters(normalizedTickets, filters, drilldowns), [normalizedTickets, filters, drilldowns])`
  - Compute all chart series and KPI sets with independent `useMemo` calls keyed on `filteredTickets`
  - Expose: `normalizedTickets`, `filteredTickets`, `loading`, `error`, `refresh()`, `kpis`, `prevKpis`, `createdResolvedSeries`, `resolutionTrendSeries`, `slaHealthSeries`, `backlogTrendSeries`, `agingBuckets`, `assigneeWorkload`
  - _Requirements: 4.1, 4.8, 16.1–16.5_

- [x] 10. Checkpoint — verify data pipeline
  - Ensure all tests in `src/__tests__/csrAnalyticsProperties.test.js` pass (run `vitest --run src/__tests__/csrAnalyticsProperties.test.js`)
  - Ensure all utility modules and hooks export the expected symbols without import errors

- [x] 11. Implement `CsrAnalyticsHeader` component
  - Create `src/features/csr-analytics/components/CsrAnalyticsHeader.jsx`
  - Props: `title`, `loading`, `onRefresh`
  - Render page title (`text-slate-100`), a Refresh button with `<RefreshCw>` icon (spins when `loading`), and a Print button that calls `window.print()`
  - Dark theme: `bg-slate-800 border-b border-slate-700`
  - _Requirements: 3.1–3.4_

- [x] 12. Implement `CsrAnalyticsFilters` component
  - Create `src/features/csr-analytics/components/CsrAnalyticsFilters.jsx`
  - Props: `filters`, `onFiltersChange`, `tickets` (full normalised array for deriving options)
  - Render `<select>` dropdowns for `project`, `bank`, `assignee`, `status`, `issueType` — options derived from `tickets` (not filtered), each with an `'all'` option
  - Render date inputs for `dateRange.start` and `dateRange.end`
  - Render a checkbox for `includeLegacy`
  - Render a three-button segmented control for `ticketScope` (`'all'` / `'open'` / `'resolved'`)
  - Dark theme: `bg-slate-800 border-slate-700 text-slate-100`
  - _Requirements: 5.1, 5.8_

- [x] 13. Implement `CsrAnalyticsActiveChips` component
  - Create `src/features/csr-analytics/components/CsrAnalyticsActiveChips.jsx`
  - Props: `filters`, `drilldowns`, `onResetDimension`, `onClearDrilldownDimension`, `onClearAll`
  - Render one chip per active ManualFilter dimension (value differs from default) and one per DrilldownFilter
  - Each chip has a dismiss `×` button; clicking it calls `onResetDimension(key)` or `onClearDrilldownDimension(key)`
  - Render a "Clear all" button when ≥ 2 chips are visible
  - Render nothing (no wrapper element) when no chips are active
  - _Requirements: 7.1–7.6_

  - [ ]* 13.1 Write property test for active chip count (Property 12)
    - **Property 12: Active chip count matches non-default filter dimensions**
    - Generate `fc.tuple(manualFiltersArbitrary, fc.array(drilldownFilterArbitrary))`; assert chip count equals (count of ManualFilter fields differing from default) + (drilldown array length)
    - **Validates: Requirements 7.1, 7.2**

- [x] 14. Implement `CsrKpiCard` and `CsrKpiRow` components
  - Create `src/features/csr-analytics/components/CsrKpiCard.jsx`
    - Props: `label`, `value`, `delta`, `tone` (`'good'|'danger'|'neutral'`), `lowerIsBetter`
    - Render value prominently, label below, delta badge with colour: green for `'good'`, red for `'danger'`, slate for `'neutral'`
    - Render `—` when `value` is `null`
    - Dark theme: `bg-slate-800 border border-slate-700 rounded-xl`
  - Create `src/features/csr-analytics/components/CsrKpiRow.jsx`
    - Props: `kpis`, `prevKpis`
    - Render exactly nine `CsrKpiCard` instances in a responsive horizontal row (`grid grid-cols-3 lg:grid-cols-9`)
    - Compute delta for each KPI as `current - previous`; pass `lowerIsBetter` correctly per metric
    - Pass `tone` from `classifyDeltaTone(delta, lowerIsBetter)`
    - _Requirements: 8.1–8.16_

- [x] 15. Implement `CsrCreatedResolvedChart` component
  - Create `src/features/csr-analytics/components/CsrCreatedResolvedChart.jsx`
  - Props: `data` (`{ week, created, resolved }[]`), `onDrilldown`
  - Render a Recharts `BarChart` with two `Bar` elements per week (created: `#3b82f6`, resolved: `#10b981`)
  - Track `activeDrilldown` in local state; highlight the active bar and reduce opacity on the other
  - On bar click: call `onDrilldown({ dimension: 'week-created' | 'week-resolved', value: week, label: ... })`
  - Dark theme chart background, `text-slate-400` axis ticks
  - _Requirements: 9.1–9.5_

- [x] 16. Implement `CsrResolutionTrendChart` component
  - Create `src/features/csr-analytics/components/CsrResolutionTrendChart.jsx`
  - Props: `data` (`{ week, median, avg, sampleSize }[]`), `onDrilldown`
  - Render a Recharts `LineChart` with two `Line` elements (median: `#8b5cf6`, avg: `#f59e0b`)
  - For data points where `sampleSize < 5`: render a hollow dot with dashed stroke; add a tooltip note "Low sample (n=X)"
  - _Requirements: 13.1–13.4_

- [x] 17. Implement `CsrSlaHealthChart` component
  - Create `src/features/csr-analytics/components/CsrSlaHealthChart.jsx`
  - Props: `data` (`{ week, onTrack, atRisk, breaching }[]`), `onDrilldown`
  - Render a Recharts `BarChart` with three stacked `Bar` elements (on-track: `#10b981`, at-risk: `#f59e0b`, breaching: `#ef4444`)
  - On segment click: call `onDrilldown({ dimension: 'week-sla', value: { week, slaState }, label: ... })`
  - _Requirements: 10.1–10.5_

- [x] 18. Checkpoint — verify first three charts render correctly
  - Ensure all tests pass; confirm chart components accept props without errors

- [x] 19. Implement `CsrBacklogTrendChart` component
  - Create `src/features/csr-analytics/components/CsrBacklogTrendChart.jsx`
  - Props: `data` (`{ week, cumulative, netChange }[]`)
  - Render a Recharts `AreaChart` (fill: `#6366f1` at 30% opacity, stroke: `#6366f1`)
  - For weeks where `netChange > 20`: render a `ReferenceLine` with a label showing the net change value as a spike annotation
  - _Requirements: 11.1–11.4_

- [x] 20. Implement `CsrBacklogAgingChart` component
  - Create `src/features/csr-analytics/components/CsrBacklogAgingChart.jsx`
  - Props: `data` (`{ bucket, count }[]`), `onDrilldown`
  - Render a Recharts `BarChart` with `layout="vertical"`, one `Bar` per age bucket
  - Colour gradient from green (0–7d) to red (90+d) using `AGE_BUCKET_COLORS` from constants
  - On bar click: call `onDrilldown({ dimension: 'age-bucket', value: bucket, label: bucket })`
  - _Requirements: 12.1–12.5_

- [x] 21. Implement `CsrAssigneeWorkloadChart` component
  - Create `src/features/csr-analytics/components/CsrAssigneeWorkloadChart.jsx`
  - Props: `data` (`{ assignee, count }[]`), `mode`, `onModeChange`
  - Render a Recharts `BarChart` with `layout="vertical"`, one `Bar` per assignee
  - Render a three-button mode toggle above the chart: "Open" / "Created" / "Resolved"
  - Show top 8 assignees + "Other" bar (aggregation done in `buildAssigneeWorkload`)
  - _Requirements: 14.1–14.5_

- [x] 22. Implement `CsrAnalyticsTicketGrid` component
  - Create `src/features/csr-analytics/components/CsrAnalyticsTicketGrid.jsx`
  - Props: `tickets` (`NormalizedCsrTicket[]`), `maxRows` (default 500)
  - Render a table with columns: Key, Summary, Assignee, Bank, Status, Age (days), SLA State, Last Updated
  - Sort state: `{ col, dir }` in local `useState`; clicking a column header toggles sort direction
  - Cap display at 500 rows; show a notice "Showing 500 of X tickets" when `tickets.length > 500`
  - Render an empty-state message when `tickets.length === 0`
  - "Export CSV" button: build CSV string with columns Key, Summary, Assignee, Bank, Status, Age (days), SLA State, Last Updated, Created Date, Resolution Days; use `Blob + URL.createObjectURL`; filename `CSR_analytics_export_YYYY-MM-DD.csv`
  - Dark theme table: `bg-slate-800 border-slate-700 text-slate-100`, alternating row shading with `bg-slate-900`
  - _Requirements: 15.1–15.6_

  - [ ]* 22.1 Write property test for ticket grid sort correctness (Property 20)
    - **Property 20: Ticket grid sort correctness**
    - Generate `fc.tuple(fc.array(normalizedTicketArbitrary), fc.constantFrom(...SORTABLE_COLUMNS), fc.constantFrom('asc', 'desc'))`; assert every adjacent pair of rows satisfies the sort comparator
    - **Validates: Requirements 15.2**

- [x] 23. Implement `CsrAnalyticsPage` top-level component
  - Create `src/features/csr-analytics/CsrAnalyticsPage.jsx`
  - Instantiate `useCsrAnalyticsFilters`, `useCsrAnalyticsDrilldown`, `useCsrAnalyticsData`
  - Render loading spinner while `loading` is true (dark theme: `text-slate-400`, `<Loader2 className="animate-spin">`)
  - Render error banner on failure: `bg-red-900/30 border-red-700 text-red-400`
  - On success, render the full layout in order: `CsrAnalyticsHeader`, `CsrAnalyticsFilters`, `CsrAnalyticsActiveChips`, `CsrKpiRow`, chart grid (2-column on lg), `CsrAnalyticsTicketGrid`
  - Pass `onDrilldown` callbacks from `useCsrAnalyticsDrilldown.setDrilldown` to each chart component
  - Pass `assigneeWorkloadMode` local state and setter to `CsrAssigneeWorkloadChart`
  - _Requirements: 1.1, 1.4, 3.1–3.4_

- [x] 24. Wire `CsrAnalyticsPage` into `SprintDashboard.jsx`
  - In `src/SprintDashboard.jsx`, add `import CsrAnalyticsPage from './features/csr-analytics/CsrAnalyticsPage.jsx'`
  - Replace the existing `CSRAnalyticsTab` render block (where `activeTab === 'csr-analytics'` or equivalent) with `<CsrAnalyticsPage />`
  - Remove the `import CSRAnalyticsTab` statement
  - Do NOT modify any other tab's render block or any shared component
  - _Requirements: 1.2, 1.3, 2.1_

- [x] 25. Final checkpoint — full integration
  - Ensure all tests pass: `vitest --run src/__tests__/csrAnalyticsProperties.test.js`
  - Verify no TypeScript, no Redux, no new library imports appear in any new file
  - Verify `src/components/CSRAnalyticsTab.jsx` is no longer imported anywhere in `SprintDashboard.jsx`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- All files are `.jsx` (components) or `.js` (utilities/hooks) with JSDoc — no TypeScript
- fast-check is already installed at `^4.6.0`; all property tests go in `src/__tests__/csrAnalyticsProperties.test.js`
- `normalizeTicket` maps from `transformCSRIssue` output — do not re-call `transformCSRIssue` inside the normaliser
- The `getISOWeek` function is moved (not copied) from `CSRAnalyticsTab.jsx` to `csrAnalyticsDates.js` as `isoWeekOf`
- CSV export uses `Blob + URL.createObjectURL`; PDF uses `window.print()` — no new libraries
- Dark theme tokens: `bg-slate-800`, `bg-slate-900`, `border-slate-700`, `text-slate-100`, `text-slate-400`
