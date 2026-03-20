# Implementation Tasks

- [ ] 1. Create AllocationTab component skeleton with layout
  - [ ] 1.1 Create `src/components/AllocationTab.jsx` with a functional component accepting `filteredData`, `selectedSprint`, `assigneeCaps`, `stats` props
  - [ ] 1.2 Add top-level layout: flex row with left panel (UnassignedPool) and right scrollable area (SwimlanesArea)
  - [ ] 1.3 Add `TopBar` section at the top with placeholder "Generate Suggestions" button and summary count placeholders
  - [ ] 1.4 Add `SummaryPanel` placeholder at the bottom (hidden by default)
  - [ ] 1.5 Define all field accessor helpers (`getKey`, `getSummary`, `getProject`, `getType`, `getSP`, `getAssignee`) consistent with existing codebase patterns
  - [ ] 1.6 Derive `assignees` list via `useMemo` from `filteredData` (exclude 'Unassigned' and excluded assignees, sort alphabetically)
  - [ ] 1.7 Derive `projectKeys` list via `useMemo` from `filteredData`
  - [ ] 1.8 Apply dark theme Tailwind classes matching existing dashboard style (slate-800/900 backgrounds, slate-700 borders)

- [ ] 2. Implement eligibility config UI
  - [ ] 2.1 Add `eligibility` state: `{ [assigneeName]: Set<projectKey> }`
  - [ ] 2.2 On mount, restore `eligibility` from `localStorage` key `assigneeEligibility` (deserialise arrays back to Sets)
  - [ ] 2.3 If no saved config exists, seed defaults: pre-select `CC` and `WTR1` project keys for all assignees where those keys are present in `projectKeys`
  - [ ] 2.4 Persist `eligibility` to `localStorage` on every change via `useEffect` (serialise Sets as arrays)
  - [ ] 2.5 Add `expandedLanes` state (`Set<assigneeName>`) to track which assignee rows are expanded
  - [ ] 2.6 In each `AssigneeLane` header, render compact project key tags for the assignee's current eligible projects
  - [ ] 2.7 Add expand/collapse chevron button to each lane header that toggles `expandedLanes`
  - [ ] 2.8 When a lane is expanded, render `EligibilityEditor`: a checkbox list of all `projectKeys`, checked state driven by `eligibility[assignee]`
  - [ ] 2.9 On checkbox toggle, update `eligibility` state for that assignee within the same render cycle

- [ ] 3. Implement unassigned ticket pool panel
  - [ ] 3.1 Add `allocation` state: `{ [ticketId]: assigneeName | null }` — `null` means explicitly unassigned, `undefined` means use original data
  - [ ] 3.2 Derive `unassignedTickets` via `useMemo`: tickets where `allocation[id] === null` OR (`allocation[id] === undefined` AND original assignee is empty/Unassigned)
  - [ ] 3.3 Render `UnassignedPool` left panel with a header showing ticket count badge
  - [ ] 3.4 Render a `TicketCard` for each unassigned ticket showing: issue key, summary (truncated), project key badge, issue type, story points
  - [ ] 3.5 Show "All tickets are assigned" empty state message when `unassignedTickets` is empty

- [ ] 4. Implement assignee swimlane columns
  - [ ] 4.1 Derive `assigneeTickets` via `useMemo`: for each assignee, collect tickets where `allocation[id] === assigneeName`
  - [ ] 4.2 Implement capacity helpers: `sprintCap`, `allocatedSP`, `remaining` per assignee
  - [ ] 4.3 Render `SwimlanesArea` as a horizontally scrollable flex row of `AssigneeLane` columns
  - [ ] 4.4 Each `AssigneeLane` shows: assignee name, eligible project tags, `CapacityBar`, and their allocated `TicketCard` list
  - [ ] 4.5 `CapacityBar`: filled portion = `allocatedSP / sprintCap`, colour changes to red when `remaining === 0`
  - [ ] 4.6 Visually indicate "Full Capacity" when `remaining(assignee) === 0` (red badge on lane header)
  - [ ] 4.7 Each allocated `TicketCard` includes an `AssigneeDropdown`: a `<select>` populated with only eligible assignees for that ticket's project, plus an "Unassign" option

- [ ] 5. Implement HTML5 drag-and-drop
  - [ ] 5.1 Add `dragging` state and `dropTarget` state
  - [ ] 5.2 On `TicketCard`: set `draggable={true}`, implement `onDragStart` and `onDragEnd`
  - [ ] 5.3 Apply `opacity-50` class to the card being dragged
  - [ ] 5.4 On `AssigneeLane`: implement `onDragOver`, `onDragLeave`, `onDrop` with eligibility validation
  - [ ] 5.5 On `UnassignedPool`: implement `onDragOver` (always valid) and `onDrop` (set allocation to null)
  - [ ] 5.6 Apply green ring to valid drop targets and red ring to invalid drop targets during drag
  - [ ] 5.7 Implement `isEligible(ticketId, assigneeName)` helper

- [ ] 6. Implement suggestion engine
  - [ ] 6.1 Create `src/utils/allocationSuggestions.js` with pure `generateSuggestions` function
  - [ ] 6.2 Sort tickets by SP descending (greedy highest-first), treat 0 SP as 1
  - [ ] 6.3 For each ticket: find eligible assignees with sufficient capacity, sort by remaining cap descending then name alphabetically
  - [ ] 6.4 Return `{ [ticketId]: assigneeName | 'NO_SUGGESTION' }`
  - [ ] 6.5 On "Generate Suggestions" click: run engine, merge results into `allocation` state without overwriting manual allocations
  - [ ] 6.6 Update `TopBar` summary counts: total unassigned, suggested, no-suggestion-available

- [ ] 7. Implement copyable summary panel
  - [ ] 7.1 Add `showSummary` state and "Show Summary" toggle button in `TopBar`
  - [ ] 7.2 Generate summary text: sprint header, timestamp, per-assignee sections, unassigned section
  - [ ] 7.3 Add "Copy to Clipboard" button with `navigator.clipboard.writeText()` and "Copied!" feedback
  - [ ] 7.4 Render summary in a `<pre>` with monospace font

- [ ] 8. Wire AllocationTab into SprintDashboard.jsx
  - [ ] 8.1 Import `AllocationTab` in `SprintDashboard.jsx`
  - [ ] 8.2 Add `allocation` tab entry using the already-imported `Target` icon
  - [ ] 8.3 Add conditional render block for `activeTab === 'allocation'`
  - [ ] 8.4 Pass `filteredData`, `selectedSprint`, `assigneeCaps`, `stats` props to `AllocationTab`
  - [ ] 8.5 Verify `FilterPanel` is shown for the allocation tab
