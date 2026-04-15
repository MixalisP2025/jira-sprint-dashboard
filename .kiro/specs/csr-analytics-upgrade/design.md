# Design Document — CSR Analytics Upgrade

## Overview

This document describes the technical design for replacing `src/components/CSRAnalyticsTab.jsx` with a fully-featured operational analytics layer contained in `src/features/csr-analytics/`. The upgrade adds a data normalisation pipeline, a multi-dimensional filter system with drill-down, nine KPI cards with period-over-period deltas, six interactive Recharts charts, an active-filter chip bar, and a sortable/exportable ticket grid — all within the existing React + Vite + Recharts + Tailwind CSS dark-theme stack.

No other tab is modified. The existing `csrService.js` is consumed as-is; no new API endpoints are introduced.

### Key Design Decisions

1. **Single fetch, pass down**: `CsrAnalyticsPage` fetches raw tickets once via `fetchCSRIssues` + `transformCSRIssue`, normalises them into `NormalizedCsrTicket` objects, and passes the stable array down as props. Child components never fetch data.
2. **Pure aggregation layer**: All aggregation functions live in `csrAnalyticsAggregations.js` as pure functions. Chart components receive pre-computed series as props and contain no aggregation logic.
3. **Three-hook state model**: `useCsrAnalyticsFilters` owns manual filter state; `useCsrAnalyticsDrilldown` owns transient drill-down state; `useCsrAnalyticsData` owns normalisation + filtering + aggregation, consuming the other two hooks' outputs.
4. **`useMemo` everywhere**: Every aggregation is independently memoised on the `filteredTickets` array reference, so chart hover events never trigger recomputation.
5. **Ticket grid reuses CSRTicketsTab patterns**: Same column structure, same `Blob + URL.createObjectURL` CSV export, same sort state pattern — no new table library.
6. **`window.print()` for PDF**: No third-party PDF library; the header exposes a Print button that calls `window.print()`.

---

## Architecture

### Component Tree

```
CsrAnalyticsPage                          (fetches, normalises, orchestrates)
├── CsrAnalyticsHeader                    (title, refresh button, print button)
├── CsrAnalyticsFilters                   (manual filter controls)
├── CsrAnalyticsActiveChips               (active filter chip bar)
├── CsrKpiRow                             (nine KPI cards)
│   └── CsrKpiCard × 9
├── CsrCreatedResolvedChart               (grouped bar — created vs resolved)
├── CsrResolutionTrendChart               (line — median + avg resolution days)
├── CsrSlaHealthChart                     (stacked bar — on-track/at-risk/breaching)
├── CsrBacklogTrendChart                  (area — cumulative open backlog)
├── CsrBacklogAgingChart                  (horizontal bar — age buckets)
├── CsrAssigneeWorkloadChart              (horizontal bar — per-assignee counts)
└── CsrAnalyticsTicketGrid                (sortable table + CSV export)
```

### Data Flow

```
fetchCSRIssues()
  └─► transformCSRIssue[]          (existing csrService.js)
        └─► normalizeTicket[]      (csrAnalyticsTypes.js)  ← memoised on raw ref
              └─► applyFilters()   (csrAnalyticsAggregations.js) ← memoised on filters
                    └─► filteredTickets
                          ├─► KPI aggregations  (useMemo per KPI)
                          ├─► chart series      (useMemo per chart)
                          └─► ticket grid       (sort + slice in component)
```

### Hook Dependency Graph

```
useCsrAnalyticsFilters  ──┐
                           ├──► useCsrAnalyticsData ──► CsrAnalyticsPage
useCsrAnalyticsDrilldown ─┘
```

---

## Components and Interfaces

### CsrAnalyticsPage

Top-level container. Owns the fetch lifecycle and passes data down.

```jsx
// Props: none (tab-level component)
// State: rawTickets[], loading, error (via useState)
// Consumes: useCsrAnalyticsFilters, useCsrAnalyticsDrilldown, useCsrAnalyticsData
```

Renders a loading spinner while fetching, an error banner on failure, and the full analytics layout on success. Passes `onDrilldown` callbacks to chart components.

### CsrAnalyticsHeader

```jsx
/**
 * @param {{ title: string, loading: boolean, onRefresh: () => void }} props
 */
```

Renders the page title, a Refresh button (with spinner when loading), and a Print button (`window.print()`).

