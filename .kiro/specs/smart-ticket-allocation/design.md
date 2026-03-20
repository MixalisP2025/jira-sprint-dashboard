# Design Document: Smart Ticket Allocation

## Overview

Smart Ticket Allocation adds a new `allocation` tab to the existing Sprint Dashboard. It provides a swimlane-style UI for visualising unassigned tickets, configuring per-assignee project eligibility, auto-generating assignment suggestions, and manually adjusting allocations via drag-and-drop. No data is written back to Jira — the feature is entirely read/display only.

The feature is implemented as a single new component `AllocationTab` wired into the existing `SprintDashboard.jsx`. All allocation state is ephemeral (resets on page reload by design). Eligibility configuration is the only state persisted to `localStorage`.

---

## Architecture

```
SprintDashboard.jsx
  └── AllocationTab (src/components/AllocationTab.jsx)
        ├── reads: filteredData, selectedSprint, assigneeCaps, stats (props)
        ├── reads/writes: localStorage['assigneeEligibility']
        └── owns: all local allocation state (ephemeral)
```

The component is self-contained. It receives all data it needs as props from `SprintDashboard` and makes no API calls. The sprint filter already applied to `filteredData` by `SprintDashboard` means no additional sprint filtering is needed inside `AllocationTab`.

---

## Components and Interfaces

### Component Tree

```
AllocationTab
├── TopBar
│   ├── "Generate Suggestions" button
│   └── Summary counts (unassigned, suggested, no-suggestion)
├── MainLayout (flex row, horizontally scrollable)
│   ├── UnassignedPool (fixed ~280px)
│   │   ├── Pool header + count badge
│   │   └── TicketCard[] (draggable)
│   └── SwimlanesArea (flex row, overflow-x-auto)
│       └── AssigneeLane[] (fixed ~260px each)
│           ├── LaneHeader
│           │   ├── Assignee name
│           │   ├── EligibilityTags (compact project key badges)
│           │   ├── CapacityBar (allocated SP / sprint cap)
│           │   └── Expand/collapse chevron
│           ├── EligibilityEditor (expanded only)
│           │   └── project key checkboxes
│           └── TicketCard[] (allocated, draggable)
│               └── AssigneeDropdown (eligible assignees only)
└── SummaryPanel (collapsible)
    └── Copyable text block
```

### Sub-component Responsibilities

| Component | Responsibility |
|---|---|
| `AllocationTab` | Owns all local state; orchestrates data flow |
| `TopBar` | Triggers suggestion engine; shows aggregate counts |
| `UnassignedPool` | Drop target for returning tickets; renders unallocated TicketCards |
| `AssigneeLane` | Drop target for allocation; renders per-assignee TicketCards + capacity |
| `TicketCard` | Draggable item; shows key, summary, project, type, SP |
| `EligibilityEditor` | Checkbox list for toggling project eligibility per assignee |
| `CapacityBar` | Visual bar: allocated SP vs sprint capacity |
| `SummaryPanel` | Renders and copies the allocation plan as plain text |

### Props Interface

```jsx
AllocationTab.propTypes = {
  filteredData:   PropTypes.array.isRequired,   // already sprint-filtered ticket rows
  selectedSprint: PropTypes.string.isRequired,  // label for summary panel
  assigneeCaps:   PropTypes.object.isRequired,  // { [name]: number } sprint SP cap
  stats:          PropTypes.object.isRequired,  // stats.byAssignee[name].remainingCapacity etc.
}
```

---

## Data Models

### Ticket Field Accessors

Consistent with the rest of the codebase:

```js
const getKey     = t => t['Issue key'] || t['Key'] || '';
const getSummary = t => t['Summary'] || '';
const getProject = t => t['Project'] || t['B'] || '';
const getType    = t => t['Issue Type'] || '';
const getSP      = t => parseFloat(t['Story Points']) || 0;
const getAssignee= t => t['Assignee'] || t['D'] || 'Unassigned';
```

### State Shape

All state lives in `AllocationTab`. No external state management is needed.

