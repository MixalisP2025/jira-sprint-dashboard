import { useState, useEffect } from 'react';
import { Server } from 'lucide-react';

// Use same API base as jiraService
const API_BASE = import.meta.env.DEV
  ? 'http://localhost:4001/api'
  : '/api';

export default function ServerStatus() {
  const [backendStatus, setBackendStatus] = useState('checking');
  const [lastChecked, setLastChecked] = useState(null);

  const checkBackendHealth = async () => {
    try {
      const response = await fetch(`${API_BASE}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        setBackendStatus('online');
      } else {
        setBackendStatus('offline');
      }
    } catch (error) {
      setBackendStatus('offline');
    }
    setLastChecked(new Date());
  };

  useEffect(() => {
    // Check status on mount
    checkBackendHealth();

    // Check every 2 minutes
    const interval = setInterval(() => {
      checkBackendHealth();
    }, 120000);

    return () => clearInterval(interval);
  }, []);

  const getStatusColor = (status) => {
    switch (status) {
      case 'online': return 'bg-green-500';
      case 'offline': return 'bg-red-500';
      default: return 'bg-yellow-500';
    }
  };

  const getStatusText = (status) => {
    switch (status) {
      case 'online': return 'Online';
      case 'offline': return 'Offline';
      default: return 'Checking...';
    }
  };

  return (
    <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-lg shadow-sm border border-gray-200">
      {/* Backend Status */}
      <div className="flex items-center gap-2">
        <Server className="w-4 h-4 text-gray-600" />
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${getStatusColor(backendStatus)} animate-pulse`} />
          <span className="text-sm font-medium text-gray-700">
            {getStatusText(backendStatus)}
          </span>
        </div>
      </div>

      {/* Last Checked */}
      {lastChecked && (
        <div className="text-xs text-gray-500 pl-3 border-l border-gray-300">
          {lastChecked.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
