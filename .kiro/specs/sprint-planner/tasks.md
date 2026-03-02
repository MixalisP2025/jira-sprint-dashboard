# Implementation Plan: Sprint Planner

## Overview

This plan implements a comprehensive Sprint Planning tool as a new tab in the Sprint Analytics Dashboard. The implementation follows a 6-phase approach: Core Infrastructure → UI Components → Business Logic → Integration → Testing → Polish. The Sprint Planner enables Product Managers to configure sprints, prioritize projects across three tiers, allocate story points with real-time overload detection, and export plans to Excel and Jira formats.

## Tasks

- [x] 1. Set up core infrastructure and data extraction
  - [x] 1.1 Create useSprintPlanner hook with state management
    - Implement state for sprintConfig, projectTiers, and allocations
    - Set up initialization logic for default sprint configuration
    - Add state update functions (updateSprintConfig, moveProject, updateAllocation)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 8.4_
  
  - [x] 1.2 Implement data extraction functions
    - Create computeProjectBacklogs function to extract backlog depth from "To Do" tickets
    - Create computeHistoricalVelocity function to calculate average completed story points
    - Create computeSprintDefaults function for auto-populating sprint configuration
    - Use memoization with useMemo for all extraction functions
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.2, 2.7, 9.2, 9.3, 12.2, 12.3, 12.4, 12.5_
  
  - [ ]* 1.3 Write property tests for data extraction
    - **Property 1: Sprint Name Auto-Increment** - Default sprint name equals max sprint number + 1
    - **Property 2: Next Monday Calculation** - Calculated next Monday is always a Monday after the given date
    - **Property 3: Sprint Duration Calculation** - End date is exactly 14 days after start date
    - **Property 4: Team Capacity Summation** - Team capacity equals sum of all assignee capacities
    - **Property 15: Assignee Extraction** - Project assignees are unique set from all tickets
    - **Property 40: Data Integration Completeness** - All data correctly extracted from raw dashboard data
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 4.2, 12.2, 12.3, 12.4, 12.5**
  
  - [x] 1.4 Implement localStorage persistence with debouncing
    - Create saveToLocalStorage function with version and timestamp
    - Create restoreFromLocalStorage function with error handling
    - Add debounced save effect (500ms) triggered by state changes
    - Implement corrupted data recovery with graceful fallback
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.8, 11.8_
  
  - [ ]* 1.5 Write property tests for persistence
    - **Property 29: Plan Persistence Round-Trip** - Save then restore produces equivalent state
    - **Property 30: State Change Persistence** - All state changes trigger save within 500ms
    - **Property 32: Storage Key Format** - localStorage key includes sprint name
    - **Property 39: Corrupted Data Recovery** - Corrupted data results in default initialization
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.8, 11.8**

- [ ] 2. Checkpoint - Verify core infrastructure
  - Ensure all tests pass, ask the user if questions arise.

