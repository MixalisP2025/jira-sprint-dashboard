# Requirements Document

## Introduction

This feature replaces the existing CSR Analytics tab in the Sprint Analytics Dashboard with a full operational analytics layer. The current tab contains four basic charts (weekly volume, resolution trend, backlog growth, assignee heatmap). The upgrade introduces a structured data normalisation pipeline, a multi-dimensional filter system, nine KPI cards with period-over-period deltas, six interactive charts with drill-down capability, an active-filter chip bar, and a sortable/exportable ticket grid — all within the existing dark-theme React + Vite + Recharts + Tailwind CSS stack. No other tab is modified.

## Glossary

- **CsrAnalyticsPage**: Top-level container component for the upgraded CSR Analytics tab, located at `src/features/csr-analytics/CsrAnalyticsPage.jsx`.
- **CsrTicket**: Raw ticket object returned by the existing `fetchCSRIssues` / `transformCSRIssue` pipeline in `csrService.js`.
- **NormalizedCsrTicket**: Derived, immutable ticket object produced once from a `CsrTicket`. Fields: `key`, `summary`, `project`, `bank`, `assignee`, `status`, `issueType`, `createdAt`, `updatedAt`, `resolvedAt`, `isOpen`, `isResolved`, `ageDays`, `resolutionDays`, `slaState`, `isLegacy`.
- **ManualFilters**: User-controlled filter state managed by `useCsrAnalyticsFilters`. Fields: `dateRange`, `project`, `bank`, `assignee`, `status`, `issueType`, `includeLegacy`, `ticketScope`.
- **DrilldownFilters**: Transient filter state set by chart interactions, managed by `useCsrAnalyticsDrilldown`. Cleared independently of ManualFilters.
- **FilteredTickets**: The set of `NormalizedCsrTicket` objects that pass both ManualFilters and DrilldownFilters simultaneously.
- **KPI Card**: A single metric tile displaying a value, a label, a delta vs the previous equivalent period, and a tone indicator (good / warning / danger).
- **SlaState**: One of three string values: `on-track`, `at-risk`, `breaching`. Derived from `ageDays` relative to the configured SLA target for the ticket's bank and priority.
- **Legacy Ticket**: A ticket whose `createdAt` is more than two years before the current date (`isLegacy = true`).
- **Current Week**: The ISO 8601 calendar week containing today's date.
- **Previous Week**: The ISO 8601 calendar week immediately preceding the current week.
- **4-Week Window**: The 28-day period ending at the end of the current week.
- **Previous 4-Week Window**: The 28-day period immediately preceding the 4-Week Window.
- **Spike**: A week in the Open Backlog Trend chart where the net backlog change (created minus resolved) exceeds +20 tickets.
- **Active Chip**: A visual pill in the `CsrAnalyticsActiveChips` bar representing one active ManualFilter or DrilldownFilter dimension.
- **Ticket Grid**: The `CsrAnalyticsTicketGrid` component — a sortable, paginated table of FilteredTickets capped at 500 rows.
- **Dark Theme**: The existing visual style of the Sprint Analytics Dashboard: dark backgrounds (`bg-slate-800`, `bg-slate-900`), light text, card borders from `border-slate-700`.

---

## Requirements

### Requirement 1: Feature Scope Isolation

**User Story:** As a developer, I want the upgrade to be fully contained within the CSR Analytics tab, so that no other dashboard tab is affected.

#### Acceptance Criteria

1. THE `CsrAnalyticsPage` SHALL be the sole entry point for all upgraded CSR analytics functionality.
2. THE Dashboard SHALL render `CsrAnalyticsPage` only when the CSR Analytics tab is active.
3. THE Dashboard SHALL NOT modify any component, hook, utility, or style used exclusively by other tabs.
4. THE `CsrAnalyticsPage` SHALL be located at `src/features/csr-analytics/CsrAnalyticsPage.jsx`.

---

### Requirement 2: File Structure

**User Story:** As a developer, I want a well-organised feature directory, so that all CSR analytics code is discoverable and maintainable.

#### Acceptance Criteria