```js
// { [assigneeName]: Set<projectKey> }
// Persisted to localStorage as { [assigneeName]: string[] }
const [eligibility, setEligibility] = useState({});

// { [ticketId]: assigneeName | null }
// null = explicitly unassigned; undefined = not yet touched (use raw data)
const [allocation, setAllocation] = useState({});

// Set<assigneeName> — which lanes are expanded to show eligibility editor
const [expandedLanes, setExpandedLanes] = useState(new Set());

// { ticketId: string, sourceAssignee: string|null } | null
const [dragging, setDragging] = useState(null);

// { id: string, valid: boolean } | null — id is assigneeName or 'unassigned'
const [dropTarget, setDropTarget] = useState(null);

const [showSummary, setShowSummary] = useState(false);
```

### Derived Values (useMemo)

```js
const projectKeys = useMemo(() =>
  [...new Set(filteredData.map(getProject).filter(Boolean))].sort(),
[filteredData]);

const EXCLUDED = ['Sotiris Mavrogianneas', 'Sofia Boustantzi'];
const assignees = useMemo(() =>
  [...new Set(filteredData.map(getAssignee)
    .filter(a => a && a !== 'Unassigned' && !EXCLUDED.includes(a))
  )].sort(),
[filteredData]);

const unassignedTickets = useMemo(() =>
  filteredData.filter(t => {
    const id = getKey(t);
    if (allocation[id] !== undefined) return allocation[id] === null;
    return !t['Assignee'] || t['Assignee'] === 'Unassigned';
  }),
[filteredData, allocation]);

const assigneeTickets = useMemo(() => {
  const map = {};
  assignees.forEach(a => { map[a] = []; });
  filteredData.forEach(t => {
    const id = getKey(t);
    const target = allocation[id];
    if (target && target !== 'NO_SUGGESTION' && map[target]) {
      map[target].push(t);
    }
  });
  return map;
}, [filteredData, allocation, assignees]);

const remainingCap = useMemo(() => {
  const result = {};
  assignees.forEach(a => {
    const cap = assigneeCaps[a] ?? stats?.byAssignee?.[a]?.sprintCapacity ?? 0;
    const used = (assigneeTickets[a] || []).reduce((s, t) => s + Math.max(getSP(t), 0), 0);
    result[a] = Math.max(0, cap - used);
  });
  return result;
}, [assignees, assigneeCaps, stats, assigneeTickets]);
```

---

## Suggestion Engine Algorithm

The engine runs entirely in-memory and is deterministic for identical inputs. It lives in `src/utils/allocationSuggestions.js`.

```js
export function generateSuggestions(unassignedTickets, eligibility, remainingCap) {
  const workingCap = { ...remainingCap };
  const result = {};

  // Greedy: largest tickets first to maximise utilisation
  const sorted = [...unassignedTickets].sort((a, b) => getSP(b) - getSP(a));

  for (const ticket of sorted) {
    const id = getKey(ticket);
    const sp = Math.max(getSP(ticket), 1); // treat 0 SP as 1
    const project = getProject(ticket);

    const candidates = Object.keys(workingCap)
      .filter(a => eligibility[a]?.has(project))
      .filter(a => workingCap[a] >= sp)
      // Primary: highest remaining cap; secondary: name alphabetically (determinism)
      .sort((a, b) => workingCap[b] - workingCap[a] || a.localeCompare(b));

    if (candidates.length > 0) {
      const chosen = candidates[0];
      result[id] = chosen;
      workingCap[chosen] -= sp;
    } else {
      result[id] = 'NO_SUGGESTION';
    }
  }

  return result; // { [ticketId]: assigneeName | 'NO_SUGGESTION' }
}
```

**Complexity:** O(T × A log A) where T = unassigned tickets, A = assignees. Well within 500ms for T=500, A=50.

**Determinism:** Ties in remaining capacity are broken by assignee name (alphabetical), ensuring identical outputs for identical inputs.

---

## Drag-and-Drop Implementation

No external library. Uses the native HTML5 `draggable` attribute and `DragEvent` API.

### TicketCard — drag source

