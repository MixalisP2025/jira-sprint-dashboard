# Requirements Document

## Introduction

This feature is a full redesign of the CSR Tickets tab in the Sprint Analytics Dashboard. The tab surfaces data from an external Jira Service Desk instance (separate credentials from the internal Jira) and currently shows limited filtering, basic KPIs, and a flat ticket table. The redesign replaces irrelevant internal-Jira filters with contextually correct ones, adds a Bank/Client breakdown panel, expands resolution time statistics, introduces a Stale Tickets panel, adds a Stand-up Report generator, enriches the ticket list with derived columns, and adds a new Analytics tab with trend charts.

## Glossary

- **CSR_Tab**: The CSR Tickets tab component (`CSRTicketsTab.jsx`) rendered inside the Sprint Analytics Dashboard.
- **Analytics_Tab**: A new, separate tab added to the dashboard dedicated to CSR analytics charts.
- **External_Jira**: The external Jira Service Desk instance accessed via `CSR_JIRA_BASE_URL`, `CSR_JIRA_EMAIL`, and `CSR_JIRA_API_TOKEN` environment variables.
- **CSR_API**: The Express proxy endpoint at `/api/jira-csr/issues` that forwards requests to the External_Jira.
- **Ticket**: A single Jira issue returned by the External_Jira.
- **Bank**: A client organisation derived by parsing the domain portion of a reporter's email address (e.g. `piraeusbank.gr` → Piraeus Bank, `eurobank.gr` → Eurobank).
- **Domain_Map**: A configurable mapping of email domains to human-readable Bank names maintained in the frontend.
- **Age**: The number of whole calendar days elapsed since a Ticket's `created` date, calculated at render time.
- **SLA_Breach**: A Ticket whose Age exceeds 30 days and whose status is not Completed or Closed.
- **Stale_Ticket**: A Ticket that has not been updated in more than 7 days and whose status is not Completed or Closed.
- **Resolution_Time**: The number of calendar days between a Ticket's `created` date and its `resolutiondate`.
- **Stand_up_Report**: A point-in-time snapshot document summarising yesterday's closures, today's new tickets, current in-progress counts per assignee, and active SLA breaches.
- **Filter_Panel**: The set of filter controls rendered at the top of the CSR_Tab.
- **Bank_Breakdown_Panel**: The panel that groups tickets by Bank and displays per-bank statistics and a horizontal bar chart.
- **Stale_Panel**: The panel listing all Stale_Tickets sorted by Age descending.
- **Resolution_Stats_Panel**: The panel displaying extended resolution time statistics.
- **Stand_up_Panel**: The panel or modal that renders the Stand_up_Report and provides export actions.

---

## Requirements

### Requirement 1: Replace Filters with Contextually Relevant Controls

**User Story:** As a support team member, I want filters that match the External Jira data, so that I can narrow down tickets without being confused by irrelevant internal-Jira options.

#### Acceptance Criteria

1. THE CSR_Tab SHALL remove the existing Sprint, Agent, and Project filter controls that reference the internal Jira.
2. THE Filter_Panel SHALL provide a Project/Queue dropdown with the options: "Sett Suite Local Market", "ais-Custody Support", and "STP to Local UAT".
3. THE Filter_Panel SHALL provide a Status dropdown with the options: Open, In Progress, and Completed.
4. THE Filter_Panel SHALL provide a Bank dropdown populated dynamically from the set of distinct email domains present in the reporter fields of loaded tickets, resolved through the Domain_Map.
5. THE Filter_Panel SHALL provide an Assignee dropdown populated dynamically from the set of distinct assignee names present in loaded tickets.
6. THE Filter_Panel SHALL provide a Date Range control accepting a start date and an end date, filtering tickets whose `created` date falls within the inclusive range.
7. THE Filter_Panel SHALL provide a toggle pill labelled "SLA Breached only" that, when active, restricts the visible ticket list to SLA_Breach tickets.
8. THE Filter_Panel SHALL provide a toggle pill labelled "Stale > 7 days" that, when active, restricts the visible ticket list to Stale_Ticket records.
9. WHEN multiple filters are active simultaneously, THE Filter_Panel SHALL apply all active filters as a logical AND, showing only tickets that satisfy every active condition.
10. WHEN a filter value is changed, THE CSR_Tab SHALL update the ticket list and all dependent panels without requiring a page reload.

