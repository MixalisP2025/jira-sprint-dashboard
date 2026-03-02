# Sprint Planner Design Document

## Overview

The Sprint Planner is a client-side planning tool that integrates as a new tab in the existing Sprint Analytics Dashboard. It enables Product Managers to configure sprint parameters, prioritize projects across three tiers (Must Ship, Important, Ease Off), allocate story points using interactive sliders, detect resource conflicts in real-time, and export actionable sprint plans to Excel and Jira formats.

### Key Design Principles

1. **Client-Side Only**: All computation happens in the browser without API calls, operating on the existing dashboard's data
2. **Performance First**: Memoization and efficient algorithms to handle 2,162 tickets with sub-100ms response times
3. **Seamless Integration**: Matches existing dark theme, component patterns, and data flow architecture
4. **Accessibility**: Full keyboard navigation, ARIA labels, and responsive design
5. **Persistence**: Automatic localStorage saves to preserve work across sessions

### Technical Stack

- React 18.2.0 with hooks (useState, useMemo, useEffect, useCallback)
- Tailwind CSS for styling (matching existing dark theme)
- Recharts 2.12.7 for any visualization needs
- SheetJS (xlsx) for Excel export
- Native browser APIs for clipboard and file download

## Architecture

### High-Level Component Structure

```
SprintDashboard (existing)
└── SprintPlanner (new tab)
    ├── SprintSetupBar
    │   ├── Sprint name input
    │   ├── Date pickers (start/end)
    │   ├── Capacity/velocity inputs
    │   └── Buffer percentage slider
    ├── PlanSummary
    │   ├── Capacity overview
    │   ├── Allocation totals
    │   ├── Overload warnings count
    │   └── Export buttons
    ├── ProjectPriorityPanel (x3 instances)
    │   ├── Tier header (Must Ship / Important / Ease Off)
    │   ├── Drop zone for drag-and-drop
    │   └── ProjectCard[] (list of projects)
    │       ├── Project name & color
    │       ├── Backlog depth display
    │       ├── Allocation slider
    │       ├── Assignee chips
    │       └── Suggestion button
    └── OverloadWarnings
        └── Warning cards per overloaded assignee
```


### Data Flow Architecture

```
Raw Dashboard Data (filteredData from SprintDashboard)
    ↓
useSprintPlanner Hook (business logic layer)
    ↓
Derived State (memoized calculations)
    ├── projectsWithBacklog: { projectName, backlogDepth, assignees, color }[]
    ├── assigneeCapacities: { assigneeName: capacity }
    ├── historicalVelocity: number
    └── sprintDefaults: { name, startDate, endDate, capacity }
    ↓
Plan State (user-editable)
    ├── sprintConfig: { name, startDate, endDate, velocityTarget, bufferPct }
    ├── projectTiers: { mustShip: [], important: [], easeOff: [] }
    └── allocations: { projectName: storyPoints }
    ↓
Real-time Calculations (memoized)
    ├── totalAllocated: sum of all allocations
    ├── unallocated: capacity - totalAllocated
    ├── assigneeLoads: { assigneeName: { allocated, capacity, overage } }
    ├── overloadWarnings: { assignee, projects, overage }[]
    └── suggestions: { projectName: suggestedSP }
    ↓
UI Components (render)
```

### State Management Strategy

The Sprint Planner uses a custom hook `useSprintPlanner` to encapsulate all business logic and state management:

**Hook Interface:**
```javascript
const {
  // Sprint configuration
  sprintConfig,
  updateSprintConfig,
  
  // Project organization
  projectTiers,
  moveProject,
  
  // Allocations
  allocations,
  updateAllocation,
  acceptSuggestion,
  acceptAllSuggestions,
  
  // Computed values
  projectsWithBacklog,
  totalAllocated,
  unallocated,
  overloadWarnings,
  suggestions,
  
  // Validation
  validationErrors,
  canExport,
  
  // Actions
  clearPlan,
  exportToExcel,
  exportToJira,
} = useSprintPlanner(filteredData, assigneeCaps, sprintDates);
```


## Components and Interfaces

### 1. SprintPlanner (Main Component)

**Location:** `src/components/SprintPlanner/index.jsx`

**Responsibilities:**
- Orchestrate all child components
- Manage drag-and-drop context
- Handle localStorage persistence
- Integrate with parent SprintDashboard

**Props:**
```javascript
{
  filteredData: Array,      // From parent SprintDashboard
  assigneeCaps: Object,     // From parent SprintDashboard
  sprintDates: Object,      // From parent SprintDashboard
  stats: Object,            // For historical velocity calculation
}
```

**Key Features:**
- Uses `useSprintPlanner` hook for all business logic
- Debounces localStorage saves (500ms)
- Provides drag-and-drop context using HTML5 Drag API
- Renders in dark theme matching existing dashboard

### 2. SprintSetupBar

**Location:** `src/components/SprintPlanner/SprintSetupBar.jsx`

**Responsibilities:**
- Display and edit sprint configuration parameters
- Validate date ranges and numeric inputs
- Show real-time capacity calculations

**Props:**
```javascript
{
  config: {
    name: string,
    startDate: Date,
    endDate: Date,
    teamCapacity: number,
    velocityTarget: number,
    bufferPercentage: number,
  },
  onChange: (field, value) => void,
  validationErrors: string[],
}
```

**UI Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ Sprint Name: [Sprint 24        ]  Start: [01/13/2025]  │
│ End: [01/27/2025]  Capacity: [120 SP]  Velocity: [100] │
│ Buffer: [━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━] 20%   │
└─────────────────────────────────────────────────────────┘
```

**Validation Rules:**
- Sprint name: required, non-empty
- End date: must be after start date
- Velocity target: >= 0
- Buffer percentage: 0-100


### 3. ProjectPriorityPanel

**Location:** `src/components/SprintPlanner/ProjectPriorityPanel.jsx`

**Responsibilities:**
- Render a single priority tier section
- Handle drop events for drag-and-drop
- Display projects in the tier
- Maintain visual feedback during drag operations

**Props:**
```javascript
{
  tier: 'mustShip' | 'important' | 'easeOff',
  title: string,
  projects: Array<{
    name: string,
    backlogDepth: number,
    assignees: string[],
    color: string,
  }>,
  allocations: Object,
  suggestions: Object,
  onDrop: (projectName, targetTier) => void,
  onAllocationChange: (projectName, value) => void,
  onAcceptSuggestion: (projectName) => void,
}
```

**UI Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ 🎯 MUST SHIP                                      (3)   │
├─────────────────────────────────────────────────────────┤
│ [ProjectCard: Project Alpha]                            │
│ [ProjectCard: Project Beta]                             │
│ [ProjectCard: Project Gamma]                            │
│                                                          │
│ [Drop zone - drag projects here]                        │
└─────────────────────────────────────────────────────────┘
```

**Drag-and-Drop Behavior:**
- Visual highlight on dragover
- Smooth animations for project movement
- Keyboard support (Space to pick/drop)

### 4. ProjectCard

**Location:** `src/components/SprintPlanner/ProjectCard.jsx`

**Responsibilities:**
- Display project information
- Render allocation slider
- Show assignee chips
- Handle drag events

**Props:**
```javascript
{
  project: {
    name: string,
    backlogDepth: number,
    assignees: string[],
    color: string,
  },
  allocation: number,
  suggestion: number,
  onAllocationChange: (value) => void,
  onAcceptSuggestion: () => void,
  onDragStart: (projectName) => void,
  onDragEnd: () => void,
}
```

**UI Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ ● Project Alpha                    Backlog: 45 SP       │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ 0 ←──────────●──────────────────────────────────→ 45   │
│ Allocated: 20 SP    [✓ Accept Suggestion: 25 SP]       │
│ Assignees: [Alice] [Bob] [Charlie]                      │
└─────────────────────────────────────────────────────────┘
```

**Slider Behavior:**
- Range: 0 to backlogDepth
- Keyboard: Arrow keys for adjustment
- Visual: Current value, suggestion indicator
- Warning: Red border if exceeds backlog


### 5. PlanSummary

**Location:** `src/components/SprintPlanner/PlanSummary.jsx`

**Responsibilities:**
- Display capacity overview
- Show allocation totals
- Render overload warnings
- Provide export buttons

**Props:**
```javascript
{
  sprintConfig: Object,
  totalAllocated: number,
  unallocated: number,
  overloadWarnings: Array,
  canExport: boolean,
  onExportExcel: () => void,
  onExportJira: () => void,
  onClearPlan: () => void,
  onAcceptAllSuggestions: () => void,
}
```

**UI Layout:**
```
┌─────────────────────────────────────────────────────────┐
│ SPRINT SUMMARY                                          │
│ Team Capacity: 120 SP  |  Allocated: 95 SP  |  Free: 25│
│ ⚠️  2 Assignees Overloaded                              │
│                                                          │
│ [Accept All Suggestions] [Export to Excel] [Copy Jira]  │
│ [Clear Plan]                                            │
└─────────────────────────────────────────────────────────┘
```

**Overload Warning Display:**
```
⚠️  Alice Johnson - Overloaded by 8 SP
    Capacity: 40 SP | Allocated: 48 SP
    Contributing projects: Project Alpha (20), Project Beta (28)
