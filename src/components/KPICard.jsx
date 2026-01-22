import React from 'react';

const KPICard = ({ icon: Icon, value, label, status, subtitle }) => {
  const statusColors = {
    success: 'bg-green-50 border-l-4 border-green-500',
    warning: 'bg-amber-50 border-l-4 border-amber-500',
    critical: 'bg-red-50 border-l-4 border-red-500',
    neutral: 'bg-slate-50 border-l-4 border-slate-500',
  };

  const textColors = {
    success: 'text-green-700',
    warning: 'text-amber-700',
    critical: 'text-red-700',
    neutral: 'text-slate-700',
  };

  return (
    <div className={`rounded-xl p-4 ${statusColors[status] || statusColors.neutral}`}>
      <div className="flex items-start justify-between mb-2">
        <Icon className={`w-6 h-6 ${textColors[status] || textColors.neutral} opacity-80`} />
      </div>
      <div className={`text-3xl font-bold ${textColors[status] || textColors.neutral} mb-1`}>
        {value}
      </div>
      <p className="text-xs font-medium text-slate-600 uppercase tracking-wide">
        {label}
      </p>
      {subtitle && (
        <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
      )}
    </div>
  );
};

export default KPICard;