1. THE `CsrAnalyticsPage` SHALL import all sub-components exclusively from `src/features/csr-analytics/components/`.
2. THE `CsrAnalyticsPage` SHALL import all custom hooks exclusively from `src/features/csr-analytics/hooks/`.
3. THE `CsrAnalyticsPage` SHALL import all utility functions exclusively from `src/features/csr-analytics/utils/`.
4. THE `src/features/csr-analytics/components/` directory SHALL contain: `CsrAnalyticsHeader`, `CsrAnalyticsFilters`, `CsrKpiRow`, `CsrKpiCard`, `CsrCreatedResolvedChart`, `CsrResolutionTrendChart`, `CsrSlaHealthChart`, `CsrBacklogTrendChart`, `CsrBacklogAgingChart`, `CsrAssigneeWorkloadChart`, `CsrAnalyticsActiveChips`, `CsrAnalyticsTicketGrid`.
5. THE `src/features/csr-analytics/hooks/` directory SHALL contain: `useCsrAnalyticsFilters`, `useCsrAnalyticsData`, `useCsrAnalyticsDrilldown`.
6. THE `src/features/csr-analytics/utils/` directory SHALL contain: `csrAnalyticsTypes`, `csrAnalyticsAggregations`, `csrAnalyticsDates`, `csrAnalyticsFormatters`, `csrAnalyticsConstants`.

---

### Requirement 3: Visual Consistency

**User Story:** As a user, I want the upgraded CSR Analytics tab to look identical in style to the rest of the dashboard, so that the experience feels cohesive.

#### Acceptance Criteria

1. THE `CsrAnalyticsPage` SHALL use the existing dark theme colour tokens (`bg-slate-800`, `bg-slate-900`, `border-slate-700`, and equivalent Tailwind classes) for all backgrounds and borders.
2. THE `CsrAnalyticsPage` SHALL use Recharts components exclusively for all chart rendering.
3. THE `CsrAnalyticsPage` SHALL use Tailwind CSS utility classes exclusively for all layout and styling.
4. THE `CsrAnalyticsPage` SHALL NOT introduce any new CSS files, CSS-in-JS, or inline `style` objects beyond what is strictly required for Recharts customisation.

---

### Requirement 4: Data Normalisation

**User Story:** As a developer, I want raw CSR tickets normalised into a stable shape once, so that all downstream components consume a consistent data model.

#### Acceptance Criteria

1. WHEN `useCsrAnalyticsData` loads raw tickets, THE `useCsrAnalyticsData` hook SHALL produce one `NormalizedCsrTicket` per raw ticket by calling the normalisation function in `csrAnalyticsTypes`.
2. THE normalisation function SHALL derive `isOpen` as `true` when the ticket's status is not `Completed`, `Closed`, or in the `Done` status category.
3. THE normalisation function SHALL derive `isResolved` as `true` when `resolvedAt` is a non-null date string.
4. THE normalisation function SHALL derive `ageDays` as the integer number of calendar days between `createdAt` and the current date.
5. THE normalisation function SHALL derive `resolutionDays` as the integer number of calendar days between `createdAt` and `resolvedAt`, or `null` when `resolvedAt` is absent.
6. THE normalisation function SHALL derive `slaState` using the existing `getSLARisk` logic from `csrService.js`.
7. THE normalisation function SHALL derive `isLegacy` as `true` when `createdAt` is more than two years before the current date.
8. THE `useCsrAnalyticsData` hook SHALL NOT re-normalise tickets on re-renders unless the raw ticket array reference changes.

---

### Requirement 5: Filter System — Manual Filters

**User Story:** As a user, I want to filter the analytics by date range, project, bank, assignee, status, issue type, legacy inclusion, and ticket scope, so that I can focus on the data that matters to me.

#### Acceptance Criteria