```jsx
<div
  draggable
  onDragStart={e => {
    e.dataTransfer.setData('ticketId', getKey(ticket));
    e.dataTransfer.setData('sourceAssignee', currentAssignee ?? '');
    setDragging({ ticketId: getKey(ticket), sourceAssignee: currentAssignee ?? null });
    e.currentTarget.classList.add('opacity-50');
  }}
  onDragEnd={e => {
    setDragging(null);
    e.currentTarget.classList.remove('opacity-50');
  }}
>
```

### AssigneeLane — drop target

```jsx
<div
  onDragOver={e => {
    e.preventDefault();
    const valid = dragging && isEligible(dragging.ticketId, assigneeName);
    setDropTarget({ id: assigneeName, valid: !!valid });
  }}
  onDragLeave={() => setDropTarget(null)}
  onDrop={e => {
    e.preventDefault();
    const ticketId = e.dataTransfer.getData('ticketId');
    if (isEligible(ticketId, assigneeName)) {
      setAllocation(prev => ({ ...prev, [ticketId]: assigneeName }));
    }
    setDropTarget(null);
    setDragging(null);
  }}
  className={dropTarget?.id === assigneeName
    ? dropTarget.valid ? 'ring-2 ring-green-400 bg-green-900/20'
                       : 'ring-2 ring-red-400 bg-red-900/20'
    : ''}
>
```

### UnassignedPool — always-valid drop target

```jsx
<div
  onDragOver={e => { e.preventDefault(); setDropTarget({ id: 'unassigned', valid: true }); }}
  onDragLeave={() => setDropTarget(null)}
  onDrop={e => {
    e.preventDefault();
    const ticketId = e.dataTransfer.getData('ticketId');
    setAllocation(prev => ({ ...prev, [ticketId]: null }));
    setDropTarget(null);
    setDragging(null);
  }}
>
```

### Eligibility check helper

```js
const isEligible = (ticketId, assigneeName) => {
  const ticket = filteredData.find(t => getKey(t) === ticketId);
  if (!ticket) return false;
  return eligibility[assigneeName]?.has(getProject(ticket)) ?? false;
};
```

### Visual Feedback Summary

| State | CSS classes |
|---|---|
| Valid drop target | `ring-2 ring-green-400 bg-green-900/20` |
| Invalid drop target | `ring-2 ring-red-400 bg-red-900/20` |
| Dragged card | `opacity-50` |
| Assignee at full capacity | `text-red-400` on capacity display |

---

## Eligibility Persistence

```js
const ELIGIBILITY_KEY = 'assigneeEligibility';

// On mount: restore from localStorage or seed defaults
useEffect(() => {
  const saved = localStorage.getItem(ELIGIBILITY_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      setEligibility(Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, new Set(v)])
      ));
    } catch (_) { /* ignore corrupt data, fall through to seeding */ }
  } else {
    const defaults = {};
    assignees.forEach(a => {
      defaults[a] = new Set(projectKeys.filter(p => ['CC', 'WTR1'].includes(p)));
    });
    setEligibility(defaults);
  }
}, []); // runs once on mount

// Persist on every change (Sets -> arrays for JSON)
useEffect(() => {
  if (Object.keys(eligibility).length === 0) return;
  const serialisable = Object.fromEntries(
    Object.entries(eligibility).map(([k, v]) => [k, [...v]])
  );
  localStorage.setItem(ELIGIBILITY_KEY, JSON.stringify(serialisable));
}, [eligibility]);
```

Sets are serialised as arrays for JSON compatibility and restored on load.

---

## Wiring into SprintDashboard.jsx

### 1. Import

```jsx
import AllocationTab from './components/AllocationTab';
```

### 2. Add tab entry

```js
const tabs = {
  // ...existing tabs...
  allocation: { icon: Target, label: 'Allocation' },
};
```

`Target` is already imported from `lucide-react` in `SprintDashboard.jsx`.

### 3. Render tab content

```jsx
{activeTab === 'allocation' && (
  <AllocationTab
    filteredData={filteredData}
    selectedSprint={selectedSprint}
    assigneeCaps={assigneeCaps}
    stats={stats}
  />
)}
```

### 4. FilterPanel condition