- [-] 3. Build UI components for sprint configuration and project display
  - [x] 3.1 Create SprintSetupBar component
    - Implement form inputs for sprint name, start date, end date
    - Add numeric inputs for team capacity, velocity target, buffer percentage
    - Implement date range validation (end date must be after start date)
    - Add numeric bounds validation (velocity >= 0, buffer 0-100)
    - Display validation errors inline with visual indicators
    - _Requirements: 1.5, 1.6, 1.7, 1.8, 1.9, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7_
  
  - [ ]* 3.2 Write property tests for configuration validation
    - **Property 5: Date Range Validation** - Invalid date ranges fail validation and disable exports
    - **Property 35: Empty Sprint Name Validation** - Empty sprint name fails validation
    - **Property 36: Velocity Target Bounds** - Negative velocity reset to zero
    - **Property 37: Buffer Percentage Bounds** - Buffer clamped to [0, 100]
    - **Property 38: Numeric Input Validation** - Only valid numbers accepted
    - **Validates: Requirements 1.7, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7**
  
  - [ ] 3.3 Create ProjectCard component with allocation slider
    - Display project name with color indicator and backlog depth
    - Implement range slider (0 to backlogDepth) with keyboard support
    - Add numeric input field for direct allocation entry
    - Display current allocation value and suggestion button
    - Show assignee chips below slider
    - Add visual warning when allocation exceeds backlog
    - Implement draggable behavior for tier reassignment
    - _Requirements: 2.6, 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 3.8, 3.9, 3.10, 11.6_
  
  - [ ]* 3.4 Write property tests for allocation controls
    - **Property 10: Allocation Bounds** - Allocation within [0, backlogDepth]
    - **Property 11: Allocation Update Performance** - Updates complete within 50ms
    - **Validates: Requirements 3.2, 3.3**
  
  - [ ] 3.5 Create ProjectPriorityPanel component
    - Implement three tier sections (Must Ship, Important, Ease Off)
    - Add drag-and-drop zones with visual feedback
    - Display tier header with project count
    - Render ProjectCard components for each project in tier
    - Implement drop event handlers to update project tier
    - Add keyboard-based drag-and-drop (Space key)
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 10.9, 10.10_
  
  - [ ]* 3.6 Write property tests for tier management
    - **Property 7: Default Tier Assignment** - All projects initially in Ease Off tier
    - **Property 8: Tier Update Performance** - Tier updates complete within 50ms
    - **Property 9: Tier Partitioning Invariant** - Each project in exactly one tier
    - **Validates: Requirements 2.2, 2.4**
  
  - [ ] 3.7 Create PlanSummary component
    - Display capacity overview (team capacity, allocated, unallocated)
    - Show overload warnings count with visual indicator
    - Add "Accept All Suggestions" button
    - Add "Export to Excel" and "Copy Jira Comment" buttons
    - Add "Clear Plan" button with confirmation
    - Disable export buttons when validation fails
    - _Requirements: 3.5, 3.6, 3.7, 4.7, 5.8, 6.1, 7.1, 8.6, 8.7, 11.1, 11.2_
  
  - [ ]* 3.8 Write unit tests for UI components
    - Test SprintSetupBar form validation and error display
    - Test ProjectCard slider interactions and keyboard navigation
    - Test ProjectPriorityPanel drag-and-drop behavior
    - Test PlanSummary button states and disabled conditions
    - _Requirements: 1.5, 1.6, 1.7, 2.3, 3.8, 3.9, 11.1, 11.2_

- [ ] 4. Checkpoint - Verify UI components render correctly
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement business logic for suggestions and conflict detection
  - [ ] 5.1 Create suggestion engine algorithm
    - Implement computeSuggestions function with priority-based allocation
    - Allocate to Must Ship tier first (100% of backlog if capacity allows)
    - Allocate to Important tier second (60% of backlog)
    - Allocate to Ease Off tier last (30% of backlog)
    - Respect buffer percentage by reducing available capacity
    - Cap suggestions at project backlog depth
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  
  - [ ]* 5.2 Write property tests for suggestion engine
    - **Property 17: Suggestion Priority Ordering** - Higher tier projects allocated before lower tier
    - **Property 18: Buffer Capacity Reduction** - Available capacity respects buffer percentage
    - **Property 19: Suggestion Backlog Cap** - Suggestions never exceed backlog depth
    - **Property 22: Suggestion Engine Performance** - Calculations complete within 500ms for 2,162 tickets
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.10**
  
  - [ ] 5.3 Implement suggestion acceptance actions
    - Add acceptSuggestion function to set single project allocation
    - Add acceptAllSuggestions function to set all allocations at once
    - Ensure acceptAllSuggestions completes within 200ms
    - _Requirements: 5.6, 5.7, 5.9_
  
  - [ ]* 5.4 Write property tests for suggestion acceptance
    - **Property 20: Accept Suggestion Idempotence** - Accepting twice maintains same value
    - **Property 21: Accept All Suggestions** - All projects set to suggested values
    - **Validates: Requirements 5.7, 5.9**
  
  - [ ] 5.5 Create overload detection logic
    - Implement computeAssigneeLoads function to calculate per-assignee totals
    - Split project allocations evenly across assignees
    - Implement computeOverloadWarnings function to identify overloaded assignees
    - Ensure recalculation completes within 100ms
    - Sort warnings by overage amount (descending)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_
  
  - [ ]* 5.6 Write property tests for overload detection
    - **Property 14: Assignee Load Recalculation Performance** - Recalculation within 100ms
    - **Property 16: Overload Detection Consistency** - Warning exists iff allocated > capacity
    - **Validates: Requirements 4.1, 4.3, 4.6**
  
  - [ ] 5.7 Implement real-time calculation updates
    - Add memoized calculations for totalAllocated and unallocated
    - Ensure allocation slider updates trigger recalculation within 100ms
    - Add memoized calculation for assigneeLoads dependent on allocations
    - Add memoized calculation for overloadWarnings dependent on assigneeLoads
    - _Requirements: 1.10, 3.3, 4.1, 9.5_
  
  - [ ]* 5.8 Write property tests for calculation invariants
    - **Property 6: Configuration Change Performance** - Dependent calculations within 100ms
    - **Property 12: Total Allocation Summation** - Total equals sum of individual allocations
    - **Property 13: Unallocated Capacity Calculation** - Unallocated equals capacity minus allocated
    - **Property 34: Slider Update Performance** - UI updates within 100ms
    - **Validates: Requirements 1.10, 3.3, 3.5, 3.6, 9.5**