```

### 6. useSprintPlanner Hook

**Location:** `src/hooks/useSprintPlanner.js`

**Responsibilities:**
- Encapsulate all business logic
- Manage plan state
- Compute derived values with memoization
- Handle localStorage persistence
- Provide action methods

**Implementation Structure:**
```javascript
export function useSprintPlanner(filteredData, assigneeCaps, sprintDates) {
  // === STATE ===
  const [sprintConfig, setSprintConfig] = useState(defaultConfig);
  const [projectTiers, setProjectTiers] = useState({ mustShip: [], important: [], easeOff: [] });
  const [allocations, setAllocations] = useState({});
  
  // === MEMOIZED DERIVED DATA ===
  const projectsWithBacklog = useMemo(() => computeProjectBacklogs(filteredData), [filteredData]);
  const historicalVelocity = useMemo(() => computeHistoricalVelocity(filteredData), [filteredData]);
  const assigneeLoads = useMemo(() => computeAssigneeLoads(allocations, projectsWithBacklog, assigneeCaps), 
    [allocations, projectsWithBacklog, assigneeCaps]);
  const overloadWarnings = useMemo(() => computeOverloadWarnings(assigneeLoads), [assigneeLoads]);
  const suggestions = useMemo(() => computeSuggestions(projectTiers, projectsWithBacklog, sprintConfig), 
    [projectTiers, projectsWithBacklog, sprintConfig]);
  
  // === ACTIONS ===
  const updateSprintConfig = useCallback((field, value) => { /* ... */ }, []);
  const moveProject = useCallback((projectName, targetTier) => { /* ... */ }, []);
  const updateAllocation = useCallback((projectName, value) => { /* ... */ }, []);
  
  // === PERSISTENCE ===
  useEffect(() => {
    const debounced = debounce(() => saveToLocalStorage(sprintConfig, projectTiers, allocations), 500);
    debounced();
  }, [sprintConfig, projectTiers, allocations]);
  
  return { /* all state and methods */ };
}
```


## Data Models

### SprintConfig

```javascript
{
  name: string,              // e.g., "Sprint 24"
  startDate: Date,           // Sprint start date
  endDate: Date,             // Sprint end date
  teamCapacity: number,      // Total available story points
  velocityTarget: number,    // Planned completion target
  bufferPercentage: number,  // 0-100, percentage reserved for unplanned work
}
```

### ProjectTiers

```javascript
{
  mustShip: string[],    // Array of project names
  important: string[],   // Array of project names
  easeOff: string[],     // Array of project names
}
```

### Allocations

```javascript
{
  [projectName: string]: number,  // Story points allocated to each project
}
```

### ProjectWithBacklog

```javascript
{
  name: string,              // Project name
  backlogDepth: number,      // Total SP in "To Do" status
  assignees: string[],       // Unique assignees working on this project
  color: string,             // Hex color from dashboard theme
  ticketKeys: string[],      // Jira ticket keys for reference
}
```

### AssigneeLoad

```javascript
{
  [assigneeName: string]: {
    capacity: number,        // From assigneeCaps
    allocated: number,       // Sum of allocations for projects they're on
    overage: number,         // allocated - capacity (if positive, overloaded)
    projects: Array<{        // Projects contributing to their load
      name: string,
      allocation: number,
    }>,
  }
}
```

### OverloadWarning

```javascript
{
  assignee: string,
  capacity: number,
  allocated: number,
  overage: number,
  projects: Array<{
    name: string,
    allocation: number,
  }>,
}
```

### Suggestion

```javascript
{
  [projectName: string]: number,  // Suggested story points for each project
}
```


### PlanState (localStorage)

```javascript
{
  version: 1,                    // Schema version for future migrations
  sprintName: string,            // Used as key identifier
  timestamp: string,             // ISO timestamp of last save
  sprintConfig: SprintConfig,
  projectTiers: ProjectTiers,
  allocations: Allocations,
}
```

**localStorage Key Format:** `sprint-plan-${sprintName}`

### ExcelExport Structure

**Sheet 1: Sprint Configuration**
```
Sprint Name:        Sprint 24
Start Date:         01/13/2025
End Date:           01/27/2025
Team Capacity:      120 SP
Velocity Target:    100 SP
Buffer:             20%
```

**Sheet 2: Project Allocations**
```
| Project Name  | Priority Tier | Backlog Depth | Allocated SP | Assignees           |
|---------------|---------------|---------------|--------------|---------------------|
| Project Alpha | Must Ship     | 45            | 20           | Alice, Bob          |
| Project Beta  | Must Ship     | 60            | 35           | Alice, Charlie      |
| Project Gamma | Important     | 30            | 15           | Bob, David          |
```

**Sheet 3: Summary**
```
Total Allocated:    95 SP
Unallocated:        25 SP
Team Capacity:      120 SP
Utilization:        79%
```

**Sheet 4: Warnings (if any)**
```
| Assignee       | Capacity | Allocated | Overage | Contributing Projects    |
|----------------|----------|-----------|---------|--------------------------|
| Alice Johnson  | 40       | 48        | 8       | Project Alpha, Beta      |
```

### JiraComment Format

```markdown
h2. Sprint 24 Plan (01/13/2025 - 01/27/2025)

*Team Capacity:* 120 SP | *Velocity Target:* 100 SP | *Buffer:* 20%

h3. Must Ship (55 SP)
* Project Alpha - 20 SP (Assignees: Alice, Bob)
* Project Beta - 35 SP (Assignees: Alice, Charlie)

h3. Important (15 SP)
* Project Gamma - 15 SP (Assignees: Bob, David)

h3. Ease Off (25 SP)
* Project Delta - 25 SP (Assignees: David, Eve)

---
*Summary:* 95 SP allocated | 25 SP unallocated | 79% utilization

