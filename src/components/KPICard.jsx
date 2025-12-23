import React from 'react';

/**
 * KPICard - Simple metric display card
 * 
 * Usage:
 * <KPICard
 *   icon={CheckCircle}
 *   value="87%"
 *   label="Sprint Completion"
 *   status="success"
 * />
 */

const KPICard = ({ 
  icon: Icon, 
  value, 
  label, 
  status = 'neutral', // success, warning, critical, neutral
  subtitle
}) => {
  const colors = {
    success: 'border-green-500 bg-green-50',
    warning: 'border-amber-500 bg-amber-50',
    critical: 'border-red-500 bg-red-50',
    neutral: 'border-slate-300 bg-slate-50',
  };

  const textColors = {
    success: 'text-green-700',
    warning: 'text-amber-700',
    critical: 'text-red-700',
    neutral: 'text-slate-700',
  };

  return (
    <div className={`rounded-xl border-2 ${colors[status]} p-4`}>
      <div className="flex items-start justify-between mb-2">
        {Icon && (
          <Icon className={`w-6 h-6 ${textColors[status]} opacity-80`} />
        )}
      </div>
      
      <div className={`text-3xl font-bold ${textColors[status]} mb-1`}>
        {value}
      </div>
      
      <p className="text-xs font-medium text-slate-600 uppercase tracking-wide">
        {label}
      </p>
      
      {subtitle && (
        <p className="text-xs text-slate-500 mt-2">
          {subtitle}
        </p>
      )}
    </div>
  );
};

export default KPICard;