---

### Requirement 2: Bank / Client Breakdown Panel

**User Story:** As a support manager, I want to see ticket volume and status broken down by bank/client, so that I can identify which clients generate the most load and track their resolution performance.

#### Acceptance Criteria

1. THE Bank_Breakdown_Panel SHALL derive each Ticket's Bank by extracting the domain from the reporter's email address and resolving it through the Domain_Map.
2. IF a reporter email domain is not present in the Domain_Map, THEN THE Bank_Breakdown_Panel SHALL display the raw domain as the Bank label.
3. THE Bank_Breakdown_Panel SHALL display, for each Bank: total ticket count, open count, in-progress count, completed count, and average Resolution_Time in calendar days.
4. THE Bank_Breakdown_Panel SHALL render the per-bank data as a horizontal bar chart where bar length represents total ticket count.
5. THE Bank_Breakdown_Panel SHALL display the numeric statistics (total, open, in-progress, completed, avg resolution) alongside each bar in the chart.
6. WHEN the active filters change, THE Bank_Breakdown_Panel SHALL recalculate and re-render using only the currently filtered set of tickets.

---

### Requirement 3: Expanded Resolution Time Statistics

**User Story:** As a support manager, I want detailed resolution time metrics beyond the average, so that I can understand the spread of resolution performance and identify SLA risk.

#### Acceptance Criteria

1. THE Resolution_Stats_Panel SHALL display the following metrics for resolved tickets: average Resolution_Time, median Resolution_Time, minimum Resolution_Time, and maximum Resolution_Time, all expressed in whole calendar days.
2. THE Resolution_Stats_Panel SHALL display a per-project breakdown of average Resolution_Time for each project that has at least one resolved ticket.
3. THE Resolution_Stats_Panel SHALL display a count of SLA_Breach tickets.
4. WHEN the SLA_Breach count is greater than zero, THE Resolution_Stats_Panel SHALL render the SLA breach count in red to draw attention.
5. WHEN the active filters change, THE Resolution_Stats_Panel SHALL recalculate all metrics using only the currently filtered set of tickets.

---

### Requirement 4: Stale Tickets Panel

**User Story:** As a support team member, I want a dedicated list of tickets that have been open and untouched for more than 7 days, so that I can prioritise follow-up actions.

#### Acceptance Criteria

1. THE Stale_Panel SHALL list all Stale_Ticket records visible under the current filters.
2. THE Stale_Panel SHALL sort Stale_Ticket records by Age descending, so the oldest tickets appear first.
3. THE Stale_Panel SHALL render the ticket key of each Stale_Ticket in red.
4. THE Stale_Panel SHALL display, for each Stale_Ticket: ticket key, summary, assignee, Bank, Age in days, and last updated date.
5. WHEN no Stale_Ticket records exist under the current filters, THE Stale_Panel SHALL display an empty-state message indicating no stale tickets were found.

---

### Requirement 5: Stand-up Report Generator

**User Story:** As a support team lead, I want to generate a daily stand-up snapshot at the click of a button, so that I can share team status quickly without manually compiling data.

#### Acceptance Criteria