1. THE `useCsrAnalyticsFilters` hook SHALL maintain ManualFilters state with fields: `dateRange` (start/end ISO date strings), `project` (string or `'all'`), `bank` (string or `'all'`), `assignee` (string or `'all'`), `status` (string or `'all'`), `issueType` (string or `'all'`), `includeLegacy` (boolean, default `false`), `ticketScope` (one of `'all'`, `'open'`, `'resolved'`).
2. WHEN `includeLegacy` is `false`, THE Filter System SHALL exclude all `NormalizedCsrTicket` objects where `isLegacy` is `true` from FilteredTickets.
3. WHEN `ticketScope` is `'open'`, THE Filter System SHALL include only `NormalizedCsrTicket` objects where `isOpen` is `true`.
4. WHEN `ticketScope` is `'resolved'`, THE Filter System SHALL include only `NormalizedCsrTicket` objects where `isResolved` is `true`.
5. WHEN a `dateRange` start date is set, THE Filter System SHALL exclude tickets where `createdAt` is before the start date.
6. WHEN a `dateRange` end date is set, THE Filter System SHALL exclude tickets where `createdAt` is after the end date.
7. THE `useCsrAnalyticsFilters` hook SHALL expose a `resetFilters` function that restores all ManualFilters to their default values.
8. THE `CsrAnalyticsFilters` component SHALL render a control for each ManualFilter field.

---

### Requirement 6: Filter System — Drill-down Filters

**User Story:** As a user, I want to click a chart element to drill into the underlying tickets, so that I can investigate anomalies without manually setting filters.

#### Acceptance Criteria

1. THE `useCsrAnalyticsDrilldown` hook SHALL maintain DrilldownFilters state independently of ManualFilters.
2. WHEN a user clicks a bar segment in `CsrCreatedResolvedChart`, THE `useCsrAnalyticsDrilldown` hook SHALL set a DrilldownFilter for the clicked week and ticket direction (created or resolved).
3. WHEN a user clicks a segment in `CsrSlaHealthChart`, THE `useCsrAnalyticsDrilldown` hook SHALL set a DrilldownFilter for the clicked week and SLA state.
4. WHEN a user clicks a bar in `CsrBacklogAgingChart`, THE `useCsrAnalyticsDrilldown` hook SHALL set a DrilldownFilter for the clicked age bucket.
5. THE `useCsrAnalyticsDrilldown` hook SHALL expose a `clearDrilldown` function that removes all DrilldownFilters.
6. THE `useCsrAnalyticsDrilldown` hook SHALL expose a `clearDrilldownDimension` function that removes a single DrilldownFilter by dimension key.
7. WHEN both ManualFilters and DrilldownFilters are active, THE Filter System SHALL apply both filter sets simultaneously (logical AND).

---

### Requirement 7: Active Filter Chips

**User Story:** As a user, I want to see all active filters displayed as removable chips, so that I always know what is filtering my view and can clear individual filters quickly.

#### Acceptance Criteria

1. THE `CsrAnalyticsActiveChips` component SHALL render one chip per active ManualFilter dimension (i.e., any field whose value differs from its default).
2. THE `CsrAnalyticsActiveChips` component SHALL render one chip per active DrilldownFilter dimension.
3. WHEN a user clicks the dismiss icon on a ManualFilter chip, THE `CsrAnalyticsActiveChips` component SHALL reset that ManualFilter dimension to its default value.
4. WHEN a user clicks the dismiss icon on a DrilldownFilter chip, THE `CsrAnalyticsActiveChips` component SHALL call `clearDrilldownDimension` for that dimension.
5. WHEN no filters are active, THE `CsrAnalyticsActiveChips` component SHALL render nothing (empty state, no placeholder text).
6. THE `CsrAnalyticsActiveChips` component SHALL render a "Clear all" button when two or more chips are visible.

---

### Requirement 8: KPI Cards

**User Story:** As a CSR team lead, I want to see nine key performance indicators with period-over-period deltas, so that I can assess team performance at a glance.

#### Acceptance Criteria

