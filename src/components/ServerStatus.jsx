import { useState, useEffect } from 'react';
import { RefreshCw, Server, Activity } from 'lucide-react';

// Use same API base as jiraService
const API_BASE = import.meta.env.DEV
  ? 'http://localhost:4001/api'
  : '/api';

export default function ServerStatus() {
  const [backendStatus, setBackendStatus] = useState('checking');
  const [pm2Status, setPm2Status] = useState(null);
  const [isRestarting, setIsRestarting] = useState(false);
  const [lastChecked, setLastChecked] = useState(null);

  const checkBackendHealth = async () => {
    try {
      const response = await fetch(`${API_BASE.replace('/api', '')}/health`, { 
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

  const checkPM2Status = async () => {
    try {
      const response = await fetch(`${API_BASE}/pm2-status`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setPm2Status(data);
        }
      }
    } catch (error) {
      // PM2 status not available (might be on Vercel)
      setPm2Status(null);
    }
  };

  const handleStart = async () => {
    setIsRestarting(true);
    try {
      const response = await fetch(`${API_BASE}/pm2-start`, {
        method: 'POST'
      });
      
      const data = await response.json();
      
      if (data.success) {
        alert('Servers started successfully! Page will reload in 3 seconds...');
        setTimeout(() => window.location.reload(), 3000);
      } else {
        alert('Failed to start servers: ' + data.message);
      }
    } catch (error) {
      alert('Error starting servers: ' + error.message);
    } finally {
      setIsRestarting(false);
    }
  };

  const handleRestart = async () => {
    if (!confirm('Restart both frontend and backend servers?')) return;
    
    setIsRestarting(true);
    try {
      const response = await fetch(`${API_BASE}/pm2-restart`, {
        method: 'POST'
      });
      
      const data = await response.json();
      
      if (data.success) {
        alert('Servers restarted successfully! Page will reload in 3 seconds...');
        setTimeout(() => window.location.reload(), 3000);
      } else {
        alert('Failed to restart servers: ' + data.message);
      }
    } catch (error) {
      alert('Error restarting servers: ' + error.message);
    } finally {
      setIsRestarting(false);
    }
  };

  useEffect(() => {
    // Check status on mount
    checkBackendHealth();
    checkPM2Status();

    // Check every 30 seconds
    const interval = setInterval(() => {
      checkBackendHealth();
      checkPM2Status();
    }, 30000);

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

      {/* PM2 Status (if available) */}
      {pm2Status && pm2Status.success && (
        <div className="flex items-center gap-2 pl-3 border-l border-gray-300">
          <Activity className="w-4 h-4 text-gray-600" />
          <div className="text-xs text-gray-600">
            <span className="font-medium">BE:</span> {pm2Status.backend.status}
            <span className="mx-1">|</span>
            <span className="font-medium">FE:</span> {pm2Status.frontend.status}
          </div>
        </div>
      )}

      {/* Start Button - shows when backend is offline */}
      {backendStatus === 'offline' && (
        <button
          onClick={handleStart}
          disabled={isRestarting}
          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:bg-gray-400 rounded transition-colors shadow-sm"
          title="Start both servers"
        >
          <RefreshCw className={`w-4 h-4 ${isRestarting ? 'animate-spin' : ''}`} />
          {isRestarting ? 'Starting...' : 'Start Servers'}
        </button>
      )}

      {/* Restart Button - shows when backend is online */}
      {pm2Status && pm2Status.success && backendStatus === 'online' && (
        <button
          onClick={handleRestart}
          disabled={isRestarting}
          className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 rounded transition-colors"
          title="Restart both servers"
        >
          <RefreshCw className={`w-3 h-3 ${isRestarting ? 'animate-spin' : ''}`} />
          {isRestarting ? 'Restarting...' : 'Restart'}
        </button>
      )}

      {/* Last Checked */}
      {lastChecked && (
        <div className="text-xs text-gray-500 pl-3 border-l border-gray-300">
          {lastChecked.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