### CsrAnalyticsFilters

```jsx
/**
 * @param {{
 *   filters: ManualFilters,
 *   onFiltersChange: (filters: ManualFilters) => void,
 *   tickets: NormalizedCsrTicket[]   // for deriving dropdown options
 * }} props
 */
```

Renders `<select>` dropdowns for project, bank, assignee, status, issueType; date inputs for dateRange; a checkbox for includeLegacy; and a segmented control for ticketScope. Dropdown options are derived from the full `normalizedTickets` array (not filtered) so options never disappear while filtering.

### CsrAnalyticsActiveChips

```jsx
/**
 * @param {{
 *   filters: ManualFilters,
 *   drilldowns: DrilldownFilter[],
 *   onResetDimension: (key: string) => void,
 *   onClearDrilldownDimension: (key: string) => void,
 *   onClearAll: () => void
 * }} props
 */
```

Renders one chip per active filter dimension. A chip is active when its value differs from the default. Renders a "Clear all" button when ≥ 2 chips are visible. Renders nothing when no filters are active.

### CsrKpiRow / CsrKpiCard

```jsx
/**
 * @param {{ kpis: KpiSet, prevKpis: KpiSet }} props  // CsrKpiRow
 */

/**
 * @param {{
 *   label: string,
 *   value: string | number,
 *   delta: number | null,
 *   tone: 'good' | 'danger' | 'neutral',
 *   lowerIsBetter: boolean
 * }} props  // CsrKpiCard
 */
```

`CsrKpiRow` receives two `KpiSet` objects (current and previous period) from `useCsrAnalyticsData` and renders nine `CsrKpiCard` instances. Each card shows value, label, and a delta badge coloured by tone.

### Chart Components

All six chart components share the same prop contract pattern:

```jsx
/**
 * @param {{
 *   data: object[],          // pre-computed series from useCsrAnalyticsData
 *   onDrilldown?: (filter: DrilldownFilter) => void
 * }} props
 */
```

Charts never aggregate data internally. They receive ready-to-render series arrays and invoke `onDrilldown` on click events.

**CsrCreatedResolvedChart** — `BarChart` with two `Bar` elements per week (created: `#3b82f6`, resolved: `#10b981`). Clicked bar is highlighted with reduced opacity on the other bar.

**CsrResolutionTrendChart** — `LineChart` with two `Line` elements (median: `#8b5cf6`, avg: `#f59e0b`). Data points with fewer than 5 resolved tickets render a distinct dot (hollow, dashed stroke) and a tooltip note.

**CsrSlaHealthChart** — `BarChart` with three stacked `Bar` elements (on-track: `#10b981`, at-risk: `#f59e0b`, breaching: `#ef4444`).

**CsrBacklogTrendChart** — `AreaChart` with a single `Area` (fill: `#6366f1` at 30% opacity, stroke: `#6366f1`). Weeks where net change > +20 render a `ReferenceLine` with a label showing the net change value.

**CsrBacklogAgingChart** — `BarChart` with `layout="vertical"`, one `Bar` per age bucket. Colour gradient from green (0–7d) to red (90+d).

**CsrAssigneeWorkloadChart** — `BarChart` with `layout="vertical"`. Includes a three-button mode toggle (Open / Created / Resolved) rendered above the chart. Shows top 8 assignees + "Other".

### CsrAnalyticsTicketGrid

```jsx
/**
 * @param {{
 *   tickets: NormalizedCsrTicket[],
 *   maxRows?: number   // default 500
 * }} props
 */
```

Columns: Key, Summary, Assignee, Bank, Status, Age (days), SLA State, Last Updated. Sort state is local (`useState`). Renders a row-cap notice when `tickets.length > 500`. Renders an empty-state message when `tickets.length === 0`. Export CSV button uses `Blob + URL.createObjectURL` with filename `CSR_analytics_export_YYYY-MM-DD.csv`.

---

## Data Models

### NormalizedCsrTicket