The existing condition `{activeTab !== 'timeline' && <FilterPanel ... />}` already covers the `allocation` tab — no change needed. Sprint/assignee/project filter changes automatically flow into `filteredData` before reaching `AllocationTab`.

---

## Copyable Summary Panel

Generated as plain text from the current `allocation` state:

```
Sprint: <selectedSprint>
Generated: <ISO timestamp>

=== ALLOCATION PLAN ===

[Alice]  (12 / 14 SP)
  - PROJ-101  [3 SP]  Fix login bug
  - PROJ-205  [5 SP]  Add export feature

[Bob]  (8 / 14 SP)
  - PROJ-102  [8 SP]  Refactor auth module

=== UNASSIGNED (No Suggestion) ===
  - PROJ-999  [13 SP]  Large migration task
```

A "Copy to Clipboard" button uses `navigator.clipboard.writeText()`. The panel is collapsible via `showSummary` state.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Eligibility Config Round-Trip

*For any* valid eligibility configuration (mapping of assignee names to sets of project keys), serialising it to `localStorage` and then restoring it should produce an identical configuration with all assignee to project key mappings preserved exactly.

**Validates: Requirements 1.4, 1.5**

---

### Property 2: Unassigned Pool Completeness

*For any* `filteredData` array and allocation map, the unassigned pool should contain exactly the tickets whose allocation entry is `null` or `undefined` (no assignee in raw data and no allocation override), and no other tickets.

**Validates: Requirements 2.1, 4.2**

---

### Property 3: Ticket Card Renders All Required Fields

*For any* ticket object, the rendered `TicketCard` output should contain the ticket's issue key, summary, project key, issue type, and story points.

**Validates: Requirements 2.3**

---

### Property 4: Unassigned Count Invariant

*For any* allocation state, the count displayed at the top of the unassigned pool should always equal the length of the `unassignedTickets` derived array.

**Validates: Requirements 2.4**

---

### Property 5: Suggestion Engine Completeness

*For any* set of unassigned tickets and eligibility/capacity configuration, every ticket in the input should appear in the result map — either mapped to an assignee name or to `'NO_SUGGESTION'`. No ticket should be silently dropped.

**Validates: Requirements 3.1**

---

### Property 6: Suggestion Engine Eligibility Invariant

*For any* suggestion result where a ticket is assigned to an assignee (not `'NO_SUGGESTION'`), the assignee's eligibility set must contain the ticket's project key. No suggestion should pair a ticket with an ineligible assignee.

**Validates: Requirements 3.2**

---

### Property 7: Suggestion Engine Capacity and Deduction Invariant

*For any* suggestion run, the working capacity for each assignee should be correctly deducted after each assignment such that: (a) no assignee is assigned more SP than their remaining capacity at the time of assignment, and (b) the sum of SP across all tickets assigned to an assignee equals the total reduction in that assignee's working capacity.

**Validates: Requirements 3.3, 3.6**

---

### Property 8: Suggestion Engine Selects Highest-Capacity Candidate

*For any* ticket with multiple eligible assignees who all have sufficient remaining capacity, the suggestion engine should select the assignee with the highest remaining capacity. When capacities are tied, the assignee that comes first alphabetically should be selected.

**Validates: Requirements 3.4**

---

### Property 9: No Suggestion When No Eligible Capacity

*For any* ticket where no eligible assignee has remaining capacity >= the ticket's story points (treating 0 SP as 1), the result for that ticket should be `'NO_SUGGESTION'`.

**Validates: Requirements 3.5, 3.8**

---

### Property 10: Eligible Drop Updates Allocation

*For any* ticket dragged onto an assignee whose eligibility set contains the ticket's project key, the allocation map should be updated to map that ticket's ID to the target assignee name.

**Validates: Requirements 4.3, 4.4**

---

### Property 11: Ineligible Drop Rejected

*For any* ticket dragged onto an assignee whose eligibility set does not contain the ticket's project key, the allocation map should remain unchanged.

**Validates: Requirements 4.6**

---

### Property 12: Unassigned Drop Round-Trip

*For any* ticket that has been allocated to an assignee, dropping it back onto the unassigned pool should set its allocation entry to `null`, returning it to the unassigned pool.