- [ ] 6. Checkpoint - Verify business logic calculations
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement export functionality
  - [ ] 7.1 Create Excel export generator
    - Install xlsx library (npm install xlsx)
    - Implement exportToExcel function with 4 sheets (Configuration, Allocations, Summary, Warnings)
    - Add sprint configuration parameters to Sheet 1
    - Add project allocations table to Sheet 2 (project, tier, backlog, allocated, assignees)
    - Add summary totals to Sheet 3 (allocated, unallocated, capacity, utilization)
    - Add overload warnings to Sheet 4 (assignee, capacity, allocated, overage, projects)
    - Generate filename with format "sprint-plan-{sprint-name}-{date}.xlsx"
    - Trigger browser download on completion
    - Ensure export completes within 2 seconds for 2,162 tickets
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  
  - [ ]* 7.2 Write property tests for Excel export
    - **Property 23: Excel Export Completeness** - All configuration, allocations, summary, and warnings included
    - **Property 24: Excel Filename Format** - Filename matches expected pattern
    - **Property 25: Excel Export Performance** - Export completes within 2 seconds for 2,162 tickets
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5, 6.6, 6.7**
  
  - [ ] 7.3 Create Jira comment export generator
    - Implement exportToJiraComment function with Jira markdown syntax
    - Add sprint configuration header (h2 heading)
    - Group projects by tier (h3 headings) with allocations and assignees
    - Add summary section with totals and utilization
    - Add warnings section (if overloads exist) using {warning} macro
    - Implement copyToClipboard function with error handling
    - Show success confirmation message for 2 seconds
    - Provide fallback text area if clipboard fails
    - Ensure export completes within 100ms
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_
  
  - [ ]* 7.4 Write property tests for Jira export
    - **Property 26: Jira Comment Format Completeness** - All configuration, tiers, summary, and warnings included
    - **Property 27: Clipboard Copy Success** - Clipboard contains exact formatted text
    - **Property 28: Clipboard Error Handling** - Failures show error and provide alternative
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.9**