```js
/**
 * @typedef {Object} NormalizedCsrTicket
 * @property {string}      key             - Jira issue key (e.g. "CSR-123")
 * @property {string}      summary         - Issue summary text
 * @property {string}      project         - Project name
 * @property {string}      bank            - Derived bank name from reporter email
 * @property {string}      assignee        - Assignee display name (or empty string)
 * @property {string}      status          - Raw Jira status name
 * @property {string}      issueType       - Issue type name
 * @property {string}      createdAt       - ISO date string (from raw `created`)
 * @property {string}      updatedAt       - ISO date string (from raw `updated`)
 * @property {string|null} resolvedAt      - ISO date string or null
 * @property {boolean}     isOpen          - true when status is not Completed/Closed/Done
 * @property {boolean}     isResolved      - true when resolvedAt is non-null
 * @property {number}      ageDays         - Integer days from createdAt to today
 * @property {number|null} resolutionDays  - Integer days from createdAt to resolvedAt, or null
 * @property {'on-track'|'at-risk'|'breaching'} slaState - Derived from getSLARisk
 * @property {boolean}     isLegacy        - true when createdAt > 2 years ago
 */
```

### ManualFilters

```js
/**
 * @typedef {Object} ManualFilters
 * @property {{ start: string, end: string }} dateRange  - ISO date strings, empty = no bound
 * @property {string} project      - projectKey or 'all'
 * @property {string} bank         - bank name or 'all'
 * @property {string} assignee     - assignee name or 'all'
 * @property {string} status       - status name or 'all'
 * @property {string} issueType    - issue type name or 'all'
 * @property {boolean} includeLegacy  - default false
 * @property {'all'|'open'|'resolved'} ticketScope  - default 'all'
 */
```

### DrilldownFilter

```js
/**
 * @typedef {Object} DrilldownFilter
 * @property {string} dimension  - e.g. 'week-created', 'week-sla', 'age-bucket'
 * @property {*}      value      - The clicked value (week string, SLA state, bucket label)
 * @property {string} [label]    - Human-readable chip label
 */
```

### KpiSet

