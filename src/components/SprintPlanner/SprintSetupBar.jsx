import React from 'react';

/**
 * Sprint Setup Bar Component
 * Displays and allows editing of sprint configuration parameters
 */
export function SprintSetupBar({ config, onChange, validationErrors = [] }) {
  const handleDateChange = (field, value) => {
    const date = new Date(value);
    onChange(field, date);
  };

  const handleNumberChange = (field, value) => {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      // Apply bounds validation
      if (field === 'velocityTarget' && num < 0) {
        onChange(field, 0);
      } else if (field === 'bufferPercentage') {
        onChange(field, Math.max(0, Math.min(100, num)));
      } else {
        onChange(field, num);
      }
    }
  };

  const formatDate = (date) => {
    if (!(date instanceof Date)) return '';
    return date.toISOString().split('T')[0];
  };

  const hasError = (field) => {
    return validationErrors.some(err => err.includes(field));
  };

  return (
    <div className="bg-[#1a1d2e] border border-slate-700 rounded-lg p-4 mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Sprint Name */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Sprint Name
          </label>
          <input
            type="text"
            value={config.name}
            onChange={(e) => onChange('name', e.target.value)}
            className={`w-full px-3 py-2 bg-[#13151f] border ${
              hasError('name') ? 'border-red-500' : 'border-slate-600'
            } rounded text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500`}
            placeholder="Sprint 1"
          />
          {hasError('name') && (
            <p className="text-red-400 text-xs mt-1">Sprint name is required</p>
          )}
        </div>

        {/* Start Date */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Start Date
          </label>
          <input
            type="date"
            value={formatDate(config.startDate)}
            onChange={(e) => handleDateChange('startDate', e.target.value)}
            className="w-full px-3 py-2 bg-[#13151f] border border-slate-600 rounded text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* End Date */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            End Date
          </label>
          <input
            type="date"
            value={formatDate(config.endDate)}
            onChange={(e) => handleDateChange('endDate', e.target.value)}
            className={`w-full px-3 py-2 bg-[#13151f] border ${
              hasError('date') ? 'border-red-500' : 'border-slate-600'
            } rounded text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
          {hasError('date') && (
            <p className="text-red-400 text-xs mt-1">End date must be after start date</p>
          )}
        </div>

        {/* Team Capacity */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Team Capacity (SP)
          </label>
          <input
            type="number"
            value={config.teamCapacity}
            onChange={(e) => handleNumberChange('teamCapacity', e.target.value)}
            className="w-full px-3 py-2 bg-[#13151f] border border-slate-600 rounded text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            min="0"
          />
        </div>

        {/* Velocity Target */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Velocity Target (SP)
          </label>
          <input
            type="number"
            value={config.velocityTarget}
            onChange={(e) => handleNumberChange('velocityTarget', e.target.value)}
            className="w-full px-3 py-2 bg-[#13151f] border border-slate-600 rounded text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            min="0"
          />
        </div>

        {/* Buffer Percentage */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-1">
            Buffer % (0-100)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              value={config.bufferPercentage}
              onChange={(e) => handleNumberChange('bufferPercentage', e.target.value)}
              className="flex-1"
              min="0"
              max="100"
              step="1"
            />
            <input
              type="number"
              value={config.bufferPercentage}
              onChange={(e) => handleNumberChange('bufferPercentage', e.target.value)}
              className="w-16 px-2 py-1 bg-[#13151f] border border-slate-600 rounded text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="0"
              max="100"
            />
            <span className="text-slate-400 text-sm">%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