1. THE `CsrKpiRow` component SHALL render exactly nine `CsrKpiCard` components in a single horizontal row.
2. THE `CsrKpiCard` for "Created this week" SHALL display the count of FilteredTickets where `createdAt` falls within the Current Week.
3. THE `CsrKpiCard` for "Resolved this week" SHALL display the count of FilteredTickets where `resolvedAt` falls within the Current Week.
4. THE `CsrKpiCard` for "Net backlog change" SHALL display the value: (Created this week) minus (Resolved this week).
5. THE `CsrKpiCard` for "Open backlog" SHALL display the count of FilteredTickets where `isOpen` is `true`.
6. THE `CsrKpiCard` for "Avg resolution days (4w)" SHALL display the arithmetic mean of `resolutionDays` for FilteredTickets whose `resolvedAt` falls within the 4-Week Window, rounded to one decimal place.
7. THE `CsrKpiCard` for "Median resolution days (4w)" SHALL display the median of `resolutionDays` for FilteredTickets whose `resolvedAt` falls within the 4-Week Window, rounded to one decimal place.
8. THE `CsrKpiCard` for "SLA breach rate (4w)" SHALL display the percentage: (count of FilteredTickets with `slaState = 'breaching'` and `resolvedAt` or `createdAt` within the 4-Week Window) divided by (count of FilteredTickets with a known `slaState` within the same window), expressed as a percentage rounded to one decimal place.
9. THE `CsrKpiCard` for "90+ day open tickets" SHALL display the count of FilteredTickets where `isOpen` is `true` and `ageDays` is greater than or equal to 90.
10. THE `CsrKpiCard` for "Unassigned open %" SHALL display the percentage: (count of FilteredTickets where `isOpen` is `true` and `assignee` is null or empty) divided by (count of FilteredTickets where `isOpen` is `true`), expressed as a percentage rounded to one decimal place.
11. EACH `CsrKpiCard` SHALL display a delta value representing the difference between the current period metric and the equivalent metric computed over the Previous Week (for weekly metrics) or the Previous 4-Week Window (for 4-week metrics).
12. WHEN a delta is negative for metrics where lower is better (Created, Net backlog change, SLA breach rate, 90+ day open, Unassigned open %), THE `CsrKpiCard` SHALL apply the "good" tone (green).
13. WHEN a delta is positive for metrics where lower is better, THE `CsrKpiCard` SHALL apply the "danger" tone (red).
14. WHEN a delta is positive for metrics where higher is better (Resolved this week), THE `CsrKpiCard` SHALL apply the "good" tone (green).
15. WHEN a delta is zero, THE `CsrKpiCard` SHALL apply a neutral tone (no colour change).
16. WHEN the denominator for a percentage KPI is zero, THE `CsrKpiCard` SHALL display "—" instead of a numeric value.

---

### Requirement 9: Created vs Resolved Chart

**User Story:** As a CSR team lead, I want to see weekly created and resolved ticket counts side by side, so that I can identify weeks where the backlog is growing.

#### Acceptance Criteria

1. THE `CsrCreatedResolvedChart` component SHALL render a grouped bar chart using Recharts `BarChart` with two bars per week: one for created count and one for resolved count.
2. THE `CsrCreatedResolvedChart` component SHALL display one data point per ISO week, sorted ascending by week.
3. THE `CsrCreatedResolvedChart` component SHALL compute created and resolved counts from FilteredTickets only.
4. WHEN a user clicks a bar in `CsrCreatedResolvedChart`, THE `CsrCreatedResolvedChart` component SHALL invoke the drill-down callback with the clicked week and direction (created or resolved).
5. THE `CsrCreatedResolvedChart` component SHALL visually highlight the clicked bar to indicate an active drill-down.

---

### Requirement 10: SLA Health Chart

**User Story:** As a CSR team lead, I want to see SLA health broken down by week, so that I can identify periods of elevated SLA risk.

#### Acceptance Criteria

1. THE `CsrSlaHealthChart` component SHALL render a stacked bar chart using Recharts `BarChart` with three stacked segments per week: on-track, at-risk, and breaching.
2. THE `CsrSlaHealthChart` component SHALL display one data point per ISO week, sorted ascending by week.
3. THE `CsrSlaHealthChart` component SHALL assign each FilteredTicket to the week of its `createdAt` date for SLA state bucketing.
4. THE `CsrSlaHealthChart` component SHALL use green for on-track, amber for at-risk, and red for breaching segments.
5. WHEN a user clicks a segment in `CsrSlaHealthChart`, THE `CsrSlaHealthChart` component SHALL invoke the drill-down callback with the clicked week and SLA state.

---

### Requirement 11: Open Backlog Trend Chart

**User Story:** As a CSR team lead, I want to see the open backlog size over time as an area chart, so that I can identify growth trends and sudden spikes.

#### Acceptance Criteria

