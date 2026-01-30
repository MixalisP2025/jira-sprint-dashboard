import React, { useState } from 'react';
import { Settings, Calendar, Database, Save, X } from 'lucide-react';
import { JIRA_CONFIG, buildJQL } from '../config/jiraConfig.js';

const JiraConfigPanel = ({ isOpen, onClose, onConfigChange }) => {
  const [config, setConfig] = useState({
    daysBack: JIRA_CONFIG.dateRange.daysBack ?? '',
    projects: [...JIRA_CONFIG.projects]
  });

  const handleSave = () => {
    // Update the global config
    JIRA_CONFIG.dateRange.daysBack = config.daysBack === '' ? null : Number(config.daysBack);
    JIRA_CONFIG.projects = [...config.projects];
    
    // Notify parent component
    if (onConfigChange) {
      onConfigChange({
        ...JIRA_CONFIG,
        jql: buildJQL()
      });
    }
    
    onClose();
  };

  const availableProjects = ['CSFR', 'AISITS', 'ACI', 'CSR', 'AFMS', 'BMS', 'CTONGO', 'CPM', 'CS00398A', 'CS00398B', 'CNBIL408', 'CSB', 'CS00429', 'CS00434', 'CBAHESF', 'CS441SAPD', 'COGP', 'TRFCSPRM', 'CCPI', 'DRM', 'DWHP', 'FAA', 'FSM', 'ISE', 'MOS', 'MDP', 'MCA', 'OGSN', 'PEWS', 'PS', 'RB', 'SRFCSS', 'SETINPFILE', 'SSLM', 'SRDUAT', 'STLU', 'T0ORS', 'UP', 'UPB', 'WFNDS', 'WBILL', 'XPONGO', 'QO00443'];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-lg p-6 w-full max-w-md border border-slate-700">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-400" />
            <h2 className="text-xl font-semibold text-white">Jira Configuration</h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Date Range Configuration */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
              <Calendar className="w-4 h-4" />
              Date Range (days back)
            </label>
            <input
              type="number"
              min="1"
              max="365"
              value={config.daysBack}
              onChange={(e) => {
                const value = e.target.value;
                setConfig(prev => ({ ...prev, daysBack: value === '' ? '' : Number(value) }));
              }}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <p className="text-xs text-slate-400 mt-1">
              {config.daysBack === ''
                ? 'No date limit (fetch all history)'
                : `Fetch issues updated in the last ${config.daysBack} days`}
            </p>
          </div>

          {/* Projects Configuration */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
              <Database className="w-4 h-4" />
              Projects
            </label>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {availableProjects.map(project => (
                <label key={project} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={config.projects.includes(project)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setConfig(prev => ({ ...prev, projects: [...prev.projects, project] }));
                      } else {
                        setConfig(prev => ({ 
                          ...prev, 
                          projects: prev.projects.filter(p => p !== project) 
                        }));
                      }
                    }}
                    className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                  />
                  <span className="text-slate-300">{project}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Current JQL Preview */}
          <div>
            <label className="text-sm font-medium text-slate-300 mb-2 block">
              Current JQL Query
            </label>
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-3">
              <code className="text-xs text-green-400 break-all">
                {buildJQL({ ...JIRA_CONFIG, dateRange: { daysBack: config.daysBack }, projects: config.projects })}
              </code>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleSave}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            <Save className="w-4 h-4" />
            Save Configuration
          </button>
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors font-medium"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

export default JiraConfigPanel;