{warning}
*Overload Warnings:*
* Alice Johnson: 48/40 SP (+8 overage) - Project Alpha (20), Project Beta (28)
{warning}
```


## Algorithm Designs

### 1. Backlog Depth Calculation

**Purpose:** Compute total story points in "To Do" status for each project

**Algorithm:**
```javascript
function computeProjectBacklogs(filteredData) {
  const projectMap = new Map();
  
  for (const ticket of filteredData) {
    const project = ticket['Project'] || ticket['B'];
    const status = ticket['Status'] || ticket['E'];
    const storyPoints = parseFloat(ticket['Story Points'] || ticket['I']) || 0;
    const assignee = ticket['Assignee'] || ticket['D'];
    const key = ticket['Key'] || ticket['A'];
    
    // Only count "To Do" tickets
    if (status !== 'To Do') continue;
    
    if (!projectMap.has(project)) {
      projectMap.set(project, {
        name: project,
        backlogDepth: 0,
        assignees: new Set(),
        ticketKeys: [],
        color: getProjectColor(project), // From existing dashboard
      });
    }
    
    const projectData = projectMap.get(project);
    projectData.backlogDepth += storyPoints;
    if (assignee) projectData.assignees.add(assignee);
    projectData.ticketKeys.push(key);
  }
  
  // Convert Sets to Arrays
  return Array.from(projectMap.values()).map(p => ({
    ...p,
    assignees: Array.from(p.assignees),
  }));
}
```

**Complexity:** O(n) where n = number of tickets
**Memoization:** Computed once on mount, cached until filteredData changes

### 2. Historical Velocity Calculation

**Purpose:** Calculate average story points completed per sprint

**Algorithm:**
```javascript
function computeHistoricalVelocity(filteredData) {
  const sprintCompletions = new Map();
  
  for (const ticket of filteredData) {
    const sprint = ticket['Sprint'] || ticket['G'];
    const status = ticket['Status'] || ticket['E'];
    const storyPoints = parseFloat(ticket['Story Points'] || ticket['I']) || 0;
    
    // Only count completed tickets
    if (status !== 'Done' && status !== 'Closed') continue;
    if (!sprint) continue;
    
    if (!sprintCompletions.has(sprint)) {
      sprintCompletions.set(sprint, 0);
    }
    sprintCompletions.set(sprint, sprintCompletions.get(sprint) + storyPoints);
  }
  
  const velocities = Array.from(sprintCompletions.values());
  if (velocities.length === 0) return 0;
  
  const sum = velocities.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / velocities.length);
}
```

**Complexity:** O(n) where n = number of tickets
**Memoization:** Computed once on mount, cached until filteredData changes


### 3. Assignee Load Calculation

**Purpose:** Compute per-assignee allocation totals and detect overloads

**Algorithm:**
```javascript
function computeAssigneeLoads(allocations, projectsWithBacklog, assigneeCaps) {
  const loads = new Map();
  
  // Initialize all assignees with their capacities
  for (const [assignee, capacity] of Object.entries(assigneeCaps)) {
    loads.set(assignee, {
      capacity,
      allocated: 0,
      overage: 0,
      projects: [],
    });
  }
  
  // Distribute allocations across assignees
  for (const [projectName, allocation] of Object.entries(allocations)) {
    if (allocation === 0) continue;
    
    const project = projectsWithBacklog.find(p => p.name === projectName);
    if (!project || project.assignees.length === 0) continue;
    
    // Split allocation evenly across assignees
    const perAssignee = allocation / project.assignees.length;
    
    for (const assignee of project.assignees) {
      if (!loads.has(assignee)) {
        // Assignee not in capacity list, use default
        loads.set(assignee, {
          capacity: 40, // Default capacity
          allocated: 0,
          overage: 0,
          projects: [],
        });
      }
      
      const load = loads.get(assignee);
      load.allocated += perAssignee;
      load.projects.push({ name: projectName, allocation: perAssignee });
    }
  }
  
  // Calculate overages
  for (const load of loads.values()) {
    load.overage = Math.max(0, load.allocated - load.capacity);
  }
  
  return Object.fromEntries(loads);
}
```

**Complexity:** O(p × a) where p = projects with allocations, a = avg assignees per project
**Memoization:** Recomputed when allocations, projectsWithBacklog, or assigneeCaps change

### 4. Overload Detection

**Purpose:** Identify assignees exceeding their capacity

**Algorithm:**
```javascript
function computeOverloadWarnings(assigneeLoads) {
  const warnings = [];
  
  for (const [assignee, load] of Object.entries(assigneeLoads)) {
    if (load.overage > 0) {
      warnings.push({
        assignee,
        capacity: load.capacity,
        allocated: load.allocated,
        overage: load.overage,
        projects: load.projects.sort((a, b) => b.allocation - a.allocation),
      });
    }
  }
  
  // Sort by overage descending (most overloaded first)
  return warnings.sort((a, b) => b.overage - a.overage);
}
```

**Complexity:** O(a log a) where a = number of assignees
**Memoization:** Recomputed when assigneeLoads change


### 5. Suggestion Engine

**Purpose:** Recommend story point allocations based on priority, backlog, and capacity

**Algorithm:**
```javascript
function computeSuggestions(projectTiers, projectsWithBacklog, sprintConfig) {
  const suggestions = {};
  const { teamCapacity, bufferPercentage } = sprintConfig;
  
  // Calculate available capacity after buffer
  const availableCapacity = teamCapacity * (1 - bufferPercentage / 100);
  let remainingCapacity = availableCapacity;
  
  // Priority order: Must Ship → Important → Ease Off
  const tierOrder = ['mustShip', 'important', 'easeOff'];
  
  for (const tier of tierOrder) {
    const projectNames = projectTiers[tier];
    
    for (const projectName of projectNames) {
      if (remainingCapacity <= 0) {
        suggestions[projectName] = 0;
        continue;
      }
      
      const project = projectsWithBacklog.find(p => p.name === projectName);
      if (!project) {
        suggestions[projectName] = 0;
        continue;
      }
      
      // Suggestion strategy based on tier
      let suggested = 0;
      
      if (tier === 'mustShip') {
        // Allocate full backlog if possible
        suggested = Math.min(project.backlogDepth, remainingCapacity);
      } else if (tier === 'important') {
        // Allocate 60% of backlog or remaining capacity
        suggested = Math.min(
          Math.round(project.backlogDepth * 0.6),
          remainingCapacity
        );
      } else {
        // Ease Off: allocate 30% of backlog or remaining capacity
        suggested = Math.min(
          Math.round(project.backlogDepth * 0.3),
          remainingCapacity
        );
      }
      
      suggestions[projectName] = suggested;
      remainingCapacity -= suggested;
    }
  }
  
  return suggestions;
}
```

**Complexity:** O(p) where p = total number of projects
**Memoization:** Recomputed when projectTiers, projectsWithBacklog, or sprintConfig change

**Strategy Rationale:**
- Must Ship: Full allocation priority (100% of backlog if capacity allows)
- Important: Moderate allocation (60% of backlog)
- Ease Off: Minimal allocation (30% of backlog)
- Respects buffer percentage to reserve capacity for unplanned work
- Greedy algorithm processes tiers in priority order
- Caps suggestions at available backlog depth


### 6. Sprint Defaults Initialization

**Purpose:** Auto-populate sprint configuration on first load

**Algorithm:**
```javascript
function computeSprintDefaults(filteredData, assigneeCaps, sprintDates) {
  // 1. Sprint name: increment most recent sprint number
  const sprintNumbers = Object.keys(sprintDates)
    .map(name => {
      const match = name.match(/(\d+)/);
      return match ? parseInt(match[1]) : 0;
    })
    .filter(n => n > 0);
  
  const nextSprintNumber = sprintNumbers.length > 0 
    ? Math.max(...sprintNumbers) + 1 
    : 1;
  const name = `Sprint ${nextSprintNumber}`;
  
  // 2. Start date: next Monday after today
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysUntilMonday = dayOfWeek === 0 ? 1 : (8 - dayOfWeek);
  const startDate = new Date(today);
  startDate.setDate(today.getDate() + daysUntilMonday);
  
  // 3. End date: 14 days after start
  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 14);
  
  // 4. Team capacity: sum of all assignee capacities
  const teamCapacity = Object.values(assigneeCaps).reduce((sum, cap) => sum + cap, 0);
  
  // 5. Velocity target: same as team capacity (can be adjusted)
  const velocityTarget = teamCapacity;
  
  // 6. Buffer: default 20%
  const bufferPercentage = 20;
  
  return {
    name,
    startDate,
    endDate,
    teamCapacity,
    velocityTarget,
    bufferPercentage,
  };
}
```

**Complexity:** O(s + a) where s = number of sprints, a = number of assignees
**Execution:** Once on component mount

### 7. localStorage Persistence

**Purpose:** Save and restore plan state across sessions

**Save Algorithm:**
```javascript
function saveToLocalStorage(sprintConfig, projectTiers, allocations) {
  const planState = {
    version: 1,
    sprintName: sprintConfig.name,
    timestamp: new Date().toISOString(),
    sprintConfig: {
      ...sprintConfig,
      startDate: sprintConfig.startDate.toISOString(),
      endDate: sprintConfig.endDate.toISOString(),
    },
    projectTiers,
    allocations,
  };
  
  const key = `sprint-plan-${sprintConfig.name}`;
  try {
    localStorage.setItem(key, JSON.stringify(planState));
  } catch (error) {
    console.error('Failed to save plan to localStorage:', error);
  }
}
```

**Restore Algorithm:**
```javascript
function restoreFromLocalStorage(sprintName) {
  const key = `sprint-plan-${sprintName}`;
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return null;
    
    const planState = JSON.parse(saved);
    
    // Validate version
    if (planState.version !== 1) {
      console.warn('Incompatible plan version, ignoring saved state');
      return null;
    }
    
    // Parse dates
    planState.sprintConfig.startDate = new Date(planState.sprintConfig.startDate);
    planState.sprintConfig.endDate = new Date(planState.sprintConfig.endDate);
    
    return planState;
  } catch (error) {
    console.error('Failed to restore plan from localStorage:', error);
    return null;
  }
}
```

**Debouncing:** Saves are debounced to 500ms to avoid excessive writes during rapid slider adjustments


### 8. Excel Export

**Purpose:** Generate downloadable Excel file with sprint plan

**Algorithm:**
```javascript
import * as XLSX from 'xlsx';

