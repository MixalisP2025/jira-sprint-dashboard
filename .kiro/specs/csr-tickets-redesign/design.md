# Design Document: CSR Tickets Redesign

## Overview

This design covers the full replacement of `CSRTicketsTab.jsx` and the creation of a new `CSRAnalyticsTab.jsx` component. The redesign enriches the existing CSR ticket view with contextually correct filters, a Bank/Client breakdown panel, expanded resolution statistics, a stale tickets panel, a stand-up report generator, and an enriched ticket table. A separate Analytics tab adds trend charts for volume, resolution time, backlog growth, and assignee workload.

All data flows from the existing `/api/jira-csr/issues` proxy through `csrService.js`. State is local to each component. No Redux or context is introduced. The Domain Map is exported from `csrService.js` as a named constant.

---

## Architecture

```mermaid
graph TD
    SD[SprintDashboard.jsx] -->|activeTab === 'csr'| CSR[CSRTicketsTab.jsx]
    SD -->|activeTab === 'csr-analytics'| ANA[CSRAnalyticsTab.jsx]
    CSR --> SVC[csrService.js]
    ANA --> SVC
    SVC -->|fetch| PROXY[/api/jira-csr/issues]
    PROXY -->|Basic Auth| JIRA[External Jira Service Desk]
    SVC -->|exports| DM[DOMAIN_MAP constant]
    SVC -->|exports| FN[fetchCSRIssues / transformCSRIssue]
```

Data flow is unidirectional: the proxy fetches raw Jira issues, `csrService.js` transforms them into a normalised shape, and the two tab components derive all display state from that array via `useMemo`.

---

## Components and Interfaces

### `csrService.js` (updated)

New exports added alongside existing ones:

```js
// Existing
export const CSR_PROJECTS = [...]
export async function fetchCSRIssues() {...}
export function transformCSRIssue(issue) {...}

// New
export const DOMAIN_MAP = {
  'piraeusbank.gr': 'Piraeus Bank',
  'eurobank.gr':    'Eurobank',
  // ... additional entries
}

export function deriveBank(reporterEmail) {...}
export function ticketAge(createdDate) {...}
export function isSLABreach(ticket) {...}
export function isStale(ticket) {...}
```

`transformCSRIssue` is updated to include `reporterEmail` in its output so Bank derivation works without extra API calls.

### `CSRTicketsTab.jsx` (full replacement)

Top-level state:

| State variable | Type | Purpose |
|---|---|---|
| `issues` | `TransformedTicket[]` | All loaded tickets |
| `loading` | `boolean` | Fetch in progress |
| `error` | `string` | Last error message |
| `lastFetch` | `Date \| null` | Timestamp of last successful fetch |
| `filters` | `FilterState` | All active filter values |
| `sortCol` | `string` | Active sort column for ticket table |
| `sortDir` | `'asc' \| 'desc'` | Sort direction |
| `standupOpen` | `boolean` | Stand-up panel visibility |
| `copyConfirm` | `boolean` | Clipboard copy confirmation flag |

`FilterState` shape:
```js
{
  project:    'all' | string,   // projectKey
  status:     'all' | string,
  bank:       'all' | string,
  assignee:   'all' | string,
  dateFrom:   string,           // ISO date or ''
  dateTo:     string,
  slaOnly:    boolean,
  staleOnly:  boolean,
}
```

All derived data (filtered tickets, KPIs, bank breakdown, resolution stats, stale list, stand-up content) is computed with `useMemo` from `issues` + `filters`.

Sub-components rendered inside `CSRTicketsTab`:
- `<FilterPanel />` — filter controls
- `<KPIRow />` — 7 KPI cards
- `<BankBreakdownPanel />` — horizontal bar chart + stats table
- `<ResolutionStatsPanel />` — resolution metrics
- `<StalePanel />` — stale ticket list
- `<StandupPanel />` — stand-up report modal/section
- `<TicketTable />` — enriched sortable ticket list

### `CSRAnalyticsTab.jsx` (new)

Receives `issues` as a prop from `SprintDashboard` (passed down after the parent fetches), or fetches independently on mount. Given the context note that all state is local, it fetches independently.

Charts (all via Recharts):
- `<WeeklyVolumeChart />` — `BarChart` of tickets created per ISO week
- `<ResolutionTrendChart />` — `LineChart` of avg resolution days per ISO week
- `<BacklogGrowthChart />` — `AreaChart` of cumulative open ticket delta per week
- `<AssigneeHeatmap />` — `BarChart` (grouped/stacked) of tickets per assignee per week

### `SprintDashboard.jsx` (minimal changes)

1. Add import for `CSRAnalyticsTab`
2. Add `'csr-analytics'` entry to the `tabConfig` map with a `BarChart3` icon and label "CSR Analytics"
3. Add `{activeTab === 'csr-analytics' && <CSRAnalyticsTab />}` render block

---

## Data Models

### `TransformedTicket` (extended from current)