**Validates: Requirements 4.5**

---

### Property 13: Assignee Dropdown Contains Only Eligible Assignees

*For any* allocated ticket, the assignee dropdown rendered alongside it should contain exactly the assignees whose eligibility set includes the ticket's project key — no more, no less.

**Validates: Requirements 4.9**

---

### Property 14: Full Capacity Visual Indicator

*For any* assignee whose remaining capacity is zero or below, the capacity display in their lane header should apply the full-capacity visual indicator (e.g., `text-red-400` class or equivalent).

**Validates: Requirements 5.3**

---

## Error Handling

**Invalid localStorage data:** `JSON.parse` is wrapped in `try/catch`. On failure the component falls back to default seeding (pre-select CC and WTR1 if present). No error is surfaced to the user.

**Missing ticket fields:** All field accessors use fallback chains. Tickets with empty keys are filtered out via `filter(Boolean)` on `getKey`. Missing story points default to `0`.

**Zero story points:** The suggestion engine treats 0 SP tickets as requiring 1 SP (`Math.max(getSP(ticket), 1)`), preventing assignment to fully-allocated assignees while still allowing assignment when any capacity remains.

**Empty sprint data:** If `filteredData` is empty or contains no unassigned tickets, the unassigned pool renders an empty-state message ("All tickets are assigned"). The suggestion engine returns `{}` without error.

**Drag ending outside a drop target:** `onDragEnd` on the source card always fires and calls `setDragging(null)`, preventing stale highlight states regardless of where the drag ends.

**Clipboard API unavailability:** `navigator.clipboard.writeText()` is wrapped in `try/catch`. On failure it falls back to a `textarea` + `document.execCommand('copy')` approach.

---

## Testing Strategy

### Dual Testing Approach

Both unit tests and property-based tests are required and complementary:
- Unit tests cover specific examples, integration points, and edge cases.
- Property-based tests verify universal correctness across randomised inputs.

### Property-Based Testing

**Library:** `fast-check` (dev dependency only, no new runtime packages).

Each property-based test must run a minimum of **100 iterations** and include a comment tag:

`// Feature: smart-ticket-allocation, Property N: <property text>`

Each correctness property maps to exactly one property-based test:

| Property | Test description |
|---|---|
| P1 | Generate random eligibility maps → serialise → deserialise → assert deep equal |
| P2 | Generate random filteredData + allocation → assert unassigned pool = tickets with null/undefined allocation |
| P3 | Generate random ticket objects → render TicketCard → assert all 5 fields present in output |
| P4 | Generate random filteredData + allocation → assert displayed count = unassignedTickets.length |
| P5 | Generate random tickets + eligibility + caps → run engine → assert every ticket ID in result |
| P6 | Generate random inputs → run engine → assert all non-NO_SUGGESTION results are eligible |
| P7 | Generate random inputs → run engine → assert capacity deductions are consistent |
| P8 | Construct scenario with multiple eligible assignees → assert highest-cap (then alpha) is chosen |
| P9 | Generate tickets where no assignee has capacity → assert all results are NO_SUGGESTION |
| P10 | Generate eligible drop event → assert allocation map updated |
| P11 | Generate ineligible drop event → assert allocation map unchanged |
| P12 | Allocate ticket → drop to unassigned → assert allocation[id] === null |
| P13 | Generate ticket + eligibility → render dropdown → assert options = eligible assignees only |
| P14 | Generate assignee with 0 remaining cap → assert full-capacity class applied |

### Unit Tests

Unit tests focus on:
- Suggestion engine edge cases: 0 SP tickets, all assignees ineligible, single assignee, empty input.
- Eligibility seeding: CC/WTR1 pre-selection when no saved config exists.
- Empty sprint state: correct empty-state message when no unassigned tickets.
- Summary panel text: correct format for a known allocation state.
- Wiring smoke test: `AllocationTab` renders without crashing given minimal valid props.

### Test File Locations

```
src/__tests__/allocationSuggestions.test.js   # suggestion engine unit + property tests
src/__tests__/AllocationTab.test.jsx           # component unit tests
```