function exportToExcel(sprintConfig, projectTiers, allocations, projectsWithBacklog, overloadWarnings) {
  const workbook = XLSX.utils.book_new();
  
  // Sheet 1: Configuration
  const configData = [
    ['Sprint Configuration'],
    ['Sprint Name', sprintConfig.name],
    ['Start Date', sprintConfig.startDate.toLocaleDateString()],
    ['End Date', sprintConfig.endDate.toLocaleDateString()],
    ['Team Capacity', `${sprintConfig.teamCapacity} SP`],
    ['Velocity Target', `${sprintConfig.velocityTarget} SP`],
    ['Buffer Percentage', `${sprintConfig.bufferPercentage}%`],
  ];
  const configSheet = XLSX.utils.aoa_to_sheet(configData);
  XLSX.utils.book_append_sheet(workbook, configSheet, 'Configuration');
  
  // Sheet 2: Allocations
  const allocationData = [
    ['Project Name', 'Priority Tier', 'Backlog Depth', 'Allocated SP', 'Assignees'],
  ];
  
  const tierLabels = {
    mustShip: 'Must Ship',
    important: 'Important',
    easeOff: 'Ease Off',
  };
  
  for (const [tier, projectNames] of Object.entries(projectTiers)) {
    for (const projectName of projectNames) {
      const project = projectsWithBacklog.find(p => p.name === projectName);
      const allocation = allocations[projectName] || 0;
      
      allocationData.push([
        projectName,
        tierLabels[tier],
        project?.backlogDepth || 0,
        allocation,
        project?.assignees.join(', ') || '',
      ]);
    }
  }
  
  const allocationSheet = XLSX.utils.aoa_to_sheet(allocationData);
  XLSX.utils.book_append_sheet(workbook, allocationSheet, 'Allocations');
  
  // Sheet 3: Summary
  const totalAllocated = Object.values(allocations).reduce((sum, v) => sum + v, 0);
  const unallocated = sprintConfig.teamCapacity - totalAllocated;
  const utilization = ((totalAllocated / sprintConfig.teamCapacity) * 100).toFixed(1);
  
  const summaryData = [
    ['Sprint Summary'],
    ['Total Allocated', `${totalAllocated} SP`],
    ['Unallocated', `${unallocated} SP`],
    ['Team Capacity', `${sprintConfig.teamCapacity} SP`],
    ['Utilization', `${utilization}%`],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');
  
  // Sheet 4: Warnings (if any)
  if (overloadWarnings.length > 0) {
    const warningData = [
      ['Assignee', 'Capacity', 'Allocated', 'Overage', 'Contributing Projects'],
    ];
    
    for (const warning of overloadWarnings) {
      const projects = warning.projects.map(p => `${p.name} (${p.allocation.toFixed(1)})`).join(', ');
      warningData.push([
        warning.assignee,
        warning.capacity,
        warning.allocated.toFixed(1),
        warning.overage.toFixed(1),
        projects,
      ]);
    }
    
    const warningSheet = XLSX.utils.aoa_to_sheet(warningData);
    XLSX.utils.book_append_sheet(workbook, warningSheet, 'Warnings');
  }
  
  // Generate and download
  const filename = `sprint-plan-${sprintConfig.name.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.xlsx`;
  XLSX.writeFile(workbook, filename);
}
```

**Complexity:** O(p) where p = number of projects
**Performance Target:** < 2 seconds for 2,162 tickets


### 9. Jira Comment Export

**Purpose:** Generate Jira-formatted markdown for clipboard

**Algorithm:**
```javascript
function exportToJiraComment(sprintConfig, projectTiers, allocations, projectsWithBacklog, overloadWarnings) {
  const lines = [];
  
  // Header
  lines.push(`h2. ${sprintConfig.name} Plan (${sprintConfig.startDate.toLocaleDateString()} - ${sprintConfig.endDate.toLocaleDateString()})`);
  lines.push('');
  lines.push(`*Team Capacity:* ${sprintConfig.teamCapacity} SP | *Velocity Target:* ${sprintConfig.velocityTarget} SP | *Buffer:* ${sprintConfig.bufferPercentage}%`);
  lines.push('');
  
  // Tiers
  const tierLabels = {
    mustShip: 'Must Ship',
    important: 'Important',
    easeOff: 'Ease Off',
  };
  
  for (const [tier, label] of Object.entries(tierLabels)) {
    const projectNames = projectTiers[tier];
    if (projectNames.length === 0) continue;
    
    const tierTotal = projectNames.reduce((sum, name) => sum + (allocations[name] || 0), 0);
    lines.push(`h3. ${label} (${tierTotal} SP)`);
    
    for (const projectName of projectNames) {
      const project = projectsWithBacklog.find(p => p.name === projectName);
      const allocation = allocations[projectName] || 0;
      const assignees = project?.assignees.join(', ') || 'Unassigned';
      
      lines.push(`* ${projectName} - ${allocation} SP (Assignees: ${assignees})`);
    }
    lines.push('');
  }
  
  // Summary
  const totalAllocated = Object.values(allocations).reduce((sum, v) => sum + v, 0);
  const unallocated = sprintConfig.teamCapacity - totalAllocated;
  const utilization = ((totalAllocated / sprintConfig.teamCapacity) * 100).toFixed(1);
  
  lines.push('---');
  lines.push(`*Summary:* ${totalAllocated} SP allocated | ${unallocated} SP unallocated | ${utilization}% utilization`);
  lines.push('');
  
  // Warnings
  if (overloadWarnings.length > 0) {
    lines.push('{warning}');
    lines.push('*Overload Warnings:*');
    for (const warning of overloadWarnings) {
      const projects = warning.projects.map(p => `${p.name} (${p.allocation.toFixed(1)})`).join(', ');
      lines.push(`* ${warning.assignee}: ${warning.allocated.toFixed(1)}/${warning.capacity} SP (+${warning.overage.toFixed(1)} overage) - ${projects}`);
    }
    lines.push('{warning}');
  }
  
  return lines.join('\n');
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return { success: true };
  } catch (error) {
    console.error('Clipboard write failed:', error);
    return { success: false, error };
  }
}
```

**Complexity:** O(p) where p = number of projects
**Performance Target:** < 100ms


## Integration with Existing Dashboard

### 1. Tab Registration

**Location:** `src/SprintDashboard.jsx`

**Modification:**
```javascript
const tabs = {
  overview: { icon: LayoutDashboard, label: 'Overview' },
  assignees: { icon: Users, label: 'Assignees' },
  risks: { icon: Shield, label: 'Risk Register' },
  capacity: { icon: Users, label: 'Capacity' },
  sprintPlanner: { icon: Calendar, label: 'Sprint Planner' }, // NEW
  sprints: { icon: Target, label: 'Sprints' },
  projects: { icon: Briefcase, label: 'Projects' },
  themeAnalysis: { icon: PieChart, label: 'Theme Analysis' },
  timeline: { icon: BarChart3, label: 'Timeline' },
  data: { icon: Database, label: 'Raw Data' },
};
```

**Tab Rendering:**
```javascript
{activeTab === 'sprintPlanner' && (
  <SprintPlanner
    filteredData={filteredData}
    assigneeCaps={assigneeCaps}
    sprintDates={sprintDates}
    stats={stats}
  />
)}
```

### 2. Data Dependencies

**From SprintDashboard:**
- `filteredData`: Array of tickets (already filtered by sprint/assignee/project)
- `assigneeCaps`: Object mapping assignee names to capacity values
- `sprintDates`: Object mapping sprint names to { start, end } dates
- `stats`: Computed statistics including historical velocity

**Data Flow:**
```
SprintDashboard state
    ↓
filteredData (useMemo)
    ↓
SprintPlanner component
    ↓
useSprintPlanner hook
    ↓
Memoized calculations
    ↓