- [ ] 8. Checkpoint - Verify export functionality
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Integrate Sprint Planner into existing dashboard
  - [x] 9.1 Register Sprint Planner tab in SprintDashboard
    - Add sprintPlanner tab to tabs object with Calendar icon
    - Position between Capacity and Sprints tabs
    - Add conditional rendering for Sprint Planner component
    - Pass filteredData, assigneeCaps, sprintDates, and stats as props
    - _Requirements: 12.1_
  
  - [x] 9.2 Create main SprintPlanner component
    - Import and use useSprintPlanner hook
    - Implement drag-and-drop context using HTML5 Drag API
    - Add unmount effect to save plan state before navigating away
    - Render SprintSetupBar, PlanSummary, and three ProjectPriorityPanel components
    - Apply dark theme styling matching existing dashboard
    - _Requirements: 12.7, 12.8_
  
  - [ ] 9.3 Ensure theme consistency
    - Use existing project color mappings from dashboard
    - Apply dark theme design tokens (background: #13151f, card: #1a1d2e, border: #2d3148)
    - Use consistent text colors (primary: #e2e8f0, secondary: #94a3b8)
    - Use accent colors for states (blue: #3b82f6, green: #10b981, yellow: #f59e0b, red: #ef4444)
    - _Requirements: 2.6, 10.3, 12.6_
  
  - [ ]* 9.4 Write integration tests
    - Test tab navigation and data flow from parent dashboard
    - Test that Sprint Planner receives correct props
    - Test that project colors match existing dashboard
    - Test unmount persistence behavior
    - _Requirements: 12.1, 12.6, 12.7, 12.8_
  
  - [ ]* 9.5 Write property test for project color consistency
    - **Property 41: Project Color Consistency** - Colors match existing dashboard theme
    - **Property 42: Unmount Persistence** - Navigating away triggers save
    - **Validates: Requirements 12.6, 12.8**

- [ ] 10. Checkpoint - Verify dashboard integration
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Add accessibility and responsive design features
  - [ ] 11.1 Implement keyboard navigation
    - Add keyboard support for allocation sliders (arrow keys)
    - Add visible focus indicators for all interactive elements
    - Implement keyboard-based drag-and-drop (Space key to pick/drop)
    - Ensure tab order follows logical reading order
    - _Requirements: 3.8, 3.9, 10.5, 10.10_
  
  - [ ] 11.2 Add ARIA labels and live regions
    - Add ARIA labels to all allocation sliders (project name and current value)
    - Add ARIA live region for overload warning announcements
    - Ensure screen readers announce when warnings are added/removed
    - Add role and aria-label attributes to drag-and-drop zones
    - _Requirements: 10.6, 10.7_
  
  - [ ] 11.3 Implement responsive layout
    - Stack priority tier sections vertically on viewports < 768px
    - Display tier sections horizontally on viewports >= 768px
    - Ensure minimum touch target size of 44x44 pixels for all interactive elements
    - Test layout on mobile and tablet viewports
    - _Requirements: 10.1, 10.2, 10.4_
  
  - [ ] 11.4 Ensure non-color-based status indicators
    - Add icon indicators for overload warnings (not just color)
    - Add text labels for validation errors (not just red borders)
    - Provide visual feedback for drag operations beyond color changes
    - _Requirements: 10.8, 10.9_
  
  - [ ]* 11.5 Write property tests for accessibility
    - **Property 12: Accessibility Invariants** - Focus indicators, ARIA labels, touch targets, tab order
    - **Validates: Requirements 10.5, 10.6, 10.10**

- [ ] 12. Add performance optimizations and monitoring
  - [ ] 12.1 Optimize component rendering
    - Wrap ProjectCard in React.memo with custom comparison
    - Wrap ProjectPriorityPanel in React.memo
    - Use useCallback for all event handlers passed to child components
    - Ensure memoization prevents unnecessary re-renders
    - _Requirements: 9.1, 9.7_
  
  - [ ] 12.2 Add performance monitoring
    - Add performance.mark calls for expensive calculations
    - Log warnings when operations exceed performance targets
    - Monitor initial load time, slider updates, suggestion calculations, and exports
    - _Requirements: 9.4, 9.5_
  
  - [ ]* 12.3 Write performance property tests
    - **Property 33: Initial Load Performance** - Load and render within 3 seconds for 2,162 tickets
    - **Validates: Requirements 9.4**

- [ ] 13. Add error handling and user feedback
  - [ ] 13.1 Implement validation error display
    - Show inline validation errors for sprint configuration
    - Display warning indicators when allocation exceeds backlog
    - Show error messages for localStorage failures
    - Display notifications for export success/failure
    - _Requirements: 11.1, 11.2, 11.6_
  
  - [ ] 13.2 Add error recovery mechanisms
    - Handle localStorage quota exceeded errors
    - Recover from corrupted localStorage data
    - Provide fallback for clipboard access failures
    - Handle missing assignee capacity data gracefully
    - _Requirements: 11.8_
  
  - [ ] 13.3 Implement user notifications
    - Add toast notifications for export success
    - Show confirmation message after clipboard copy (2 seconds)
    - Display error messages for failed operations
    - Add loading states for long-running operations
    - _Requirements: 7.8, 7.9_

- [ ] 14. Final checkpoint - Complete end-to-end testing
  - Test complete user workflow: configure sprint → prioritize projects → allocate story points → detect overloads → accept suggestions → export plan
  - Verify all performance targets met with 2,162 ticket dataset
  - Ensure all validation and error handling works correctly
  - Test accessibility with keyboard-only navigation and screen reader
  - Verify responsive design on mobile, tablet, and desktop viewports
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation throughout implementation
- Property tests validate universal correctness properties across all inputs
- Unit tests validate specific examples and edge cases
- The implementation uses JavaScript/React as specified in the design document
- All components follow the existing dashboard's dark theme and design patterns