```ts
interface TransformedTicket {
  key:           string;       // e.g. "CSR-123"
  summary:       string;
  status:        string;       // raw Jira status name
  statusCat:     string;       // Jira status category name
  assignee:      string;
  reporter:      string;       // display name
  reporterEmail: string;       // NEW — email address for Bank derivation
  bank:          string;       // NEW — derived via DOMAIN_MAP
  project:       string;       // project name
  projectKey:    string;
  issueType:     string;
  priority:      string;
  created:       string;       // ISO datetime
  updated:       string;       // ISO datetime
  resolved:      string | null;
  due:           string | null;
  age:           number;       // NEW — whole days since created
  isSLABreach:   boolean;      // NEW — age > 30 && not closed/completed
  isStale:       boolean;      // NEW — not updated in 7d && not closed/completed
}
```

### `FilterState`

Described above in the Components section.

### `StandupReport`

```ts
interface StandupReport {
  generatedAt:    Date;
  closedYesterday: TransformedTicket[];
  newToday:        TransformedTicket[];
  inProgressByAssignee: { assignee: string; count: number }[];
  slaBreaches:     TransformedTicket[];
}
```

### `BankStat`

```ts
interface BankStat {
  bank:       string;
  total:      number;
  open:       number;
  inProgress: number;
  completed:  number;
  avgResolution: number | null;  // calendar days, null if no resolved tickets
}
```

### `ResolutionStats`

```ts
interface ResolutionStats {
  avg:    number | null;
  median: number | null;
  min:    number | null;
  max:    number | null;
  byProject: { project: string; avg: number }[];
  slaBreachCount: number;
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*


### Property 1: Filter correctness (AND composition)

*For any* set of tickets and any combination of active filter values (project, status, bank, assignee, date range, slaOnly, staleOnly), every ticket in the filtered result must satisfy all active filter conditions simultaneously, and no ticket that satisfies all conditions must be absent from the result.

**Validates: Requirements 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9**

### Property 2: deriveBank lookup correctness

*For any* reporter email address that contains an `@` symbol and whose domain is present in `DOMAIN_MAP`, `deriveBank` must return the mapped bank name. For any email whose domain is absent from `DOMAIN_MAP`, `deriveBank` must return the raw domain string. For any string without `@` or with an empty domain segment, `deriveBank` must return `"Unknown"`.

**Validates: Requirements 2.1, 2.2, 6.1, 8.3**

### Property 3: Bank stats aggregation invariant

*For any* set of tickets grouped by bank, the sum of `open + inProgress + completed` for each bank must equal that bank's `total` ticket count.

**Validates: Requirements 2.3**

### Property 4: Derived panels use filtered tickets

*For any* set of tickets and any active filter state, the bank breakdown stats, resolution stats, and stale panel data computed from the filtered ticket set must equal computing those same statistics directly on the subset of tickets that pass the filters.

**Validates: Requirements 2.6, 3.5**

### Property 5: Resolution statistics correctness

*For any* non-empty array of resolved tickets with known resolution times, the computed `avg` must equal the arithmetic mean, `median` must equal the middle value (or average of two middle values) when sorted, `min` must equal the smallest value, and `max` must equal the largest value.

**Validates: Requirements 3.1**

### Property 6: Per-project resolution average

*For any* set of resolved tickets grouped by project, the per-project average resolution time must equal the arithmetic mean of resolution times for tickets belonging to that project.

**Validates: Requirements 3.2**

### Property 7: SLA breach count

*For any* set of tickets, the SLA breach count must equal the number of tickets where `isSLABreach` is `true` (age > 30 days and status is not Completed or Closed).

**Validates: Requirements 3.3**

### Property 8: Stale panel completeness

*For any* set of filtered tickets, the stale panel must contain exactly the tickets where `isStale` is `true`, and each entry must include the fields: key, summary, assignee, bank, age, and last updated date.

**Validates: Requirements 4.1, 4.4**

### Property 9: Stale sort order

*For any* list of stale tickets, after sorting by age descending, for every adjacent pair `(a, b)` in the result, `a.age >= b.age`.

**Validates: Requirements 4.2**

### Property 10: Stand-up report content

*For any* set of tickets and a given reference date `today`, the generated `StandupReport` must contain: all tickets whose `resolved` date falls on `today - 1 day` in `closedYesterday`, all tickets whose `created` date falls on `today` in `newToday`, the correct per-assignee in-progress counts in `inProgressByAssignee`, and all tickets where `isSLABreach` is `true` in `slaBreaches`.

**Validates: Requirements 5.2**

### Property 11: Stand-up plain text serialisation

*For any* `StandupReport`, the plain-text string produced for clipboard export must contain all four sections: closed yesterday, new today, in-progress by assignee, and SLA breaches, with each ticket key appearing in the appropriate section.

**Validates: Requirements 5.5**

### Property 12: Ticket age computation

*For any* ticket with a `created` ISO datetime and a reference `now` datetime, `ticketAge(created, now)` must equal `Math.floor((now - new Date(created)) / 86400000)`.

**Validates: Requirements 6.2**

### Property 13: Age sort correctness

*For any* list of tickets sorted by age ascending, for every adjacent pair `(a, b)`, `a.age <= b.age`. For descending, `a.age >= b.age`.

**Validates: Requirements 6.5**

### Property 14: Weekly volume aggregation

*For any* set of tickets, the weekly volume data must assign each ticket to exactly one ISO week bucket based on its `created` date, and the count for each bucket must equal the number of tickets created in that week.

**Validates: Requirements 7.2**

### Property 15: Weekly resolution trend

*For any* set of resolved tickets, the weekly resolution trend data must assign each ticket to the ISO week of its `resolved` date, and the average resolution time for each bucket must equal the arithmetic mean of resolution times for tickets in that week.

**Validates: Requirements 7.3**

### Property 16: Backlog growth computation

*For any* set of tickets and a weekly time series, the net backlog delta for each week must equal the count of tickets created in that week minus the count of tickets resolved in that week.

**Validates: Requirements 7.4**

### Property 17: Assignee workload aggregation

*For any* set of tickets, the assignee workload data must assign each ticket to the ISO week of its `created` date and the ticket's assignee, and the count for each (assignee, week) pair must equal the number of tickets with that assignee created in that week.

**Validates: Requirements 7.5**

### Property 18: transformCSRIssue extracts reporterEmail

*For any* raw Jira issue object, `transformCSRIssue` must populate `reporterEmail` with `fields.reporter.emailAddress` when present, and with an empty string when absent, without requiring additional API calls.

**Validates: Requirements 9.4**

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| CSR API returns non-2xx | Set `error` state with human-readable message; retain existing `issues` array |
| Fetch throws (network error) | Same as above |
| Reporter email missing `@` | `deriveBank` returns `"Unknown"` |
| Reporter email domain not in `DOMAIN_MAP` | `deriveBank` returns raw domain string |
| No resolved tickets | Resolution stats show `null` / `"—"` for all metrics |
| No stale tickets | Stale panel shows empty-state message |
| `window.print` unavailable | Catch and display error message in Stand-up panel |
| Clipboard API unavailable | Catch and display error message; do not show copy confirmation |

---

## Testing Strategy

### Dual Testing Approach

Both unit tests and property-based tests are required. Unit tests cover specific examples, integration points, and edge cases. Property-based tests verify universal correctness across randomised inputs.

### Unit Tests

Focus areas:
- `deriveBank` with known domain entries, unknown domains, malformed emails (no `@`, empty domain)
- `ticketAge` with specific date pairs including same-day and multi-year gaps
- `isSLABreach` and `isStale` with boundary values (exactly 30 days, exactly 7 days)
- `transformCSRIssue` with a fixture Jira issue including and excluding `reporter.emailAddress`
- `generateStandupReport` with a fixed set of tickets and a fixed reference date
- `serializeStandupToText` verifying all four sections appear in output
- `DOMAIN_MAP` contains at minimum `piraeusbank.gr` and `eurobank.gr` entries
- Empty-state rendering of `StalePanel` when stale list is empty

### Property-Based Tests

Library: **fast-check** (already available in the JS ecosystem, no new dependency needed beyond `npm install --save-dev fast-check`).

Each property test runs a minimum of **100 iterations**.

Each test is tagged with a comment in the format:
`// Feature: csr-tickets-redesign, Property N: <property_text>`

