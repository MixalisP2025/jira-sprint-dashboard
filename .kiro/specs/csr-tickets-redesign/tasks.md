# Implementation Plan: CSR Tickets Redesign

## Overview

Incremental implementation starting with the service layer, then the redesigned CSRTicketsTab, then the new CSRAnalyticsTab, and finally wiring everything into SprintDashboard. Tests live in `src/__tests__/csrTickets.test.js`.

## Tasks

- [x] 1. Extend csrService.js with new exports
  - Add `DOMAIN_MAP` constant with at minimum `piraeusbank.gr` and `eurobank.gr` entries
  - Add `deriveBank(reporterEmail)` — extracts domain after `@`, looks up DOMAIN_MAP, falls back to raw domain or "Unknown"
  - Add `ticketAge(createdDate, now?)` — returns `Math.floor((now - new Date(created)) / 86400000)`
  - Add `isSLABreach(ticket)` — age > 30 && statusCat not "Done" && status not "Completed"/"Closed"
  - Add `isStale(ticket)` — not updated in > 7 days && status not "Completed"/"Closed"
  - Update `transformCSRIssue` to include `reporterEmail: f.reporter?.emailAddress || ''`, `bank`, `age`, `isSLABreach`, `isStale`
  - _Requirements: 2.1, 2.2, 6.1, 6.2, 8.1, 8.2, 8.3, 9.4_

  - [ ]* 1.1 Write unit tests for csrService.js new exports
    - Test `deriveBank` with known domain, unknown domain, no `@`, empty string
    - Test `ticketAge` with same-day, 1-day, multi-year pairs
    - Test `isSLABreach` at boundary values (exactly 30d, 31d, closed ticket)
    - Test `isStale` at boundary values (exactly 7d, 8d, closed ticket)
    - Test `transformCSRIssue` with and without `reporter.emailAddress`
    - Test `DOMAIN_MAP` contains `piraeusbank.gr` and `eurobank.gr`
    - _Requirements: 2.1, 2.2, 6.2, 8.2, 8.3, 9.4_

  - [ ]* 1.2 Write property test P2: deriveBank lookup correctness
    - `// Feature: csr-tickets-redesign, Property 2: deriveBank lookup correctness`
    - Generate random email strings; assert mapped name / raw domain / "Unknown" per rules
    - _Requirements: 2.1, 2.2, 6.1, 8.3_

  - [ ]* 1.3 Write property test P12: ticketAge computation
    - `// Feature: csr-tickets-redesign, Property 12: Ticket age computation`
    - Generate random (created, now) pairs where now >= created; assert floor division
    - _Requirements: 6.2_

  - [ ]* 1.4 Write property test P18: transformCSRIssue extracts reporterEmail
    - `// Feature: csr-tickets-redesign, Property 18: transformCSRIssue extracts reporterEmail`
    - Generate random raw Jira issue objects with/without `reporter.emailAddress`
    - _Requirements: 9.4_

- [x] 2. Install fast-check dev dependency
  - Run `npm install --save-dev fast-check` (not present in package.json)
  - _Requirements: (test infrastructure)_