1. THE `CsrBacklogTrendChart` component SHALL render an area chart using Recharts `AreaChart` showing the cumulative open backlog count per ISO week.
2. THE `CsrBacklogTrendChart` component SHALL compute the cumulative backlog by accumulating (created minus resolved) per week across all FilteredTickets.
3. WHEN a week's net backlog change exceeds +20 tickets, THE `CsrBacklogTrendChart` component SHALL render a visual spike annotation on that data point (e.g., a reference line or custom dot label).
4. THE `CsrBacklogTrendChart` component SHALL display the net change value in the spike annotation.

---

### Requirement 12: Backlog Aging Chart

**User Story:** As a CSR team lead, I want to see open tickets distributed across age buckets, so that I can identify how much of the backlog is dangerously old.

#### Acceptance Criteria

1. THE `CsrBacklogAgingChart` component SHALL render a horizontal bar chart using Recharts `BarChart` with one bar per age bucket.
2. THE `CsrBacklogAgingChart` component SHALL use exactly five age buckets: 0–7 days, 8–30 days, 31–60 days, 61–90 days, 90+ days.
3. THE `CsrBacklogAgingChart` component SHALL count only FilteredTickets where `isOpen` is `true`.
4. THE `CsrBacklogAgingChart` component SHALL assign each open ticket to exactly one bucket based on its `ageDays` value.
5. WHEN a user clicks a bar in `CsrBacklogAgingChart`, THE `CsrBacklogAgingChart` component SHALL invoke the drill-down callback with the clicked age bucket.

---

### Requirement 13: Resolution Trend Chart

**User Story:** As a CSR team lead, I want to see both the median and average resolution time per week on the same chart, so that I can detect outliers skewing the average.

#### Acceptance Criteria

1. THE `CsrResolutionTrendChart` component SHALL render a line chart using Recharts `LineChart` with two lines: one for median `resolutionDays` per week and one for average `resolutionDays` per week.
2. THE `CsrResolutionTrendChart` component SHALL compute both lines from FilteredTickets where `resolvedAt` is non-null.
3. THE `CsrResolutionTrendChart` component SHALL group data points by the ISO week of `resolvedAt`.
4. WHEN a week contains fewer than 5 resolved FilteredTickets, THE `CsrResolutionTrendChart` component SHALL render a low-sample warning indicator on that data point (e.g., a distinct dot style or tooltip note).

---

### Requirement 14: Assignee Workload Chart

**User Story:** As a CSR team lead, I want to see ticket workload per assignee in three modes (open, created, resolved), so that I can identify overloaded or underutilised team members.

#### Acceptance Criteria

1. THE `CsrAssigneeWorkloadChart` component SHALL render a horizontal bar chart using Recharts `BarChart` showing ticket counts per assignee.
2. THE `CsrAssigneeWorkloadChart` component SHALL support three display modes: Open (count of `isOpen` tickets per assignee), Created (count of tickets created in the Current Week per assignee), Resolved (count of tickets resolved in the Current Week per assignee).
3. THE `CsrAssigneeWorkloadChart` component SHALL display a mode toggle control with three options: "Open", "Created", "Resolved".
4. THE `CsrAssigneeWorkloadChart` component SHALL show the top 8 assignees by count and aggregate all remaining assignees into a single "Other" bar.
5. THE `CsrAssigneeWorkloadChart` component SHALL compute counts from FilteredTickets only.

---

### Requirement 15: Ticket Grid

**User Story:** As a CSR team lead, I want to browse and export the filtered ticket list, so that I can share data with stakeholders or investigate individual tickets.

#### Acceptance Criteria

1. THE `CsrAnalyticsTicketGrid` component SHALL render a table of FilteredTickets with the following columns: Key, Summary, Assignee, Bank, Status, Age (days), SLA State, Last Updated.
2. THE `CsrAnalyticsTicketGrid` component SHALL support ascending and descending sort on every column.
3. THE `CsrAnalyticsTicketGrid` component SHALL display a maximum of 500 rows; WHEN FilteredTickets exceeds 500, THE `CsrAnalyticsTicketGrid` component SHALL display a notice indicating the row cap and the total count.
4. THE `CsrAnalyticsTicketGrid` component SHALL render an empty-state message when FilteredTickets is empty.
5. THE `CsrAnalyticsTicketGrid` component SHALL provide an "Export CSV" button that downloads all FilteredTickets (up to 500) as a UTF-8 CSV file with the columns: Key, Summary, Assignee, Bank, Status, Age (days), SLA State, Last Updated, Created Date, Resolution Days.
6. WHEN the "Export CSV" button is clicked, THE `CsrAnalyticsTicketGrid` component SHALL generate the filename in the format `CSR_analytics_export_YYYY-MM-DD.csv` using the current date.