```js
/**
 * @typedef {Object} KpiSet
 * @property {number}      createdThisWeek      - Count of tickets created in current ISO week
 * @property {number}      resolvedThisWeek     - Count of tickets resolved in current ISO week
 * @property {number}      netBacklogChange     - createdThisWeek - resolvedThisWeek
 * @property {number}      openBacklog          - Count of isOpen=true tickets
 * @property {number|null} avgResolutionDays4w  - Arithmetic mean of resolutionDays in 4w window
 * @property {number|null} medianResolutionDays4w - Median of resolutionDays in 4w window
 * @property {number|null} slaBreachRate4w      - Decimal [0,1] or null when denominator=0
 * @property {number}      openOver90Days       - Count of isOpen=true and ageDays >= 90
 * @property {number|null} unassignedOpenPct    - Decimal [0,1] or null when no open tickets
 */
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Normalisation preserves ticket count and shape

*For any* array of raw `CsrTicket` objects, calling `normalizeTicket` on each element SHALL produce an output array of the same length where every element contains all required `NormalizedCsrTicket` fields (`key`, `summary`, `project`, `bank`, `assignee`, `status`, `issueType`, `createdAt`, `updatedAt`, `resolvedAt`, `isOpen`, `isResolved`, `ageDays`, `resolutionDays`, `slaState`, `isLegacy`).

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**

### Property 2: isOpen derivation is correct for all status values

*For any* raw ticket, `normalizeTicket(ticket).isOpen` SHALL equal `true` if and only if the ticket's status is not `'Completed'`, `'Closed'`, and the status category is not `'Done'`.

**Validates: Requirements 4.2**

### Property 3: resolutionDays round-trip

*For any* ticket where `resolvedAt` is a non-null date string and `createdAt` is a valid date string, `normalizeTicket(ticket).resolutionDays` SHALL equal `Math.floor((new Date(resolvedAt) - new Date(createdAt)) / 86400000)`. *For any* ticket where `resolvedAt` is null, `resolutionDays` SHALL be null.

**Validates: Requirements 4.5**

### Property 4: isLegacy threshold

*For any* ticket, `normalizeTicket(ticket).isLegacy` SHALL equal `true` if and only if `new Date(createdAt) < new Date(Date.now() - 2 * 365 * 86400000)`.

**Validates: Requirements 4.7**

### Property 5: Legacy exclusion filter

*For any* array of `NormalizedCsrTicket` objects with mixed `isLegacy` values, applying `applyFilters` with `includeLegacy = false` SHALL produce an output array containing no ticket where `isLegacy` is `true`.

**Validates: Requirements 5.2**

### Property 6: Ticket scope filter correctness

*For any* array of `NormalizedCsrTicket` objects, applying `applyFilters` with `ticketScope = 'open'` SHALL produce an output array where every ticket has `isOpen = true`. Applying with `ticketScope = 'resolved'` SHALL produce an output array where every ticket has `isResolved = true`.

**Validates: Requirements 5.3, 5.4**

### Property 7: Date range filter correctness

*For any* array of `NormalizedCsrTicket` objects and any `dateRange` with a `start` date set, applying `applyFilters` SHALL produce an output array where every ticket has `createdAt >= start`. When an `end` date is set, every ticket in the output SHALL have `createdAt <= end`.

**Validates: Requirements 5.5, 5.6**

### Property 8: Filter reset round-trip

*For any* `ManualFilters` state (including arbitrary non-default values), calling `resetFilters()` SHALL produce a state equal to `DEFAULT_MANUAL_FILTERS` (all fields at their default values).

**Validates: Requirements 5.7**

### Property 9: Combined filter intersection

*For any* array of `NormalizedCsrTicket` objects and any combination of `ManualFilters` and `DrilldownFilters`, the output of `applyFilters` SHALL be a subset of both the set that passes `ManualFilters` alone and the set that passes `DrilldownFilters` alone (logical AND).

**Validates: Requirements 6.7**

### Property 10: Drilldown clear removes all dimensions

*For any* `DrilldownFilter[]` state (including multiple dimensions), calling `clearDrilldown()` SHALL produce an empty array.

**Validates: Requirements 6.5**

### Property 11: Drilldown dimension removal preserves others

*For any* `DrilldownFilter[]` state with two or more dimensions, calling `clearDrilldownDimension(key)` SHALL produce an array that contains all original dimensions except the one matching `key`, with all other dimensions unchanged.

**Validates: Requirements 6.6**

### Property 12: Active chip count matches non-default filter dimensions

*For any* `ManualFilters` state and `DrilldownFilter[]` state, the number of chips rendered by `CsrAnalyticsActiveChips` SHALL equal the count of `ManualFilters` fields whose value differs from the default plus the length of the `DrilldownFilter[]` array.

**Validates: Requirements 7.1, 7.2**

### Property 13: KPI aggregations are correct for all ticket sets

*For any* array of `NormalizedCsrTicket` objects, the `KpiSet` produced by `computeKpis(tickets)` SHALL satisfy:
- `createdThisWeek` = count of tickets where `isoWeekOf(createdAt)` equals the current ISO week
- `resolvedThisWeek` = count of tickets where `isoWeekOf(resolvedAt)` equals the current ISO week
- `netBacklogChange` = `createdThisWeek - resolvedThisWeek`
- `openBacklog` = count of tickets where `isOpen = true`
- `openOver90Days` = count of tickets where `isOpen = true` and `ageDays >= 90`

**Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.9, 17.1, 17.2, 17.3, 17.4, 17.8**

### Property 14: Resolution statistics are correct for all ticket sets

*For any* array of `NormalizedCsrTicket` objects where at least one ticket has a non-null `resolutionDays` and `resolvedAt` within the 4-Week Window, `computeKpis(tickets).avgResolutionDays4w` SHALL equal the arithmetic mean of those `resolutionDays` values, and `medianResolutionDays4w` SHALL equal the statistical median.

**Validates: Requirements 8.6, 8.7, 17.5, 17.6**

### Property 15: SLA breach rate is correct for all ticket sets

*For any* array of `NormalizedCsrTicket` objects, `computeKpis(tickets).slaBreachRate4w` SHALL equal `(count where slaState='breaching' and createdAt in 4w window) / (count where slaState is non-null and createdAt in 4w window)`, or `null` when the denominator is zero.

**Validates: Requirements 8.8, 17.7**

### Property 16: KPI delta tone classification

*For any* numeric delta value and metric type, the tone assigned by `classifyDeltaTone(delta, lowerIsBetter)` SHALL be `'good'` when `delta < 0 && lowerIsBetter`, `'danger'` when `delta > 0 && lowerIsBetter`, `'good'` when `delta > 0 && !lowerIsBetter`, `'danger'` when `delta < 0 && !lowerIsBetter`, and `'neutral'` when `delta === 0`.

**Validates: Requirements 8.12, 8.13, 8.14, 8.15**

### Property 17: Cumulative backlog computation

*For any* array of `NormalizedCsrTicket` objects, the cumulative backlog series produced by `buildBacklogTrend(tickets)` SHALL satisfy: for each week W, `cumulative[W]` = sum of `(created[w] - resolved[w])` for all weeks w ≤ W, where `created[w]` is the count of tickets with `isoWeekOf(createdAt) = w` and `resolved[w]` is the count with `isoWeekOf(resolvedAt) = w`.

**Validates: Requirements 11.2**

### Property 18: Age bucket assignment is exhaustive and mutually exclusive

*For any* open `NormalizedCsrTicket`, `buildAgingBuckets(tickets)` SHALL assign the ticket to exactly one of the five buckets (0–7, 8–30, 31–60, 61–90, 90+) based on `ageDays`, and the sum of all bucket counts SHALL equal the count of open tickets in the input.

**Validates: Requirements 12.2, 12.4**

### Property 19: Assignee workload top-8 aggregation

*For any* array of `NormalizedCsrTicket` objects with more than 8 distinct assignees, `buildAssigneeWorkload(tickets, mode)` SHALL return at most 9 entries, where the first 8 are the assignees with the highest counts and the 9th entry is `'Other'` with a count equal to the sum of all remaining assignees' counts.

**Validates: Requirements 14.4**

### Property 20: Ticket grid sort correctness

*For any* array of `NormalizedCsrTicket` objects and any sortable column key and direction, the rows rendered by `CsrAnalyticsTicketGrid` SHALL be ordered such that for every adjacent pair of rows (a, b), `compare(a[col], b[col])` is ≤ 0 for ascending and ≥ 0 for descending.

**Validates: Requirements 15.2**

### Property 21: ISO week function consistency

*For any* valid ISO date string, `isoWeekOf(dateStr)` SHALL return a string matching the pattern `YYYY-Www`, and calling `isoWeekOf` on any date within the same ISO week SHALL return the same string.

**Validates: Requirements 17.10**

---

## Error Handling

### Fetch Errors

`CsrAnalyticsPage` wraps the fetch in a try/catch. On failure, it sets an `error` string and renders an error banner (matching the existing dark-theme pattern from `CSRAnalyticsTab.jsx`: `bg-red-900/30 border-red-700 text-red-400`). A Refresh button is always visible so the user can retry.

Individual project fetches in `fetchCSRIssues` already swallow per-project errors with `console.warn` — partial data is displayed rather than a full failure.

### Empty States

- **No tickets after fetch**: Charts render empty states (no bars/lines, a "No data" label). KPI cards show `0` or `—`. Ticket grid shows an empty-state message.
- **No tickets after filtering**: Same as above. The active chip bar shows the active filters so the user understands why the view is empty.
- **Zero denominator in percentage KPIs**: `CsrKpiCard` renders `—` instead of a numeric value (per Requirement 8.16).
- **Fewer than 5 resolved tickets in a week**: `CsrResolutionTrendChart` renders a distinct dot style and tooltip note (per Requirement 13.4).

### Invalid Dates

`isoWeekOf` and all date utilities return `null` / empty string for invalid or missing date inputs. Aggregation functions skip tickets with null/invalid dates rather than throwing.

---

## Testing Strategy

### Unit Tests (example-based)

Located in `src/__tests__/csrAnalytics*.test.js`. Focus on:

- Specific normalisation examples (known input → known output)
- Filter edge cases (empty arrays, all-matching, none-matching)
- KPI card rendering with zero denominator (displays `—`)
- Active chips: 0 active (renders nothing), 1 active (no "Clear all"), 2+ active ("Clear all" appears)
- CSV export: filename format, column headers, UTF-8 encoding
- Chart drill-down callbacks: click fires with correct dimension/value

### Property-Based Tests

Located in `src/__tests__/csrAnalyticsProperties.test.js`. Uses **fast-check** (already available in the JS ecosystem; install with `npm install --save-dev fast-check`). Each test runs a minimum of 100 iterations.

The properties below map directly to the Correctness Properties section above.

**Feature: csr-analytics-upgrade, Property 1: Normalisation preserves ticket count and shape**
Generate: `fc.array(rawCsrTicketArbitrary)` → verify output length and field presence.

**Feature: csr-analytics-upgrade, Property 2: isOpen derivation**
Generate: `fc.record({ status: fc.string(), statusCat: fc.string() })` → verify `isOpen` logic.

**Feature: csr-analytics-upgrade, Property 3: resolutionDays round-trip**
Generate: `fc.record({ createdAt: isoDateArbitrary, resolvedAt: fc.option(isoDateArbitrary) })` → verify computation.

**Feature: csr-analytics-upgrade, Property 4: isLegacy threshold**
Generate: `fc.date()` → verify `isLegacy` matches 2-year cutoff.

**Feature: csr-analytics-upgrade, Property 5: Legacy exclusion filter**
Generate: `fc.array(normalizedTicketArbitrary)` → apply filter, verify no legacy tickets in output.

**Feature: csr-analytics-upgrade, Property 6: Ticket scope filter**
Generate: `fc.array(normalizedTicketArbitrary)` → apply open/resolved scope, verify all output tickets match scope.

**Feature: csr-analytics-upgrade, Property 7: Date range filter**
Generate: `fc.tuple(isoDateArbitrary, fc.array(normalizedTicketArbitrary))` → verify date bounds.

**Feature: csr-analytics-upgrade, Property 8: Filter reset round-trip**
Generate: `fc.record(manualFiltersArbitrary)` → call `resetFilters`, verify equals defaults.

**Feature: csr-analytics-upgrade, Property 9: Combined filter intersection**
Generate: `fc.tuple(fc.array(normalizedTicketArbitrary), manualFiltersArbitrary, drilldownFiltersArbitrary)` → verify AND semantics.

**Feature: csr-analytics-upgrade, Property 10: Drilldown clear**
Generate: `fc.array(drilldownFilterArbitrary)` → call `clearDrilldown`, verify empty.

**Feature: csr-analytics-upgrade, Property 11: Drilldown dimension removal**
Generate: `fc.array(drilldownFilterArbitrary, { minLength: 2 })` → remove one, verify others preserved.

**Feature: csr-analytics-upgrade, Property 12: Active chip count**
Generate: `fc.tuple(manualFiltersArbitrary, fc.array(drilldownFilterArbitrary))` → verify chip count.

**Feature: csr-analytics-upgrade, Property 13: KPI aggregations**
Generate: `fc.array(normalizedTicketArbitrary)` → verify all five count-based KPIs.

**Feature: csr-analytics-upgrade, Property 14: Resolution statistics**
Generate: `fc.array(normalizedTicketArbitrary)` with at least one resolved ticket in 4w window → verify mean and median.

**Feature: csr-analytics-upgrade, Property 15: SLA breach rate**
Generate: `fc.array(normalizedTicketArbitrary)` → verify ratio or null.

**Feature: csr-analytics-upgrade, Property 16: KPI delta tone**
Generate: `fc.tuple(fc.integer(), fc.boolean())` → verify tone classification.

**Feature: csr-analytics-upgrade, Property 17: Cumulative backlog**
Generate: `fc.array(normalizedTicketArbitrary)` → verify cumulative series.

**Feature: csr-analytics-upgrade, Property 18: Age bucket assignment**
Generate: `fc.array(normalizedTicketArbitrary)` → verify exhaustive + mutually exclusive bucketing.

**Feature: csr-analytics-upgrade, Property 19: Assignee top-8 aggregation**
Generate: `fc.array(normalizedTicketArbitrary)` with > 8 distinct assignees → verify top-8 + Other.

**Feature: csr-analytics-upgrade, Property 20: Ticket grid sort**
Generate: `fc.tuple(fc.array(normalizedTicketArbitrary), fc.constantFrom(...SORTABLE_COLUMNS), fc.constantFrom('asc', 'desc'))` → verify sort order.

**Feature: csr-analytics-upgrade, Property 21: ISO week consistency**
Generate: `fc.date()` → verify `isoWeekOf` output format and same-week consistency.

### Integration / Smoke Tests

- File existence checks for all required files in `src/features/csr-analytics/`
- `SprintDashboard` renders `CsrAnalyticsPage` (not `CSRAnalyticsTab`) when `activeTab === 'csr-analytics'`
- No imports of `CSRAnalyticsTab` remain in `SprintDashboard.jsx` after the migration