- [x] 3. Replace CSRTicketsTab.jsx with full redesign
  - Define all sub-components in the same file: `FilterPanel`, `KPIRow`, `BankBreakdownPanel`, `ResolutionStatsPanel`, `StalePanel`, `StandupPanel`, `TicketTable`
  - `FilterPanel`: project dropdown, status dropdown, bank dropdown (dynamic), assignee dropdown (dynamic), date-range inputs, "SLA Breached only" toggle pill, "Stale > 7 days" toggle pill; all filters AND-composed
  - `KPIRow`: 7 KPI cards — Total, New (7d), New (30d), Open, WIP, Completed, Avg Resolution
  - `BankBreakdownPanel`: horizontal bar chart (Recharts `BarChart`) + stats table per bank; recalculates on filter change
  - `ResolutionStatsPanel`: avg/median/min/max resolution days, per-project avg, SLA breach count in red when > 0; recalculates on filter change
  - `StalePanel`: list of stale tickets sorted by age desc, key in red, shows key/summary/assignee/bank/age/last-updated; empty-state message when none
  - `StandupPanel`: "Generate Stand-up Report" button, renders report sections, "Export as PDF" via `window.print()` with print CSS class, "Copy to Clipboard" with confirmation; error messages on failure
  - `TicketTable`: sortable by Age (asc/desc), Bank column, Age column, colour-coded status badges (blue/amber/green), Age in red for SLA breaches
  - All derived data via `useMemo`; state shape matches `FilterState` from design
  - _Requirements: 1.1–1.10, 2.1–2.6, 3.1–3.5, 4.1–4.5, 5.1–5.7, 6.1–6.5, 8.1–8.3, 9.1–9.4_

  - [ ]* 3.1 Write property test P1: Filter correctness (AND composition)
    - `// Feature: csr-tickets-redesign, Property 1: Filter correctness (AND composition)`
    - Generate random ticket arrays and filter states; assert every result ticket satisfies all active conditions
    - _Requirements: 1.2–1.9_

  - [ ]* 3.2 Write property test P3: Bank stats aggregation invariant
    - `// Feature: csr-tickets-redesign, Property 3: Bank stats aggregation invariant`
    - Generate random ticket arrays; assert `open + inProgress + completed === total` per bank
    - _Requirements: 2.3_

  - [ ]* 3.3 Write property test P4: Derived panels use filtered tickets
    - `// Feature: csr-tickets-redesign, Property 4: Derived panels use filtered tickets`
    - Generate random tickets and filter states; assert panel stats equal stats on the filtered subset
    - _Requirements: 2.6, 3.5_

  - [ ]* 3.4 Write property test P5: Resolution statistics correctness
    - `// Feature: csr-tickets-redesign, Property 5: Resolution statistics correctness`
    - Generate random arrays of positive integers as resolution times; assert avg/median/min/max
    - _Requirements: 3.1_

  - [ ]* 3.5 Write property test P6: Per-project resolution average
    - `// Feature: csr-tickets-redesign, Property 6: Per-project resolution average`
    - Generate random tickets with project and resolution data; assert per-project avg equals mean
    - _Requirements: 3.2_

  - [ ]* 3.6 Write property test P7: SLA breach count
    - `// Feature: csr-tickets-redesign, Property 7: SLA breach count`
    - Generate random tickets with varying age and status; assert breach count equals manual count
    - _Requirements: 3.3_

  - [ ]* 3.7 Write property test P8: Stale panel completeness
    - `// Feature: csr-tickets-redesign, Property 8: Stale panel completeness`
    - Generate random filtered ticket sets; assert stale panel contains exactly isStale tickets with all required fields
    - _Requirements: 4.1, 4.4_

  - [ ]* 3.8 Write property test P9: Stale sort order
    - `// Feature: csr-tickets-redesign, Property 9: Stale sort order`
    - Generate random stale ticket arrays; sort by age desc; assert adjacent pairs satisfy `a.age >= b.age`
    - _Requirements: 4.2_

  - [ ]* 3.9 Write property test P10: Stand-up report content
    - `// Feature: csr-tickets-redesign, Property 10: Stand-up report content`
    - Generate random ticket sets and reference dates; assert report sections contain correct tickets
    - _Requirements: 5.2_

  - [ ]* 3.10 Write property test P11: Stand-up plain text serialisation
    - `// Feature: csr-tickets-redesign, Property 11: Stand-up plain text serialisation`
    - Generate random StandupReport objects; assert serialised text contains all four sections and all ticket keys
    - _Requirements: 5.5_

  - [ ]* 3.11 Write property test P13: Age sort correctness
    - `// Feature: csr-tickets-redesign, Property 13: Age sort correctness`
    - Generate random ticket arrays; sort asc/desc by age; assert adjacent pair invariant
    - _Requirements: 6.5_

  - [ ]* 3.12 Write unit tests for CSRTicketsTab sub-components
    - Test `StalePanel` empty-state rendering when stale list is empty
    - Test `generateStandupReport` with fixed tickets and fixed reference date
    - Test `serializeStandupToText` verifying all four sections appear in output
    - _Requirements: 4.5, 5.2, 5.5_

- [x] 4. Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Create CSRAnalyticsTab.jsx
  - New file at `src/components/CSRAnalyticsTab.jsx`
  - Fetches independently on mount via `fetchCSRIssues` + `transformCSRIssue`
  - `WeeklyVolumeChart`: Recharts `BarChart` — tickets created per ISO week
  - `ResolutionTrendChart`: Recharts `LineChart` — avg resolution days per ISO week
  - `BacklogGrowthChart`: Recharts `AreaChart` — cumulative open ticket delta per week (created minus resolved)
  - `AssigneeHeatmap`: Recharts grouped `BarChart` — tickets per assignee per ISO week
  - All chart data derived via `useMemo`; loading/error states handled
  - _Requirements: 7.1–7.6_

  - [ ]* 5.1 Write property test P14: Weekly volume aggregation
    - `// Feature: csr-tickets-redesign, Property 14: Weekly volume aggregation`
    - Generate random ticket arrays; assert each ticket assigned to exactly one ISO week bucket and counts sum to total
    - _Requirements: 7.2_

  - [ ]* 5.2 Write property test P15: Weekly resolution trend
    - `// Feature: csr-tickets-redesign, Property 15: Weekly resolution trend`
    - Generate random resolved ticket arrays; assert weekly avg equals mean of that week's resolution times
    - _Requirements: 7.3_

  - [ ]* 5.3 Write property test P16: Backlog growth computation
    - `// Feature: csr-tickets-redesign, Property 16: Backlog growth computation`
    - Generate random ticket arrays; assert weekly delta equals created count minus resolved count per week
    - _Requirements: 7.4_

  - [ ]* 5.4 Write property test P17: Assignee workload aggregation
    - `// Feature: csr-tickets-redesign, Property 17: Assignee workload aggregation`
    - Generate random ticket arrays; assert (assignee, week) counts sum to total ticket count
    - _Requirements: 7.5_

- [x] 6. Wire CSRAnalyticsTab into SprintDashboard.jsx
  - Add `import CSRAnalyticsTab from './components/CSRAnalyticsTab.jsx'`
  - Add `'csr-analytics': { icon: BarChart3, label: 'CSR Analytics' }` to the `tabs` config map
  - Add `{activeTab === 'csr-analytics' && <CSRAnalyticsTab />}` render block alongside the existing `csr` block
  - _Requirements: 7.1_

- [x] 7. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- fast-check must be installed before running property tests (`npm install --save-dev fast-check`)
- All tests go in `src/__tests__/csrTickets.test.js`
- PDF export uses `window.print()` with a print CSS class — no third-party PDF library needed
- Each property test is tagged with `// Feature: csr-tickets-redesign, Property N: <text>`