Child components
```

### 3. Shared Utilities

**Project Color Mapping:**
```javascript
// Use existing getProjectColor function from SprintDashboard
// This ensures consistent colors across all tabs
const getProjectColor = (project) => {
  const colors = {
    'Project Alpha': '#3b82f6',
    'Project Beta': '#10b981',
    'Project Gamma': '#f59e0b',
    // ... existing color mappings
  };
  return colors[project] || '#6b7280';
};
```

**Status Filtering:**
```javascript
// Reuse existing status constants
const TODO_STATUSES = ['To Do', 'Backlog', 'Open'];
const DONE_STATUSES = ['Done', 'Closed', 'Resolved'];
```

### 4. Theme Consistency

**Dark Theme Tokens:**
```javascript
// Match existing dashboard theme
const theme = {
  background: '#13151f',      // Main background
  card: '#1a1d2e',            // Card background
  cardHover: '#22253a',       // Card hover state
  border: '#2d3148',          // Border color
  text: {
    primary: '#e2e8f0',       // Primary text
    secondary: '#94a3b8',     // Secondary text
    muted: '#64748b',         // Muted text
  },
  accent: {
    blue: '#3b82f6',          // Primary actions
    green: '#10b981',         // Success states
    yellow: '#f59e0b',        // Warnings
    red: '#ef4444',           // Errors/overloads
  },
};
```

**Tailwind Classes:**
- Background: `bg-[#13151f]`
- Cards: `bg-[#1a1d2e]`
- Borders: `border-slate-700`
- Text: `text-slate-200`, `text-slate-400`
- Hover: `hover:bg-slate-800/30`


### 5. Performance Optimization Integration

**Memoization Strategy:**
```javascript
// In SprintDashboard, filteredData is already memoized
const filteredData = useMemo(() => {
  return data.filter(item => {
    // ... existing filter logic
  });
}, [data, selectedSprint, selectedAssignee, selectedProject]);

// SprintPlanner receives this memoized value
// Internal calculations are further memoized in useSprintPlanner
```

**Lazy Loading:**
```javascript
// Only compute Sprint Planner data when tab is active
{activeTab === 'sprintPlanner' && (
  <SprintPlanner {...props} />
)}
```

### 6. State Isolation

The Sprint Planner maintains its own state and does not modify parent SprintDashboard state:

**Read-Only Props:**
- `filteredData` - read only, not modified
- `assigneeCaps` - read only, not modified
- `sprintDates` - read only, not modified

**Internal State:**
- `sprintConfig` - managed by useSprintPlanner
- `projectTiers` - managed by useSprintPlanner
- `allocations` - managed by useSprintPlanner

This ensures the Sprint Planner is a self-contained feature that doesn't create side effects in other tabs.

## Performance Optimization Strategies

### 1. Memoization Hierarchy

**Level 1: Raw Data Processing (computed once)**
```javascript
const projectsWithBacklog = useMemo(() => 
  computeProjectBacklogs(filteredData), 
  [filteredData]
);

const historicalVelocity = useMemo(() => 
  computeHistoricalVelocity(filteredData), 
  [filteredData]
);
```

**Level 2: Configuration-Dependent (recomputed on config change)**
```javascript
const suggestions = useMemo(() => 
  computeSuggestions(projectTiers, projectsWithBacklog, sprintConfig),
  [projectTiers, projectsWithBacklog, sprintConfig]
);
```

**Level 3: Allocation-Dependent (recomputed on allocation change)**
```javascript
const assigneeLoads = useMemo(() => 
  computeAssigneeLoads(allocations, projectsWithBacklog, assigneeCaps),
  [allocations, projectsWithBacklog, assigneeCaps]
);

const overloadWarnings = useMemo(() => 
  computeOverloadWarnings(assigneeLoads),
  [assigneeLoads]
);
```

### 2. Component Memoization

**Prevent Unnecessary Re-renders:**
```javascript
const ProjectCard = React.memo(({ project, allocation, onAllocationChange, ... }) => {
  // Component implementation
}, (prevProps, nextProps) => {
  // Custom comparison for optimization
  return prevProps.allocation === nextProps.allocation &&
         prevProps.project.name === nextProps.project.name;
});
```

### 3. Debouncing

**localStorage Saves:**
```javascript
const debouncedSave = useMemo(() => 
  debounce((state) => saveToLocalStorage(state), 500),
  []
);

useEffect(() => {
  debouncedSave({ sprintConfig, projectTiers, allocations });
}, [sprintConfig, projectTiers, allocations, debouncedSave]);
```

**Slider Updates:**
```javascript
// Use controlled input with immediate visual feedback
// Debounce only the expensive calculations, not the UI update
const handleSliderChange = (value) => {
  setLocalValue(value); // Immediate UI update
  debouncedUpdateAllocation(projectName, value); // Debounced calculation
};
```


### 4. Efficient Data Structures

**Use Maps for O(1) Lookups:**
```javascript
// Instead of array.find() in loops
const projectMap = new Map(projectsWithBacklog.map(p => [p.name, p]));

// O(1) lookup instead of O(n)
const project = projectMap.get(projectName);
```

**Avoid Nested Loops:**
```javascript
// Bad: O(n²)
for (const project of projects) {
  for (const ticket of tickets) {
    if (ticket.project === project.name) { /* ... */ }
  }
}

// Good: O(n)
const ticketsByProject = new Map();
for (const ticket of tickets) {
  if (!ticketsByProject.has(ticket.project)) {
    ticketsByProject.set(ticket.project, []);
  }
  ticketsByProject.get(ticket.project).push(ticket);
}
```

### 5. Virtual Scrolling (if needed)

If the number of projects exceeds 50, implement virtual scrolling:

```javascript
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={600}
  itemCount={projects.length}
  itemSize={120}
  width="100%"
>
  {({ index, style }) => (
    <div style={style}>
      <ProjectCard project={projects[index]} {...props} />
    </div>
  )}
</FixedSizeList>
```

### 6. Performance Monitoring

**Add Performance Markers:**
```javascript
function computeProjectBacklogs(filteredData) {
  performance.mark('backlog-calc-start');
  
  // ... calculation logic
  
  performance.mark('backlog-calc-end');
  performance.measure('backlog-calculation', 'backlog-calc-start', 'backlog-calc-end');
  
  const measure = performance.getEntriesByName('backlog-calculation')[0];
  if (measure.duration > 100) {
    console.warn(`Backlog calculation took ${measure.duration}ms`);
  }
  
  return result;
}
```

**Performance Targets:**
- Initial load: < 3 seconds (2,162 tickets)
- Slider adjustment: < 100ms
- Suggestion calculation: < 500ms
- Excel export: < 2 seconds
- Jira export: < 100ms
- localStorage save: < 50ms


## Correctness Properties

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### Property Reflection

After analyzing all acceptance criteria, I identified the following redundancies and consolidations:

**Redundant Properties:**
- 4.3 and 4.6 both test overload detection (one for presence, one for absence) - can be combined into single bidirectional property
- 5.2 and 5.3 both test priority ordering - can be combined into single property about complete tier ordering
- 6.2, 6.3, 6.4, 6.5 all test Excel export structure - can be combined into comprehensive export completeness property
- 7.3, 7.4, 7.5, 7.6 all test Jira export structure - can be combined into comprehensive export completeness property
- 8.1, 8.2, 8.3 all test persistence triggers - can be combined into single property about state changes triggering saves
- 12.2, 12.3, 12.4, 12.5 all test data extraction - can be combined into comprehensive data integration property

**Consolidated Properties:**
After reflection, the following properties provide unique validation value without redundancy:


### Property 1: Sprint Name Auto-Increment

For any set of historical sprint data with sprint numbers, the default sprint name should be the maximum sprint number plus one.

**Validates: Requirements 1.1**

### Property 2: Next Monday Calculation

For any date, the calculated "next Monday" should be a Monday that occurs after the given date, and should be the closest Monday to that date.

**Validates: Requirements 1.2**

### Property 3: Sprint Duration Calculation

For any start date, the end date should be exactly 14 days after the start date.

**Validates: Requirements 1.3**

### Property 4: Team Capacity Summation

For any map of assignee capacities, the team capacity should equal the sum of all individual assignee capacities.

**Validates: Requirements 1.4**

### Property 5: Date Range Validation

For any pair of dates where end date is before or equal to start date, the validation should fail and exports should be disabled.

**Validates: Requirements 1.7, 11.2**

### Property 6: Configuration Change Performance

For any sprint configuration change, all dependent calculations should complete within 100ms.

**Validates: Requirements 1.10**

### Property 7: Default Tier Assignment

For any set of projects loaded from raw data, all projects should initially be assigned to the "Ease Off" tier.

**Validates: Requirements 2.2**

### Property 8: Tier Update Performance

For any project moved to a different tier, the tier assignment should be updated within 50ms.

**Validates: Requirements 2.4**

### Property 9: Tier Partitioning Invariant

For any plan state, each project should belong to exactly one tier, and the union of all tiers should equal the complete set of projects.

**Validates: Requirements from Property 3 in requirements.md**

### Property 10: Allocation Bounds

For any project with an allocation, the allocation should be greater than or equal to 0 and less than or equal to the project's backlog depth.

**Validates: Requirements 3.2, Property 2 in requirements.md**

### Property 11: Allocation Update Performance

For any allocation slider adjustment, the allocation value should be updated within 50ms.

**Validates: Requirements 3.3**

### Property 12: Total Allocation Summation

For any set of project allocations, the total allocated story points should equal the sum of all individual project allocations.

**Validates: Requirements 3.5, Property 1 in requirements.md**

### Property 13: Unallocated Capacity Calculation

For any team capacity and total allocated story points, the unallocated capacity should equal team capacity minus total allocated.

**Validates: Requirements 3.6, Property 1 in requirements.md**

### Property 14: Assignee Load Recalculation Performance

For any allocation change, per-assignee load totals should be recalculated within 100ms.

**Validates: Requirements 4.1**

### Property 15: Assignee Extraction

For any set of tickets belonging to a project, the project's assignees should be the unique set of all assignees from those tickets.

**Validates: Requirements 4.2**

### Property 16: Overload Detection Consistency

For any assignee, an overload warning should exist if and only if their allocated story points exceed their capacity.

**Validates: Requirements 4.3, 4.6, Property 4 in requirements.md**

### Property 17: Suggestion Priority Ordering

For any two projects where project A is in a higher priority tier than project B, if both have sufficient backlog, project A's suggestion should be computed before project B's in the allocation algorithm.

**Validates: Requirements 5.2, 5.3, Property 5 in requirements.md**

### Property 18: Buffer Capacity Reduction

For any buffer percentage and team capacity, the available capacity for suggestions should equal team capacity multiplied by (1 - buffer percentage / 100).

**Validates: Requirements 5.4**

### Property 19: Suggestion Backlog Cap

For any project, the suggested allocation should be less than or equal to the project's backlog depth.

**Validates: Requirements 5.5**

### Property 20: Accept Suggestion Idempotence

For any project, clicking "Accept Suggestion" should set the allocation to the suggested value, and clicking again without changing other parameters should maintain that value.

**Validates: Requirements 5.7, Property 8 in requirements.md**

### Property 21: Accept All Suggestions

For any set of projects with suggestions, accepting all suggestions should set every project's allocation to its suggested value.

**Validates: Requirements 5.9**

### Property 22: Suggestion Engine Performance

For any dataset with up to 2,162 tickets, the suggestion engine should complete all calculations within 500ms.

**Validates: Requirements 5.10, Property 10 in requirements.md**

### Property 23: Excel Export Completeness

For any plan state, the Excel export should contain all sprint configuration parameters, all project allocations with their tier/backlog/assignees, summary totals, and all overload warnings.

**Validates: Requirements 6.2, 6.3, 6.4, 6.5, Property 7 in requirements.md**

### Property 24: Excel Filename Format

For any sprint name and export date, the Excel filename should match the pattern "sprint-plan-{sprint-name}-{date}.xlsx".

**Validates: Requirements 6.6**

### Property 25: Excel Export Performance

For any dataset with up to 2,162 tickets, Excel generation and download should complete within 2 seconds.

**Validates: Requirements 6.7, Property 10 in requirements.md**

### Property 26: Jira Comment Format Completeness

For any plan state, the Jira comment should contain all sprint configuration parameters, projects grouped by tier with allocations, summary totals, and all overload warnings (if any exist).

**Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6, Property 7 in requirements.md**

### Property 27: Clipboard Copy Success

For any generated Jira comment, the clipboard should contain the exact formatted text after a successful copy operation.

**Validates: Requirements 7.7**

### Property 28: Clipboard Error Handling

For any clipboard operation failure, the system should display an error message and provide the text in an alternative format.

**Validates: Requirements 7.9, Property 11 in requirements.md**

### Property 29: Plan Persistence Round-Trip

For any valid plan state, saving to localStorage and then restoring should produce an equivalent plan state with matching sprint configuration, tier assignments, and allocations.

**Validates: Requirements 8.4, 8.5, Property 6 in requirements.md**

### Property 30: State Change Persistence

For any change to sprint configuration, tier assignments, or allocations, the complete plan state should be saved to localStorage within 500ms.

**Validates: Requirements 8.1, 8.2, 8.3**

### Property 31: Clear Plan Reset

For any saved plan, clicking "Clear Plan" should remove the plan from localStorage and reset all state to default values.

**Validates: Requirements 8.7**

### Property 32: Storage Key Format

For any sprint name, the localStorage key should include the sprint name to support multiple saved plans.

**Validates: Requirements 8.8**

### Property 33: Initial Load Performance

For any dataset with 2,162 tickets, initial load and render should complete within 3 seconds.

**Validates: Requirements 9.4, Property 10 in requirements.md**

### Property 34: Slider Update Performance

For any allocation slider adjustment, all dependent UI elements should update within 100ms.

**Validates: Requirements 9.5, Property 10 in requirements.md**

### Property 35: Empty Sprint Name Validation

For any plan state with an empty sprint name, validation should fail and export functions should be disabled.

**Validates: Requirements 11.1, Property 11 in requirements.md**

### Property 36: Velocity Target Bounds

For any velocity target value, if set to a negative number, it should be reset to zero.

**Validates: Requirements 11.3, Property 11 in requirements.md**

### Property 37: Buffer Percentage Bounds

For any buffer percentage value, it should be clamped to the range [0, 100].

**Validates: Requirements 11.4, 11.5, Property 11 in requirements.md**

### Property 38: Numeric Input Validation

For any numeric input field, only valid number characters should be accepted.

**Validates: Requirements 11.7, Property 11 in requirements.md**

### Property 39: Corrupted Data Recovery

For any corrupted localStorage data, the restore operation should fail gracefully and initialize with default values.

**Validates: Requirements 11.8, Property 11 in requirements.md**

### Property 40: Data Integration Completeness

For any raw dashboard data, the Sprint Planner should correctly extract team capacity from assignee capacities, historical velocity from completed sprints, backlog depth from "To Do" tickets, and assignee information from ticket assignments.

**Validates: Requirements 12.2, 12.3, 12.4, 12.5**

### Property 41: Project Color Consistency

For any project, the color used in Sprint Planner should match the color from the existing dashboard theme.

**Validates: Requirements 12.6**

### Property 42: Unmount Persistence

For any plan state, navigating away from the Sprint Planner tab should trigger a save of the current state.

**Validates: Requirements 12.8**


## Error Handling

### 1. Data Validation Errors

**Invalid Sprint Configuration:**
```javascript
function validateSprintConfig(config) {
  const errors = [];
  
  if (!config.name || config.name.trim() === '') {
    errors.push('Sprint name is required');
  }
  
  if (config.endDate <= config.startDate) {
    errors.push('End date must be after start date');
  }
  
  if (config.velocityTarget < 0) {
    errors.push('Velocity target cannot be negative');
  }
  
  if (config.bufferPercentage < 0 || config.bufferPercentage > 100) {
    errors.push('Buffer percentage must be between 0 and 100');
  }
  
  return errors;
}
```

**User Feedback:**
- Display validation errors inline near the invalid field
- Disable export buttons when validation fails
- Use red border and error icon for visual feedback
- Provide ARIA live region announcements for screen readers

### 2. localStorage Errors

**Save Failures:**
```javascript
function handleSaveError(error) {
  console.error('Failed to save plan to localStorage:', error);
  
  // Check if quota exceeded
  if (error.name === 'QuotaExceededError') {
    showNotification('Storage quota exceeded. Please clear old plans.', 'error');
  } else {
    showNotification('Failed to save plan. Changes may be lost.', 'warning');
  }
}
```

**Restore Failures:**
```javascript
function handleRestoreError(error) {
  console.error('Failed to restore plan from localStorage:', error);
  
  // Log error but don't show to user - just use defaults
  console.warn('Initializing with default values');
  return getDefaultPlanState();
}
```

**Corrupted Data:**
```javascript
function restoreFromLocalStorage(sprintName) {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) return null;
    
    const planState = JSON.parse(saved);
    
    // Validate structure
    if (!planState.version || !planState.sprintConfig || !planState.projectTiers) {
      throw new Error('Invalid plan structure');
    }
    
    // Validate version compatibility
    if (planState.version !== CURRENT_VERSION) {
      console.warn(`Incompatible version ${planState.version}, expected ${CURRENT_VERSION}`);
      return null;
    }
    
    return planState;
  } catch (error) {
    console.error('Corrupted localStorage data:', error);
    return null;
  }
}
```

### 3. Export Errors

**Excel Export Failures:**
```javascript
async function exportToExcel(...args) {
  try {
    const workbook = generateWorkbook(...args);
    XLSX.writeFile(workbook, filename);
    showNotification('Excel file downloaded successfully', 'success');
  } catch (error) {
    console.error('Excel export failed:', error);
    showNotification('Failed to generate Excel file. Please try again.', 'error');
  }
}
```

**Clipboard Failures:**
```javascript
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showNotification('Copied to clipboard', 'success');
    return { success: true };
  } catch (error) {
    console.error('Clipboard write failed:', error);
    
    // Fallback: show text in modal for manual copy
    showCopyModal(text);
    showNotification('Clipboard access denied. Please copy manually.', 'warning');
    return { success: false, error };
  }
}
```

### 4. Performance Degradation

**Slow Calculations:**
```javascript
function computeWithTimeout(fn, timeoutMs, fallback) {
  const start = performance.now();
  const result = fn();
  const duration = performance.now() - start;
  
  if (duration > timeoutMs) {
    console.warn(`Calculation took ${duration}ms, expected < ${timeoutMs}ms`);
    // Log for monitoring but don't block user
  }
  
  return result;
}
```

**Large Datasets:**
```javascript
function handleLargeDataset(data) {
  if (data.length > 5000) {
    console.warn(`Large dataset detected: ${data.length} tickets`);
    showNotification('Large dataset may cause slower performance', 'info');
  }
  
  // Continue processing - memoization should handle it
  return processData(data);
}
```

### 5. Missing Data

**No Assignee Capacities:**
```javascript
function getAssigneeCapacity(assignee, assigneeCaps) {
  if (!assigneeCaps[assignee]) {
    console.warn(`No capacity defined for ${assignee}, using default`);
    return DEFAULT_CAPACITY; // e.g., 40 SP
  }
  return assigneeCaps[assignee];
}
```

**No Historical Data:**
```javascript
function computeHistoricalVelocity(filteredData) {
  const velocities = extractVelocities(filteredData);
  
  if (velocities.length === 0) {
    console.warn('No historical velocity data available');
    return DEFAULT_VELOCITY; // e.g., 80 SP
  }
  
  return calculateAverage(velocities);
}
```

### 6. User Input Errors

**Invalid Numeric Input:**
```javascript
function handleNumericInput(value, min, max) {
  const parsed = parseFloat(value);
  
  if (isNaN(parsed)) {
    return min; // Reset to minimum valid value
  }
  
  return Math.max(min, Math.min(max, parsed));
}
```

**Allocation Exceeds Backlog:**
```javascript
function validateAllocation(projectName, value, backlogDepth) {
  if (value > backlogDepth) {
    showWarning(`Allocation (${value}) exceeds backlog (${backlogDepth}) for ${projectName}`);
    // Allow but warn - user may have good reason
  }
  return value;
}
```


## Testing Strategy

### Dual Testing Approach

The Sprint Planner will use both unit tests and property-based tests to ensure comprehensive coverage:

**Unit Tests:**
- Specific examples demonstrating correct behavior
- Edge cases (empty data, single project, zero capacity)
- Error conditions (invalid dates, corrupted localStorage)
- Integration points with parent dashboard
- UI interactions (drag-and-drop, slider adjustments)

**Property-Based Tests:**
- Universal properties that hold for all inputs
- Comprehensive input coverage through randomization
- Invariants that must always be true
- Round-trip properties (save/restore, serialize/deserialize)
- Performance bounds verification

### Property-Based Testing Configuration

**Library:** fast-check (JavaScript property-based testing library)

**Installation:**
```bash
npm install --save-dev fast-check
```

**Configuration:**
- Minimum 100 iterations per property test
- Each test tagged with reference to design property
- Tag format: `Feature: sprint-planner, Property {number}: {property_text}`

**Example Property Test:**
```javascript
import fc from 'fast-check';

describe('Sprint Planner Properties', () => {
  test('Property 12: Total Allocation Summation', () => {
    // Feature: sprint-planner, Property 12: Total allocated equals sum of individual allocations
    
    fc.assert(
      fc.property(
        fc.dictionary(fc.string(), fc.nat(100)), // Random allocations
        (allocations) => {
          const total = computeTotalAllocated(allocations);
          const expected = Object.values(allocations).reduce((sum, v) => sum + v, 0);
          expect(total).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });
});
```

### Unit Test Examples

**Sprint Name Auto-Increment:**
```javascript
describe('computeSprintDefaults', () => {
  test('should increment highest sprint number', () => {
    const sprintDates = {
      'Sprint 21': { start: '01/01/2025', end: '01/15/2025' },
      'Sprint 22': { start: '01/16/2025', end: '01/30/2025' },
      'Sprint 23': { start: '01/31/2025', end: '02/14/2025' },
    };
    
    const defaults = computeSprintDefaults([], {}, sprintDates);
    expect(defaults.name).toBe('Sprint 24');
  });
  
  test('should handle non-sequential sprint numbers', () => {
    const sprintDates = {
      'Sprint 20': { start: '01/01/2025', end: '01/15/2025' },
      'Sprint 25': { start: '01/16/2025', end: '01/30/2025' },
      'Sprint 22': { start: '01/31/2025', end: '02/14/2025' },
    };
    
    const defaults = computeSprintDefaults([], {}, sprintDates);
    expect(defaults.name).toBe('Sprint 26'); // Max + 1
  });
  
  test('should default to Sprint 1 when no history', () => {
    const defaults = computeSprintDefaults([], {}, {});
    expect(defaults.name).toBe('Sprint 1');
  });
});
```

**Overload Detection:**
```javascript
describe('computeOverloadWarnings', () => {
  test('should detect overloaded assignee', () => {
    const assigneeLoads = {
      'Alice': { capacity: 40, allocated: 48, overage: 8, projects: [] },
      'Bob': { capacity: 40, allocated: 35, overage: 0, projects: [] },
    };
    
    const warnings = computeOverloadWarnings(assigneeLoads);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].assignee).toBe('Alice');
    expect(warnings[0].overage).toBe(8);
  });
  
  test('should return empty array when no overloads', () => {
    const assigneeLoads = {
      'Alice': { capacity: 40, allocated: 35, overage: 0, projects: [] },
      'Bob': { capacity: 40, allocated: 30, overage: 0, projects: [] },
    };
    
    const warnings = computeOverloadWarnings(assigneeLoads);
    expect(warnings).toHaveLength(0);
  });
});
```

**localStorage Round-Trip:**
```javascript
describe('localStorage persistence', () => {
  test('should save and restore plan state', () => {
    const originalState = {
      sprintConfig: {
        name: 'Sprint 24',
        startDate: new Date('2025-01-13'),
        endDate: new Date('2025-01-27'),
        teamCapacity: 120,
        velocityTarget: 100,
        bufferPercentage: 20,
      },
      projectTiers: {
        mustShip: ['Project Alpha', 'Project Beta'],
        important: ['Project Gamma'],
        easeOff: ['Project Delta'],
      },
      allocations: {
        'Project Alpha': 20,
        'Project Beta': 35,
        'Project Gamma': 15,
        'Project Delta': 25,
      },
    };
    
    saveToLocalStorage(originalState.sprintConfig, originalState.projectTiers, originalState.allocations);
    const restored = restoreFromLocalStorage('Sprint 24');
    
    expect(restored.sprintConfig.name).toBe(originalState.sprintConfig.name);
    expect(restored.sprintConfig.teamCapacity).toBe(originalState.sprintConfig.teamCapacity);
    expect(restored.projectTiers).toEqual(originalState.projectTiers);
    expect(restored.allocations).toEqual(originalState.allocations);
  });
  
  test('should handle corrupted data gracefully', () => {
    localStorage.setItem('sprint-plan-Test', 'invalid json{');
    const restored = restoreFromLocalStorage('Test');
    expect(restored).toBeNull();
  });
});
```


### Property-Based Test Examples

**Property 2: Next Monday Calculation**
```javascript
test('Property 2: Next Monday Calculation', () => {
  // Feature: sprint-planner, Property 2: Next Monday is always a Monday after the given date
  
  fc.assert(
    fc.property(
      fc.date(), // Random date
      (date) => {
        const nextMonday = calculateNextMonday(date);
        
        // Should be a Monday (day 1)
        expect(nextMonday.getDay()).toBe(1);
        
        // Should be after the input date
        expect(nextMonday.getTime()).toBeGreaterThan(date.getTime());
        
        // Should be within 7 days
        const daysDiff = (nextMonday.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
        expect(daysDiff).toBeLessThanOrEqual(7);
      }
    ),
    { numRuns: 100 }
  );
});
```

**Property 9: Tier Partitioning Invariant**
```javascript
test('Property 9: Tier Partitioning Invariant', () => {
  // Feature: sprint-planner, Property 9: Each project in exactly one tier
  
  fc.assert(
    fc.property(
      fc.array(fc.string()), // Random project names
      (projects) => {
        const projectTiers = initializeProjectTiers(projects);
        
        // Count occurrences of each project across all tiers
        const allProjects = [
          ...projectTiers.mustShip,
          ...projectTiers.important,
          ...projectTiers.easeOff,
        ];
        
        // Each project should appear exactly once
        const projectCounts = new Map();
        for (const project of allProjects) {
          projectCounts.set(project, (projectCounts.get(project) || 0) + 1);
        }
        
        for (const [project, count] of projectCounts) {
          expect(count).toBe(1);
        }
        
        // Union should equal original set
        expect(new Set(allProjects).size).toBe(new Set(projects).size);
      }
    ),
    { numRuns: 100 }
  );
});
```

**Property 10: Allocation Bounds**
```javascript
test('Property 10: Allocation Bounds', () => {
  // Feature: sprint-planner, Property 10: Allocation within [0, backlogDepth]
  
  fc.assert(
    fc.property(
      fc.record({
        projectName: fc.string(),
        backlogDepth: fc.nat(200),
        requestedAllocation: fc.integer(-50, 250), // Include invalid values
      }),
      ({ projectName, backlogDepth, requestedAllocation }) => {
        const allocation = setAllocation(projectName, requestedAllocation, backlogDepth);
        
        expect(allocation).toBeGreaterThanOrEqual(0);
        expect(allocation).toBeLessThanOrEqual(backlogDepth);
      }
    ),
    { numRuns: 100 }
  );
});
```

**Property 16: Overload Detection Consistency**
```javascript
test('Property 16: Overload Detection Consistency', () => {
  // Feature: sprint-planner, Property 16: Warning exists iff allocated > capacity
  
  fc.assert(
    fc.property(
      fc.dictionary(
        fc.string(), // Assignee name
        fc.record({
          capacity: fc.nat(100),
          allocated: fc.nat(150),
        })
      ),
      (assigneeLoads) => {
        const warnings = computeOverloadWarnings(assigneeLoads);
        const warningAssignees = new Set(warnings.map(w => w.assignee));
        
        for (const [assignee, load] of Object.entries(assigneeLoads)) {
          const isOverloaded = load.allocated > load.capacity;
          const hasWarning = warningAssignees.has(assignee);
          
          // Warning should exist if and only if overloaded
          expect(hasWarning).toBe(isOverloaded);
        }
      }
    ),
    { numRuns: 100 }
  );
});
```

**Property 19: Suggestion Backlog Cap**
```javascript
test('Property 19: Suggestion Backlog Cap', () => {
  // Feature: sprint-planner, Property 19: Suggestion <= backlog depth
  
  fc.assert(
    fc.property(
      fc.record({
        projectTiers: fc.record({
          mustShip: fc.array(fc.string()),
          important: fc.array(fc.string()),
          easeOff: fc.array(fc.string()),
        }),
        projectsWithBacklog: fc.array(fc.record({
          name: fc.string(),
          backlogDepth: fc.nat(200),
          assignees: fc.array(fc.string()),
        })),
        sprintConfig: fc.record({
          teamCapacity: fc.nat(500),
          bufferPercentage: fc.nat(100),
        }),
      }),
      ({ projectTiers, projectsWithBacklog, sprintConfig }) => {
        const suggestions = computeSuggestions(projectTiers, projectsWithBacklog, sprintConfig);
        
        for (const [projectName, suggestedSP] of Object.entries(suggestions)) {
          const project = projectsWithBacklog.find(p => p.name === projectName);
          if (project) {
            expect(suggestedSP).toBeLessThanOrEqual(project.backlogDepth);
          }
        }
      }
    ),
    { numRuns: 100 }
  );
});
```

**Property 29: Plan Persistence Round-Trip**
```javascript
test('Property 29: Plan Persistence Round-Trip', () => {
  // Feature: sprint-planner, Property 29: Save then restore produces equivalent state
  
  fc.assert(
    fc.property(
      fc.record({
        sprintConfig: fc.record({
          name: fc.string().filter(s => s.length > 0),
          startDate: fc.date(),
          endDate: fc.date(),
          teamCapacity: fc.nat(500),
          velocityTarget: fc.nat(500),
          bufferPercentage: fc.nat(100),
        }),
        projectTiers: fc.record({
          mustShip: fc.array(fc.string()),
          important: fc.array(fc.string()),
          easeOff: fc.array(fc.string()),
        }),
        allocations: fc.dictionary(fc.string(), fc.nat(100)),
      }),
      (originalState) => {
        // Save
        saveToLocalStorage(
          originalState.sprintConfig,
          originalState.projectTiers,
          originalState.allocations
        );
        
        // Restore
        const restored = restoreFromLocalStorage(originalState.sprintConfig.name);
        
        // Compare
        expect(restored.sprintConfig.name).toBe(originalState.sprintConfig.name);
        expect(restored.sprintConfig.teamCapacity).toBe(originalState.sprintConfig.teamCapacity);
        expect(restored.sprintConfig.velocityTarget).toBe(originalState.sprintConfig.velocityTarget);
        expect(restored.sprintConfig.bufferPercentage).toBe(originalState.sprintConfig.bufferPercentage);
        expect(restored.projectTiers).toEqual(originalState.projectTiers);
        expect(restored.allocations).toEqual(originalState.allocations);
        
        // Dates need special handling due to serialization
        expect(restored.sprintConfig.startDate.getTime()).toBe(originalState.sprintConfig.startDate.getTime());
        expect(restored.sprintConfig.endDate.getTime()).toBe(originalState.sprintConfig.endDate.getTime());
      }
    ),
    { numRuns: 100 }
  );
});
```

### Test Coverage Goals

**Unit Tests:**
- 100% coverage of utility functions
- 90%+ coverage of hook logic
- 80%+ coverage of component rendering
- All error handling paths tested

**Property-Based Tests:**
- All 42 correctness properties implemented
- Minimum 100 iterations per property
- Edge cases covered through generators

**Integration Tests:**
- Tab navigation and data flow
- Drag-and-drop functionality
- Export operations (Excel, Jira)
- localStorage persistence

**Performance Tests:**
- Initial load with 2,162 tickets < 3s
- Slider updates < 100ms
- Suggestion calculations < 500ms
- Excel export < 2s

### Test Execution

**Run all tests:**
```bash
npm test
```

**Run property-based tests only:**
```bash
npm test -- --testNamePattern="Property"
```

**Run with coverage:**
```bash
npm test -- --coverage
```

**Watch mode for development:**
```bash
npm test -- --watch
```


## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Create `src/hooks/useSprintPlanner.js` with state management
- [ ] Implement data extraction functions (backlog, velocity, assignees)
- [ ] Set up memoization for expensive calculations
- [ ] Add localStorage persistence with debouncing

### Phase 2: UI Components
- [ ] Create `src/components/SprintPlanner/index.jsx` main component
- [ ] Implement `SprintSetupBar.jsx` with form controls
- [ ] Build `ProjectPriorityPanel.jsx` with drag-and-drop zones
- [ ] Create `ProjectCard.jsx` with allocation slider
- [ ] Implement `PlanSummary.jsx` with export buttons

### Phase 3: Business Logic
- [ ] Implement suggestion engine algorithm
- [ ] Add overload detection logic
- [ ] Create validation functions
- [ ] Build export generators (Excel, Jira)

### Phase 4: Integration
- [ ] Add Sprint Planner tab to SprintDashboard
- [ ] Wire up data props from parent
- [ ] Ensure theme consistency
- [ ] Test with real dashboard data

### Phase 5: Testing
- [ ] Write unit tests for all utility functions
- [ ] Implement property-based tests for all 42 properties
- [ ] Add integration tests for user workflows
- [ ] Performance test with 2,162 tickets

### Phase 6: Polish
- [ ] Add keyboard navigation support
- [ ] Implement ARIA labels and live regions
- [ ] Optimize for mobile/tablet viewports
- [ ] Add loading states and error messages
- [ ] Performance profiling and optimization

## File Structure Summary

```
src/
├── components/
│   └── SprintPlanner/
│       ├── index.jsx                    (Main component, ~300 lines)
│       ├── SprintSetupBar.jsx           (~150 lines)
│       ├── ProjectPriorityPanel.jsx     (~200 lines)
│       ├── ProjectCard.jsx              (~250 lines)
│       └── PlanSummary.jsx              (~200 lines)
├── hooks/
│   └── useSprintPlanner.js              (~400 lines)
├── utils/
│   └── sprintPlannerSuggestions.js      (~200 lines)
└── __tests__/
    └── sprintPlanner/
        ├── useSprintPlanner.test.js     (Unit tests)
        ├── suggestions.test.js          (Unit tests)
        ├── properties.test.js           (Property-based tests)
        └── integration.test.js          (Integration tests)
```

**Total Estimated Lines of Code:** ~1,900 lines (excluding tests)

## Dependencies

**Required:**
- react: ^18.2.0 (already installed)
- xlsx: ^0.18.5 (for Excel export) - **NEW**
- fast-check: ^3.15.0 (for property-based testing) - **NEW**

**Installation:**
```bash
npm install xlsx
npm install --save-dev fast-check
```

## Design Decisions Rationale

### Why Custom Hook for State Management?
- Encapsulates complex business logic
- Makes components simpler and more testable
- Enables easy memoization of expensive calculations
- Provides clean API for component consumption

### Why Client-Side Only?
- No backend infrastructure needed
- Instant response times
- Works offline
- Simpler deployment and maintenance

### Why Three Priority Tiers?
- Balances simplicity with flexibility
- Aligns with common prioritization frameworks (MoSCoW)
- Prevents decision paralysis from too many options
- Clear visual hierarchy

### Why Suggestion Engine?
- Reduces manual effort for initial allocation
- Provides data-driven starting point
- Respects priority tiers automatically
- Users can still override suggestions

### Why localStorage Persistence?
- No server needed
- Instant save/restore
- Survives browser refresh
- Supports multiple saved plans

### Why Property-Based Testing?
- Catches edge cases unit tests miss
- Validates invariants across all inputs
- Provides confidence in correctness
- Complements example-based unit tests

## Future Enhancements

**Potential V2 Features:**
- Historical plan comparison
- What-if scenario modeling
- Team member availability calendar integration
- Automated rebalancing suggestions
- Export to other formats (PDF, CSV)
- Collaborative planning with real-time sync
- AI-powered allocation recommendations
- Risk scoring based on historical data

