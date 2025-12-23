import React from 'react';

/**
 * FilterPanel - Simple inline filter controls
 * 
 * Usage:
 * <FilterPanel
 *   sprint={selectedSprint}
 *   assignee={selectedAssignee}
 *   onSprintChange={(value) => setSelectedSprint(value)}
 *   onAssigneeChange={(value) => setSelectedAssignee(value)}
 *   sprints={['all', 'Sprint 14', 'Sprint 13']}
 *   assignees={['all', 'John', 'Jane']}
 *   onClearAll={() => { setSelectedSprint('all'); setSelectedAssignee('all'); }}
 * />
 */

const FilterPanel = ({
  sprint,
  assignee,
  onSprintChange,
  onAssigneeChange,
  sprints = [],
  assignees = [],
  onClearAll
}) => {
  const activeFilters = [
    sprint !== 'all' ? 'Sprint' : null,
    assignee !== 'all' ? 'Assignee' : null
  ].filter(Boolean);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-4 flex-wrap">
        {/* Sprint Filter */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-600 mb-2">
            Filter by Sprint
          </label>
          <select
            value={sprint}
            onChange={(e) => onSprintChange(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {sprints.map((s) => (
              <option key={s} value={s}>
                {s === 'all' ? 'All Sprints' : s}
              </option>
            ))}
          </select>
        </div>

        {/* Assignee Filter */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-slate-600 mb-2">
            Filter by Assignee
          </label>
          <select
            value={assignee}
            onChange={(e) => onAssigneeChange(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {assignees.map((a) => (
              <option key={a} value={a}>
                {a === 'all' ? 'All Assignees' : a}
              </option>
            ))}
          </select>
        </div>

        {/* Clear All Button */}
        {activeFilters.length > 0 && (
          <div className="flex items-end">
            <button
              onClick={onClearAll}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200 transition-colors"
            >
              Clear All ({activeFilters.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FilterPanel;