1. THE CSR_Tab SHALL provide a "Generate Stand-up Report" button that, when clicked, produces a Stand_up_Report.
2. THE Stand_up_Report SHALL include: the count and list of tickets closed on the previous calendar day, the count and list of new tickets created on the current calendar day, the count of in-progress tickets grouped by assignee, and the list of active SLA_Breach tickets.
3. THE Stand_up_Panel SHALL render the Stand_up_Report in a readable format within the dashboard.
4. THE Stand_up_Panel SHALL provide an "Export as PDF" action that generates a downloadable PDF file containing the Stand_up_Report content.
5. THE Stand_up_Panel SHALL provide a "Copy to Clipboard" action that copies the Stand_up_Report as plain text to the system clipboard.
6. WHEN the "Copy to Clipboard" action succeeds, THE Stand_up_Panel SHALL display a brief confirmation message to the user.
7. IF the "Export as PDF" action fails, THEN THE Stand_up_Panel SHALL display an error message describing the failure.

---

### Requirement 6: Enriched Ticket List Columns

**User Story:** As a support team member, I want the ticket list to show the client bank, ticket age, and colour-coded status at a glance, so that I can triage tickets faster without opening each one.

#### Acceptance Criteria

1. THE CSR_Tab ticket list SHALL include a "Bank" column whose value is derived from the reporter's email domain resolved through the Domain_Map.
2. THE CSR_Tab ticket list SHALL include an "Age" column displaying the number of whole calendar days since the ticket's `created` date.
3. THE CSR_Tab ticket list SHALL render status badges using the following colour scheme: blue for Open, amber for In Progress, and green for Completed.
4. WHEN a ticket is an SLA_Breach, THE CSR_Tab ticket list SHALL render that ticket's Age value in red.
5. THE CSR_Tab ticket list SHALL remain sortable by the Age column in both ascending and descending order.

---

### Requirement 7: Analytics Tab

**User Story:** As a support manager, I want a dedicated analytics view with trend charts, so that I can monitor team performance and backlog health over time without leaving the dashboard.

#### Acceptance Criteria

1. THE Analytics_Tab SHALL be accessible as a separate tab in the Sprint Analytics Dashboard navigation, distinct from the CSR_Tab.
2. THE Analytics_Tab SHALL display a weekly ticket volume trend chart showing the number of tickets created per calendar week over the available data range.
3. THE Analytics_Tab SHALL display a resolution time trend chart showing average Resolution_Time per calendar week over the available data range.
4. THE Analytics_Tab SHALL display a backlog growth chart showing the net change in open ticket count over time.
5. THE Analytics_Tab SHALL display an assignee workload heatmap showing ticket count per assignee per calendar week.
6. WHEN the underlying ticket data is refreshed, THE Analytics_Tab SHALL update all charts to reflect the latest data.

---

### Requirement 8: Domain Map Configuration

**User Story:** As a developer, I want a maintainable mapping of email domains to bank names, so that the Bank derivation logic can be updated without code changes to multiple components.

#### Acceptance Criteria

1. THE CSR_Tab SHALL derive Bank names from a single Domain_Map data structure shared across all panels and the ticket list.
2. THE Domain_Map SHALL include at minimum the following entries: `piraeusbank.gr` → "Piraeus Bank" and `eurobank.gr` → "Eurobank".
3. WHEN a reporter email address does not contain an `@` symbol or has no recognisable domain, THE CSR_Tab SHALL display "Unknown" as the Bank value for that ticket.

---

### Requirement 9: Data Fetching and Error Handling

**User Story:** As a user, I want the CSR tab to handle API errors gracefully and keep me informed of data freshness, so that I can trust the data I'm seeing.

#### Acceptance Criteria

1. WHEN the CSR_API returns an error response, THE CSR_Tab SHALL display a human-readable error message and retain any previously loaded ticket data.
2. WHEN ticket data is being fetched, THE CSR_Tab SHALL display a loading indicator and disable the Refresh button.
3. WHEN ticket data has been successfully loaded, THE CSR_Tab SHALL display the timestamp of the last successful fetch.
4. THE CSR_Tab SHALL fetch reporter email addresses from the External_Jira as part of the standard ticket fields payload so that Bank derivation does not require additional API calls.