---

### Requirement 16: Performance — Memoisation Strategy

**User Story:** As a user, I want the analytics page to remain responsive during interactions, so that hovering over charts or toggling filters does not cause visible lag.

#### Acceptance Criteria

1. THE `useCsrAnalyticsData` hook SHALL normalise raw tickets exactly once per raw data fetch, using `useMemo` or equivalent memoisation keyed on the raw ticket array reference.
2. THE `useCsrAnalyticsData` hook SHALL apply ManualFilters and DrilldownFilters exactly once per filter state change, producing a single FilteredTickets array.
3. EACH chart aggregation function in `csrAnalyticsAggregations` SHALL be memoised independently using `useMemo`, keyed on the FilteredTickets array reference.
4. THE `CsrAnalyticsPage` SHALL NOT recompute any aggregation on chart hover events.
5. THE `CsrKpiRow` component SHALL recompute KPI values only when the FilteredTickets array reference changes.

---

### Requirement 17: Metric Definitions (Exact)

**User Story:** As a developer, I want all metric computations to follow precise, unambiguous definitions, so that the numbers are reproducible and auditable.

#### Acceptance Criteria

1. THE `csrAnalyticsAggregations` module SHALL define "Created this week" as: count of NormalizedCsrTicket objects in FilteredTickets where `createdAt` falls within the ISO week containing today's date.
2. THE `csrAnalyticsAggregations` module SHALL define "Resolved this week" as: count of NormalizedCsrTicket objects in FilteredTickets where `resolvedAt` falls within the ISO week containing today's date.
3. THE `csrAnalyticsAggregations` module SHALL define "Net backlog change" as: (Created this week) minus (Resolved this week).
4. THE `csrAnalyticsAggregations` module SHALL define "Open backlog" as: count of NormalizedCsrTicket objects in FilteredTickets where `isOpen` is `true`.
5. THE `csrAnalyticsAggregations` module SHALL define "Avg resolution days (4w)" as: the arithmetic mean of `resolutionDays` for NormalizedCsrTicket objects in FilteredTickets where `resolvedAt` is non-null and falls within the 28-day period ending at 23:59:59 on the last day of the Current Week.
6. THE `csrAnalyticsAggregations` module SHALL define "Median resolution days (4w)" as: the median of `resolutionDays` for the same ticket set as Avg resolution days (4w).
7. THE `csrAnalyticsAggregations` module SHALL define "SLA breach rate (4w)" as: (count of NormalizedCsrTicket objects in FilteredTickets where `slaState` is `'breaching'` and `createdAt` falls within the 4-Week Window) divided by (count of NormalizedCsrTicket objects in FilteredTickets where `slaState` is not null and `createdAt` falls within the 4-Week Window), expressed as a decimal in [0, 1].
8. THE `csrAnalyticsAggregations` module SHALL define "90+ day open tickets" as: count of NormalizedCsrTicket objects in FilteredTickets where `isOpen` is `true` and `ageDays` is greater than or equal to 90.
9. THE `csrAnalyticsAggregations` module SHALL define "Unassigned open %" as: (count of NormalizedCsrTicket objects in FilteredTickets where `isOpen` is `true` and `assignee` is null, undefined, or an empty string) divided by (count of NormalizedCsrTicket objects in FilteredTickets where `isOpen` is `true`), expressed as a decimal in [0, 1].
10. THE `csrAnalyticsDates` module SHALL expose an `isoWeekOf(dateStr)` function that returns the ISO 8601 week string (`YYYY-Www`) for a given date string, consistent with the existing `getISOWeek` implementation in `CSRAnalyticsTab.jsx`.
11. THE `csrAnalyticsDates` module SHALL expose a `currentWeekBounds()` function that returns the Monday 00:00:00 UTC and Sunday 23:59:59 UTC of the Current Week.
12. THE `csrAnalyticsDates` module SHALL expose a `fourWeekWindowBounds()` function that returns the start and end UTC timestamps of the 4-Week Window.
