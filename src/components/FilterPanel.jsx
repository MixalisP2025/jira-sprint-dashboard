import React from 'react';
import { Filter, X } from 'lucide-react';

const FilterPanel = ({ 
  sprint, 
  assignee, 
  onSprintChange, 
  onAssigneeChange, 
  sprints, 
  assignees, 
  onClearAll,
  children 
}) => {
  const hasFilters = sprint !== 'all' || assignee !== 'all';

  return (
    <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700">
      <div className="flex flex-wrap items-center justify-center gap-4">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-300">Filters:</span>
        </div>
        
        <select
          value={sprint}
          onChange={(e) => onSprintChange(e.target.value)}
          className="px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {sprints.map(s => (
            <option key={s} value={s}>
              {s === 'all' ? 'All Sprints' : s === 'backlog' ? '📋 Backlog (No Sprint)' : s}
            </option>
          ))}
        </select>

        <select
          value={assignee}
          onChange={(e) => onAssigneeChange(e.target.value)}
          className="px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {assignees.map(a => (
            <option key={a} value={a}>
              {a === 'all' ? 'All Assignees' : a}
            </option>
          ))}
        </select>

        {children}

        {hasFilters && (
          <button
            onClick={onClearAll}
            className="flex items-center gap-1 px-3 py-2 text-sm text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
            Clear All
          </button>
        )}
      </div>
    </div>
  );
};

export default FilterPanel;