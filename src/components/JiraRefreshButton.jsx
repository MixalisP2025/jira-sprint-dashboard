import React, { useRef, useState } from 'react';
import { RefreshCw, AlertCircle, CheckCircle, Loader2, Settings } from 'lucide-react';
import { jiraService } from '../utils/jiraService.js';
import { JIRA_CONFIG } from '../config/jiraConfig.js';
import JiraConfigPanel from './JiraConfigPanel.jsx';

const JiraRefreshButton = ({ onRefresh, disabled = false }) => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [status, setStatus] = useState('idle'); // idle, loading, success, error
  const [errorMessage, setErrorMessage] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const refreshRunIdRef = useRef(0);

  const handleRefresh = async () => {
    console.log('handleRefresh called, isRefreshing:', isRefreshing, 'disabled:', disabled);
    if (isRefreshing || disabled) return;

    // increment run id so older in-flight calls get ignored
    const runId = ++refreshRunIdRef.current;
    console.log('Starting refresh with runId:', runId);

    setIsRefreshing(true);
    setStatus('loading');
    setErrorMessage('');

    try {
      console.log('Checking Jira config...');
      const config = await jiraService.checkConfig();
      if (!config.hasCredentials) {
        throw new Error('Jira credentials not configured. Please check your .env file.');
      }

      console.log('Starting per-project fetch for all projects');

      const jiraData = await jiraService.getAllIssues();

      // ignore if a newer refresh started
      if (runId !== refreshRunIdRef.current) return;

      console.log('=== JIRA REFRESH DEBUG ===');
      console.log('Raw jiraData from getAllIssues:', jiraData);
      console.log('jiraData.total:', jiraData?.total);
      console.log('jiraData.issues length:', jiraData?.issues?.length ?? 0);
      console.log('jiraData.metadata:', jiraData?.metadata);

      const dashboardData = jiraService.transformIssuesToDashboardData(jiraData);

      console.log('Transformed dashboardData length:', dashboardData?.length ?? 0);

      // Show project fetch results to user
      if (jiraData?.metadata) {
        const { successfulProjects, failedProjects, totalProjects } = jiraData.metadata;
        console.log(`✅ Successfully fetched ${successfulProjects.length}/${totalProjects} projects`);
        if (failedProjects.length > 0) {
          console.warn(`⚠️ Failed projects: ${failedProjects.map(f => f.project).join(', ')}`);
        }
      }

      if (onRefresh && typeof onRefresh === 'function') {
        console.log('Calling onRefresh with dashboardData...');
        await onRefresh(dashboardData);
        console.log('onRefresh completed');
      }

      // ignore if a newer refresh started while onRefresh was running
      if (runId !== refreshRunIdRef.current) return;

      setStatus('success');
      
      // Show success message with project info
      if (jiraData?.metadata?.failedProjects?.length > 0) {
        setErrorMessage(`Partial success: ${jiraData.metadata.failedProjects.length} projects failed to load`);
      }
      
      setTimeout(() => {
        // only reset if this is still the latest run
        if (runId === refreshRunIdRef.current) {
          setStatus('idle');
          setErrorMessage('');
        }
      }, 3000);

    } catch (error) {
      console.error('Error refreshing from Jira:', error);

      if (runId !== refreshRunIdRef.current) return;

      setErrorMessage(error.message || 'Failed to refresh data from Jira');
      setStatus('error');

      setTimeout(() => {
        if (runId === refreshRunIdRef.current) setStatus('idle');
      }, 5000);

    } finally {
      if (runId === refreshRunIdRef.current) {
        setIsRefreshing(false);
      }
    }
  };

  const getButtonContent = () => {
    switch (status) {
      case 'loading':
        return (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Refreshing from Jira...
          </>
        );
      case 'success':
        return (
          <>
            <CheckCircle className="w-4 h-4 text-green-400" />
            Data refreshed successfully!
          </>
        );
      case 'error':
        return (
          <>
            <AlertCircle className="w-4 h-4 text-red-400" />
            Refresh failed
          </>
        );
      default:
        return (
          <>
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh from Jira
          </>
        );
    }
  };

  const getButtonClasses = () => {
    const baseClasses = 'flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all duration-200 text-sm';
    
    if (disabled) {
      return `${baseClasses} bg-gray-700 text-gray-400 cursor-not-allowed opacity-50`;
    }

    switch (status) {
      case 'loading':
        return `${baseClasses} bg-blue-600 text-white hover:bg-blue-700`;
      case 'success':
        return `${baseClasses} bg-green-600 text-white hover:bg-green-700`;
      case 'error':
        return `${baseClasses} bg-red-600 text-white hover:bg-red-700`;
      default:
        return `${baseClasses} bg-indigo-600 text-white hover:bg-indigo-700 hover:shadow-lg`;
    }
  };

  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || disabled}
            className={getButtonClasses()}
          >
            {getButtonContent()}
          </button>
          
          <button
            onClick={() => setShowConfig(true)}
            disabled={isRefreshing || disabled}
            className="flex items-center gap-2 px-3 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 transition-colors font-medium text-sm"
            title="Configure Jira settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
        
        {status === 'error' && errorMessage && (
          <div className="text-xs text-red-400 bg-red-900/20 border border-red-800/30 rounded p-2">
            {errorMessage}
          </div>
        )}
        
        {status === 'loading' && (
          <div className="text-xs text-blue-400">
            Fetching data from Jira... This may take a moment.
          </div>
        )}
      </div>

      <JiraConfigPanel 
        isOpen={showConfig}
        onClose={() => setShowConfig(false)}
        onConfigChange={(newConfig) => {
          console.log('Jira configuration updated:', newConfig);
        }}
      />
    </>
  );
};

export default JiraRefreshButton;