| Property | Test description |
|---|---|
| P1 | Generate random ticket arrays and random filter states; assert filtered result satisfies all active conditions |
| P2 | Generate random email strings; assert `deriveBank` returns mapped name, raw domain, or "Unknown" per the rules |
| P3 | Generate random ticket arrays; group by bank; assert `open + inProgress + completed === total` for every bank |
| P4 | Generate random tickets and filter states; assert panel stats from filtered set equal stats computed on the filtered subset directly |
| P5 | Generate random arrays of positive integers as resolution times; assert avg/median/min/max are correct |
| P6 | Generate random tickets with project and resolution data; assert per-project avg equals mean of that project's times |
| P7 | Generate random tickets with varying age and status; assert SLA breach count equals manual count |
| P8 | Generate random filtered ticket sets; assert stale panel contains exactly the isStale tickets with all required fields |
| P9 | Generate random stale ticket arrays; sort by age desc; assert adjacent pairs satisfy `a.age >= b.age` |
| P10 | Generate random ticket sets and reference dates; assert stand-up report sections contain correct tickets |
| P11 | Generate random `StandupReport` objects; assert serialised text contains all four section headers and all ticket keys |
| P12 | Generate random (created, now) date pairs where now >= created; assert `ticketAge` equals floor division |
| P13 | Generate random ticket arrays; sort asc/desc by age; assert adjacent pair invariant holds |
| P14 | Generate random ticket arrays with created dates; assert weekly bucket counts sum to total ticket count |
| P15 | Generate random resolved ticket arrays; assert weekly avg resolution equals mean of that week's resolution times |
| P16 | Generate random ticket arrays; assert weekly backlog delta equals created count minus resolved count per week |
| P17 | Generate random ticket arrays; assert (assignee, week) counts sum to total ticket count |
| P18 | Generate random raw Jira issue objects with and without `reporter.emailAddress`; assert `transformCSRIssue` populates `reporterEmail` correctly |
