import React, { useState, useMemo, useEffect } from 'react';
import {
  Upload, Users, TrendingUp, CheckCircle, Clock, AlertCircle,
  Calendar, Home, LayoutDashboard, Shield, Briefcase, Database,
  Target, BarChart3
} from 'lucide-react';
import KPICard from './components/KPICard';
import FilterPanel from './components/FilterPanel';

const SprintDashboard = () => {
  // ============== STATE ==============
  const [data, setData] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedSprint, setSelectedSprint] = useState('all');
  const [selectedAssignee, setSelectedAssignee] = useState('all');
  const [sprintDates, setSprintDates] = useState({});
  const [assigneeCaps, setAssigneeCaps] = useState({});
  const [sprintDaysConfig, setSprintDaysConfig] = useState({});
  const [programEndDate, setProgramEndDate] = useState('');
  const [projectTargets, setProjectTargets] = useState({}); // NEW: Per-project target end dates

  // ============== PERSIST SETTINGS ==============
  useEffect(() => {
    try {
      const savedCaps = localStorage.getItem('assigneeCaps');
      if (savedCaps) setAssigneeCaps(JSON.parse(savedCaps));
      const savedDays = localStorage.getItem('sprintDaysConfig');
      if (savedDays) setSprintDaysConfig(JSON.parse(savedDays));
      const savedProgramEnd = localStorage.getItem('programEndDate');
      if (savedProgramEnd) setProgramEndDate(savedProgramEnd);
      const savedProjectTargets = localStorage.getItem('projectTargets');
      if (savedProjectTargets) setProjectTargets(JSON.parse(savedProjectTargets));
    } catch (e) {}
  }, []);

  useEffect(() => {
    localStorage.setItem('assigneeCaps', JSON.stringify(assigneeCaps));
  }, [assigneeCaps]);

  useEffect(() => {
    localStorage.setItem('sprintDaysConfig', JSON.stringify(sprintDaysConfig));
  }, [sprintDaysConfig]);

  useEffect(() => {
    if (programEndDate) {
      localStorage.setItem('programEndDate', programEndDate);
    } else {
      localStorage.removeItem('programEndDate');
    }
  }, [programEndDate]);

  useEffect(() => {
    localStorage.setItem('projectTargets', JSON.stringify(projectTargets));
  }, [projectTargets]);

  // ============== DATA PARSING ==============
  const parseJiraText = (text) => {
    const cleaned = text.replace(/\0/g, '').trim();
    if (!cleaned) return [];

    const firstLine = cleaned.split(/\r?\n/)[0];
    const delimiter = firstLine.includes('\t') ? '\t' :
                      firstLine.includes(';') ? ';' :
                      firstLine.includes(',') ? ',' : null;

    if (!delimiter) {
      console.warn('Unknown delimiter');
      return [];
    }

    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < cleaned.length; i++) {
      const char = cleaned[i];
      const next = cleaned[i + 1];

      if (char === '"' && next === '"') {
        field += '"';
        i++;
        continue;
      }
      if (char === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (!inQuotes && char === delimiter) {
        row.push(field);
        field = '';
        continue;
      }
      if (!inQuotes && (char === '\n' || char === '\r')) {
        if (field || row.length) {
          row.push(field);
          rows.push(row);
          row = [];
          field = '';
        }
        continue;
      }
      field += char;
    }
    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }

    if (rows.length < 2) return [];

    const headers = rows[0].map(h => h.trim());
    const parsedData = rows.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h] = r[i]?.trim() ?? '';
      });
      return obj;
    });

    // Extract sprint dates
    const dates = {};
    parsedData.forEach(item => {
      const sprint = item['Sprint'] || item['G'] || '';
      if (sprint && !dates[sprint]) {
        const dateMatch = sprint.match(/(\d{2}-\d{2}-\d{2})\s+to\s+(\d{2}-\d{2}-\d{2})/);
        if (dateMatch) {
          const startParts = dateMatch[1].split('-');
          const endParts = dateMatch[2].split('-');
          const isYearFirst = parseInt(startParts[0]) > 31;
          dates[sprint] = isYearFirst
            ? { start: `${startParts[1]}/${startParts[2]}/20${startParts[0]}`, end: `${endParts[1]}/${endParts[2]}/20${endParts[0]}` }
            : { start: `${startParts[1]}/${startParts[0]}/20${startParts[2]}`, end: `${endParts[1]}/${endParts[0]}/20${endParts[2]}` };
        }
      }
    });

    setSprintDates(dates);
    return parsedData;
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      setData(parseJiraText(text));
    } catch (err) {
      console.error(err);
      alert('Failed to parse Jira export.');
    }
  };

  const handleGoHome = () => {
    setData([]);
    setSelectedSprint('all');
    setSelectedAssignee('all');
    setActiveTab('overview');
  };

  const handleProjectClick = (projectName) => {
    alert(`Project clicked: ${projectName}\n(This can be extended to filter the dashboard)`);
  };

  // ============== COMPUTED DATA ==============
  const sprints = useMemo(() => {
    const set = new Set();
    data.forEach(item => {
      const sprint = item['Sprint'] || item['G'] || '';
      if (sprint) set.add(sprint);
    });
    const arr = Array.from(set);
    arr.sort((a, b) => {
      const na = (a && (a.match(/(\d+)/) || [])[1]) || null;
      const nb = (b && (b.match(/(\d+)/) || [])[1]) || null;
      if (na && nb) return Number(nb) - Number(na);
      return b.localeCompare(a);
    });
    return ['all', ...arr];
  }, [data]);

  const assignees = useMemo(() => {
    const set = new Set();
    data.forEach(item => {
      const assignee = item['Assignee'] || item['D'] || '';
      if (assignee) set.add(assignee);
    });
    return ['all', ...Array.from(set).sort()];
  }, [data]);

  const filteredData = useMemo(() => {
    return data.filter(item => {
      const sprint = item['Sprint'] || item['G'] || '';
      const assignee = item['Assignee'] || item['D'] || '';
      return (selectedSprint === 'all' || sprint === selectedSprint) &&
             (selectedAssignee === 'all' || assignee === selectedAssignee);
    });
  }, [data, selectedSprint, selectedAssignee]);

  const stats = useMemo(() => {
    const byAssignee = {};
    filteredData.forEach(item => {
      const assignee = item['Assignee'] || item['D'] || 'Unassigned';
      if (!byAssignee[assignee]) {
        byAssignee[assignee] = {
          epics: 0, stories: 0, bugs: 0, tasks: 0, subtasks: 0,
          totalStoryPoints: 0, completedStoryPoints: 0, remainingStoryPoints: 0,
          awaitingTestingStoryPoints: 0, awaitingVersioningStoryPoints: 0,
          availableStoryPoints: 0, inProgressStoryPoints: 0, toDoStoryPoints: 0,
          sprintCapacity: assigneeCaps[assignee] || 16,
          capacityUsed: 0, capacityRemaining: 0, capacityUtilization: 0,
          allocationStatus: 'On Track',
          doneCount: 0, inProgressCount: 0, todoCount: 0,
          awaitingTestingCount: 0, awaitingVersioningCount: 0,
          items: [],
        };
      }

      const type = item['Issue Type'];
      if (type === 'Initiative') byAssignee[assignee].initiatives++;
      else if (type === 'Epic') byAssignee[assignee].epics++;
      else if (type === 'Story') byAssignee[assignee].stories++;
      else if (type === 'Bug') byAssignee[assignee].bugs++;
      else if (type === 'Task') byAssignee[assignee].tasks++;
      else if (type === 'Sub-task') byAssignee[assignee].subtasks++;

      const status = item['Status'];
      if (status === 'Done') byAssignee[assignee].doneCount++;
      else if (status === 'In Progress') byAssignee[assignee].inProgressCount++;
      else if (status === 'To Do') byAssignee[assignee].todoCount++;
      else if (status === 'Awaiting Testing') byAssignee[assignee].awaitingTestingCount++;
      else if (status === 'Awaiting Versioning') byAssignee[assignee].awaitingVersioningCount++;

      const sp = parseFloat(item['Story Points']) || 0;
      if (sp > 0) {
        byAssignee[assignee].totalStoryPoints += sp;
        if (status === 'Done') byAssignee[assignee].completedStoryPoints += sp;
        else if (status === 'Awaiting Testing') {
          byAssignee[assignee].awaitingTestingStoryPoints += sp;
          byAssignee[assignee].remainingStoryPoints += sp;
        } else if (status === 'Awaiting Versioning') {
          byAssignee[assignee].awaitingVersioningStoryPoints += sp;
          byAssignee[assignee].remainingStoryPoints += sp;
        } else if (status === 'In Progress') {
          byAssignee[assignee].inProgressStoryPoints += sp;
          byAssignee[assignee].remainingStoryPoints += sp;
          byAssignee[assignee].availableStoryPoints += sp;
        } else if (status === 'To Do') {
          byAssignee[assignee].toDoStoryPoints += sp;
          byAssignee[assignee].remainingStoryPoints += sp;
          byAssignee[assignee].availableStoryPoints += sp;
        } else {
          byAssignee[assignee].remainingStoryPoints += sp;
          byAssignee[assignee].availableStoryPoints += sp;
        }
      }

      byAssignee[assignee].items.push(item);
    });

    Object.keys(byAssignee).forEach(assignee => {
      const d = byAssignee[assignee];
      d.capacityUsed = d.inProgressStoryPoints + d.toDoStoryPoints;
      d.capacityRemaining = d.sprintCapacity - d.capacityUsed;
      d.capacityUtilization = d.sprintCapacity > 0 ? (d.capacityUsed / d.sprintCapacity) * 100 : 0;

      if (d.capacityUsed > d.sprintCapacity) d.allocationStatus = 'Over Allocated';
      else if (d.capacityUsed < d.sprintCapacity * 0.7) d.allocationStatus = 'Under Allocated';
      else d.allocationStatus = 'On Track';
    });

    return byAssignee;
  }, [filteredData, assigneeCaps]);

  const sprintTimeline = useMemo(() => {
    if (selectedSprint === 'all') return null;
    const dates = sprintDates[selectedSprint];
    if (!dates) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [startMonth, startDay, startYear] = dates.start.split('/');
    const [endMonth, endDay, endYear] = dates.end.split('/');

    const startDate = new Date(parseInt(startYear), parseInt(startMonth) - 1, parseInt(startDay));
    const endDate = new Date(parseInt(endYear), parseInt(endMonth) - 1, parseInt(endDay));

    const defaultDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
    const configuredDays = sprintDaysConfig[selectedSprint] || defaultDays;

    const daysSinceStart = Math.ceil((today - startDate) / (1000 * 60 * 60 * 24));
    const elapsedDays = Math.max(1, Math.min(daysSinceStart + 1, configuredDays));
    const daysRemaining = Math.max(0, configuredDays - elapsedDays + 1);
    const percentTimeElapsed = Math.min(100, Math.max(0, Math.round((elapsedDays / configuredDays) * 100)));

    return {
      startDate: dates.start,
      endDate: dates.end,
      elapsedDays,
      totalDays: configuredDays,
      daysRemaining,
      percentTimeElapsed,
      isConfigured: !!sprintDaysConfig[selectedSprint]
    };
  }, [selectedSprint, sprintDates, sprintDaysConfig]);

  const riskRegister = useMemo(() => {
    const risks = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const assigneeUtilization = {};
    Object.entries(stats).forEach(([assignee, s]) => {
      assigneeUtilization[assignee] = s.sprintCapacity > 0 ? (s.totalStoryPoints / s.sprintCapacity) * 100 : 0;
    });

    data.forEach(item => {
      const issueKey = item['Issue key'] || item['Key'] || '';
      const project = item['Project'] || item['B'] || 'Unknown';
      const assignee = item['Assignee'] || item['D'] || 'Unassigned';
      const status = item['Status'] || '';
      const sp = parseFloat(item['Story Points']) || 0;
      const sprint = item['Sprint'] || item['G'] || '';

      const parseDDMMYY = (dateStr) => {
        if (!dateStr) return null;
        const match = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (match) {
          const day = parseInt(match[1]);
          const month = parseInt(match[2]) - 1;
          let year = parseInt(match[3]);
          if (year < 100) year += 2000;
          return new Date(year, month, day);
        }
        const parsed = new Date(dateStr);
        return isNaN(parsed) ? null : parsed;
      };

      const dueDate = item['Due Date'] || item['Due date'] || '';
      const targetEnd = item['Target End'] || item['Target end'] || '';
      let targetEndDate = parseDDMMYY(dueDate) || parseDDMMYY(targetEnd);

      if (!targetEndDate && sprintDates[sprint]) {
        const [endMonth, endDay, endYear] = sprintDates[sprint].end.split('/');
        targetEndDate = new Date(parseInt(endYear), parseInt(endMonth) - 1, parseInt(endDay));
      }

      let daysLate = null;
      if (targetEndDate) {
        daysLate = Math.ceil((today - targetEndDate) / (1000 * 60 * 60 * 24));
      }

      const utilization = assigneeUtilization[assignee] || 0;

      if (targetEndDate && daysLate > 0 && status !== 'Done') {
        risks.push({ issueKey, project, assignee, riskLevel: 'High', reason: `Overdue by ${daysLate} day${daysLate !== 1 ? 's' : ''}`, daysLate, status, sp, sprint });
      } else if (utilization > 200 && status !== 'Done') {
        risks.push({ issueKey, project, assignee, riskLevel: 'High', reason: `Assignee at ${Math.round(utilization)}% utilization`, daysLate, status, sp, sprint });
      } else if (sp === 0 && targetEndDate && daysLate >= -5 && daysLate < 0 && status !== 'Done') {
        risks.push({ issueKey, project, assignee, riskLevel: 'Medium', reason: `No Story Points - due in ${Math.abs(daysLate)} day${Math.abs(daysLate) !== 1 ? 's' : ''}`, daysLate, status, sp, sprint });
      }
    });

    risks.sort((a, b) => {
      const priority = { 'High': 0, 'Medium': 1 };
      if (a.riskLevel !== b.riskLevel) return priority[a.riskLevel] - priority[b.riskLevel];
      return (b.daysLate || 0) - (a.daysLate || 0);
    });

    return risks;
  }, [data, stats, sprintDates]);

  const milestoneTracking = useMemo(() => {
    const map = {};
    data.forEach(item => {
      const sprint = item['Sprint'] || item['G'] || '';
      if (!sprint || sprint === 'No Sprint') return;
      const project = item['Project'] || item['B'] || 'Unknown';
      const key = `${project}|||${sprint}`;
      if (!map[key]) map[key] = { project, sprint, totalSP: 0, completedSP: 0, items: 0, doneItems: 0 };
      map[key].items++;
      if (item['Status'] === 'Done') map[key].doneItems++;
      const sp = parseFloat(item['Story Points']) || 0;
      if (sp > 0) {
        map[key].totalSP += sp;
        if (item['Status'] === 'Done') map[key].completedSP += sp;
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return Object.values(map).map(m => {
      const dates = sprintDates[m.sprint];
      let daysRemaining = null;
      const percentComplete = m.totalSP > 0
        ? Math.round((m.completedSP / m.totalSP) * 100)
        : m.items > 0 ? Math.round((m.doneItems / m.items) * 100) : 0;

      if (dates) {
        const [endMonth, endDay, endYear] = dates.end.split('/');
        const targetEnd = new Date(parseInt(endYear), parseInt(endMonth) - 1, parseInt(endDay));
        daysRemaining = Math.ceil((targetEnd - today) / (1000 * 60 * 60 * 24));
      }

      let status = 'On Track';
      if (percentComplete >= 100) status = 'Complete';
      else if (daysRemaining !== null && daysRemaining < 0) status = 'Delayed';
      else if (percentComplete < 50) status = 'Behind';
      else if (percentComplete < 75) status = 'At Risk';

      return { project: m.project, sprint: m.sprint, targetEnd: dates ? dates.end : 'N/A', totalSP: m.totalSP, completedSP: m.completedSP, percentComplete, daysRemaining, status };
    });
  }, [data, sprintDates]);

  const projectProgressData = useMemo(() => {
    const map = {};
    (selectedSprint === 'all' ? data : filteredData).forEach(item => {
      const project = item['Project'] || item['B'] || 'Unknown';
      if (!map[project]) map[project] = { project, totalItems: 0, doneItems: 0, totalSP: 0, completedSP: 0 };
      map[project].totalItems++;
      if (item['Status'] === 'Done') map[project].doneItems++;
      const sp = parseFloat(item['Story Points']) || 0;
      if (sp > 0) {
        map[project].totalSP += sp;
        if (item['Status'] === 'Done') map[project].completedSP += sp;
      }
    });

    return Object.values(map).map(p => ({
      ...p,
      percentSP: p.totalSP > 0 ? (p.completedSP / p.totalSP) * 100 : null,
      percentCount: p.totalItems > 0 ? (p.doneItems / p.totalItems) * 100 : 0,
    }));
  }, [data, filteredData, selectedSprint]);

  const timelineData = useMemo(() => {
    if (data.length === 0) return [];

    const projectMap = {};

    data.forEach(item => {
      const project = item['Project'] || item['B'] || 'Unknown';
      const sprint = item['Sprint'] || item['G'] || '';
      const status = item['Status'];

      if (!projectMap[project]) {
        projectMap[project] = {
          project,
          sprints: new Set(),
          startDate: null,
          endDate: null,
          totalSP: 0,
          completedSP: 0,
          items: 0,
          doneItems: 0,
        };
      }

      if (sprint) projectMap[project].sprints.add(sprint);

      const sp = parseFloat(item['Story Points']) || 0;
      projectMap[project].totalSP += sp;
      projectMap[project].items++;

      if (status === 'Done') {
        projectMap[project].completedSP += sp;
        projectMap[project].doneItems++;
      }
    });

    return Object.values(projectMap).map(p => {
      let minStart = null;
      let maxEnd = null;

      p.sprints.forEach(sprint => {
        const dates = sprintDates[sprint];
        if (dates) {
          const start = new Date(dates.start.replace(/\//g, '-'));
          const end = new Date(dates.end.replace(/\//g, '-'));

          if (!minStart || start < minStart) minStart = start;
          if (!maxEnd || end > maxEnd) maxEnd = end;
        }
      });

      const percentComplete = p.totalSP > 0
        ? (p.completedSP / p.totalSP) * 100
        : p.items > 0 ? (p.doneItems / p.items) * 100 : 0;

      return {
        ...p,
        startDate: minStart ? minStart.toISOString().split('T')[0] : null,
        endDate: maxEnd ? maxEnd.toISOString().split('T')[0] : null,
        percentComplete: Math.round(percentComplete),
        targetEndDate: projectTargets[p.project] || (maxEnd ? maxEnd.toISOString().split('T')[0] : null) // Use custom or fallback
      };
    }).filter(p => p.startDate && p.endDate).sort((a, b) => new Date(a.endDate) - new Date(b.endDate)); // Sort by end date
  }, [data, sprintDates, projectTargets]);

  const totalSP = Object.values(stats).reduce((sum, s) => sum + s.totalStoryPoints, 0);
  const completedSP = Object.values(stats).reduce((sum, s) => sum + s.completedStoryPoints, 0);
  const awaitingTestingSP = Object.values(stats).reduce((sum, s) => sum + s.awaitingTestingStoryPoints, 0);
  const availableSP = Object.values(stats).reduce((sum, s) => sum + s.availableStoryPoints, 0);
  const completionRate = totalSP > 0 ? Math.round((completedSP / totalSP) * 100) : 0;
  const highRisks = riskRegister.filter(r => r.riskLevel === 'High').length;
  const overloadedCount = Object.values(stats).filter(s => s.allocationStatus === 'Over Allocated').length;

  const getProjectColor = (name) => {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
      hash = (hash << 5) - hash + name.charCodeAt(i);
      hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
  };

  const tabs = {
    overview: { icon: LayoutDashboard, label: 'Overview' },
    risks: { icon: Shield, label: 'Risk Register' },
    capacity: { icon: Users, label: 'Capacity' },
    sprints: { icon: Target, label: 'Sprints' },
    projects: { icon: Briefcase, label: 'Projects' },
    timeline: { icon: BarChart3, label: 'Timeline' },
    data: { icon: Database, label: 'Raw Data' },
  };

  if (data.length === 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-2xl shadow-2xl p-12 text-center">
            <Upload className="w-20 h-20 mx-auto text-blue-500 mb-6" />
            <h1 className="text-4xl font-bold text-gray-800 mb-4">Sprint Analytics Dashboard</h1>
            <p className="text-gray-600 mb-8 text-lg">
              Upload your Jira export to analyze sprint progress, capacity, and risks
            </p>
            <label className="inline-block px-8 py-4 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors text-lg font-semibold">
              Upload Jira Data (TSV/CSV)
              <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="sticky top-0 z-50 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-white">Sprint Analytics Dashboard</h1>
              <p className="text-sm text-slate-400 mt-1">
                {selectedSprint !== 'all' ? selectedSprint : 'All Sprints'}
                {selectedAssignee !== 'all' && ` • ${selectedAssignee}`}
              </p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setSelectedSprint('all'); setSelectedAssignee('all'); }} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors font-medium">
                Reset Filters
              </button>
              <button onClick={handleGoHome} className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors flex items-center gap-2">
                <Home className="w-4 h-4" /> Home
              </button>
              <label className="px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-500 transition-colors flex items-center gap-2 font-medium">
                <Upload className="w-4 h-4" /> Re-upload
                <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
          </div>

          <div className="flex gap-1 border-b border-slate-700">
            {Object.entries(tabs).map(([key, { icon: Icon, label }]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-all ${
                  activeTab === key
                    ? 'border-blue-500 text-blue-400 bg-slate-800/50'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="font-medium">{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {activeTab !== 'timeline' && (
          <FilterPanel
            sprint={selectedSprint}
            assignee={selectedAssignee}
            onSprintChange={setSelectedSprint}
            onAssigneeChange={setSelectedAssignee}
            sprints={sprints}
            assignees={assignees}
            onClearAll={() => { setSelectedSprint('all'); setSelectedAssignee('all'); }}
          />
        )}

        {activeTab === 'overview' && (
          <OverviewSection
            stats={stats}
            completionRate={completionRate}
            totalSP={totalSP}
            completedSP={completedSP}
            awaitingTestingSP={awaitingTestingSP}
            availableSP={availableSP}
            highRisks={highRisks}
            overloadedCount={overloadedCount}
            sprintTimeline={sprintTimeline}
            selectedSprint={selectedSprint}
            sprintDaysConfig={sprintDaysConfig}
            setSprintDaysConfig={setSprintDaysConfig}
          />
        )}

        {activeTab === 'risks' && (
          <RiskSection riskRegister={riskRegister} selectedSprint={selectedSprint} selectedAssignee={selectedAssignee} />
        )}

        {activeTab === 'capacity' && (
          <CapacitySection stats={stats} assigneeCaps={assigneeCaps} setAssigneeCaps={setAssigneeCaps} />
        )}

        {activeTab === 'sprints' && (
          <SprintsSection milestoneTracking={milestoneTracking} getProjectColor={getProjectColor} selectedSprint={selectedSprint} />
        )}

        {activeTab === 'projects' && (
          <ProjectsSection projectProgressData={projectProgressData} getProjectColor={getProjectColor} />
        )}

        {activeTab === 'timeline' && (
          <TimelineSection
            timelineData={timelineData}
            programEndDate={programEndDate}
            setProgramEndDate={setProgramEndDate}
            getProjectColor={getProjectColor}
            onProjectClick={handleProjectClick}
            projectTargets={projectTargets}
            setProjectTargets={setProjectTargets}
          />
        )}

        {activeTab === 'data' && (
          <DataSection stats={stats} filteredData={filteredData} />
        )}
      </div>

      <button
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        className="fixed right-6 bottom-6 z-50 bg-blue-600 text-white p-3 rounded-full shadow-lg hover:bg-blue-500 transition-all"
      >
        ↑
      </button>
    </div>
  );
};

// ============== SECTION COMPONENTS ==============
const OverviewSection = ({ stats, completionRate, totalSP, completedSP, awaitingTestingSP, availableSP, highRisks, overloadedCount, sprintTimeline, selectedSprint, sprintDaysConfig, setSprintDaysConfig }) => {
  const [showSprintConfig, setShowSprintConfig] = useState(false);
  const [tempDays, setTempDays] = useState('');

  return (
    <div className="space-y-6">
      {(highRisks > 0 || overloadedCount > 0) && (
        <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900 mb-1">⚠️ Action Required</h3>
              <ul className="text-sm text-amber-800 space-y-1">
                {highRisks > 0 && <li>• {highRisks} high-priority risk{highRisks > 1 ? 's' : ''} need attention</li>}
                {overloadedCount > 0 && <li>• {overloadedCount} team member{overloadedCount > 1 ? 's are' : ' is'} overloaded</li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard icon={CheckCircle} value={`${completionRate}%`} label="Work Completed" status={completionRate >= 70 ? "success" : completionRate >= 50 ? "warning" : "critical"} subtitle={`${completedSP.toFixed(1)} / ${totalSP.toFixed(1)} SP`} />

        {sprintTimeline && (
          <div className="bg-slate-50 border-l-4 border-slate-500 rounded-xl p-4 relative">
            <div className="flex items-start justify-between mb-2">
              <Calendar className="w-6 h-6 text-slate-700 opacity-80" />
              <button onClick={() => setShowSprintConfig(!showSprintConfig)} className="text-xs text-slate-600 hover:text-slate-800 underline">⚙️</button>
            </div>
            <div className="text-3xl font-bold text-slate-700 mb-1">{sprintTimeline.percentTimeElapsed}%</div>
            <p className="text-xs font-medium text-slate-600 uppercase tracking-wide mb-2">Sprint Timeline</p>
            <p className="text-xs text-slate-500">
              Day {sprintTimeline.elapsedDays} of {sprintTimeline.totalDays}
              {sprintTimeline.daysRemaining > 0 && ` • ${sprintTimeline.daysRemaining}d left`}
              {sprintTimeline.isConfigured && <span className="ml-1">✓</span>}
            </p>
            {showSprintConfig && (
              <div className="absolute top-full left-0 mt-2 w-64 bg-white border-2 border-slate-300 rounded-lg shadow-xl p-4 z-50">
                <h4 className="font-semibold text-slate-900 mb-2">Configure Sprint Days</h4>
                <p className="text-xs text-slate-600 mb-3">Adjust for holidays or team availability</p>
                <div className="flex gap-2 mb-2">
                  <input type="number" min="1" max="30" placeholder={sprintTimeline.totalDays.toString()} value={tempDays} onChange={(e) => setTempDays(e.target.value)} className="flex-1 px-3 py-2 border border-slate-300 rounded text-sm text-slate-900" />
                  <button onClick={() => {
                    const days = parseInt(tempDays);
                    if (days > 0) {
                      setSprintDaysConfig(prev => ({ ...prev, [selectedSprint]: days }));
                      setTempDays('');
                      setShowSprintConfig(false);
                    }
                  }} className="px-3 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">Set</button>
                </div>
                {sprintTimeline.isConfigured && (
                  <button onClick={() => {
                    setSprintDaysConfig(prev => {
                      const updated = { ...prev };
                      delete updated[selectedSprint];
                      return updated;
                    });
                    setShowSprintConfig(false);
                  }} className="text-xs text-red-600 hover:text-red-800 underline">Reset to default</button>
                )}
              </div>
            )}
          </div>
        )}

        <KPICard icon={Users} value={Object.keys(stats).length} label="Team Members" status="neutral" />
        <KPICard icon={Clock} value={awaitingTestingSP.toFixed(1)} label="Awaiting Testing SP" status="warning" />
        <KPICard icon={TrendingUp} value={availableSP.toFixed(1)} label="Available SP" status="neutral" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl p-6">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Team Workload (Story Points)</h2>
          <div className="space-y-3">
            {Object.entries(stats).slice(0, 10).map(([name, data]) => {
              const maxSP = Math.max(...Object.values(stats).map(s => s.totalStoryPoints));
              const totalWidth = (data.totalStoryPoints / maxSP) * 100;
              const completedWidth = (data.completedStoryPoints / maxSP) * 100;
              return (
                <div key={name}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700">{name.length > 20 ? name.substring(0, 20) + '...' : name}</span>
                    <span className="text-slate-600">{data.totalStoryPoints.toFixed(1)} SP</span>
                  </div>
                  <div className="relative h-8 bg-slate-100 rounded">
                    <div className="absolute h-8 bg-blue-500 rounded" style={{ width: `${totalWidth}%` }}></div>
                    <div className="absolute h-8 bg-green-500 rounded" style={{ width: `${completedWidth}%` }}></div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-4 text-sm">
            <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-500 rounded"></div><span className="text-slate-600">Total</span></div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 bg-green-500 rounded"></div><span className="text-slate-600">Completed</span></div>
          </div>
        </div>

        <div className="bg-white rounded-xl p-6">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Capacity vs Actual Work</h2>
          <div className="space-y-3">
            {Object.entries(stats).slice(0, 10).map(([name, data]) => {
              const capacity = data.sprintCapacity;
              const donePercent = capacity > 0 ? (data.completedStoryPoints / capacity) * 100 : 0;
              const inProgressPercent = capacity > 0 ? (data.inProgressStoryPoints / capacity) * 100 : 0;
              const toDoPercent = capacity > 0 ? (data.toDoStoryPoints / capacity) * 100 : 0;
              return (
                <div key={name}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-slate-700">{name.length > 20 ? name.substring(0, 20) + '...' : name}</span>
                    <span className="text-slate-600">{data.capacityUsed.toFixed(1)} / {capacity} SP</span>
                  </div>
                  <div className="relative h-8 bg-slate-200 rounded overflow-hidden">
                    <div className="absolute inset-0 flex">
                      {donePercent > 0 && <div className="h-8 bg-green-500" style={{ width: `${donePercent}%` }}></div>}
                      {inProgressPercent > 0 && <div className="h-8 bg-blue-500" style={{ width: `${inProgressPercent}%` }}></div>}
                      {toDoPercent > 0 && <div className="h-8 bg-amber-500" style={{ width: `${toDoPercent}%` }}></div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-4 mt-4 text-sm">
            <div className="flex items-center gap-2"><div className="w-3 h-3 bg-green-500 rounded"></div><span className="text-slate-600">Done</span></div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 bg-blue-500 rounded"></div><span className="text-slate-600">In Progress</span></div>
            <div className="flex items-center gap-2"><div className="w-3 h-3 bg-amber-500 rounded"></div><span className="text-slate-600">To Do</span></div>
          </div>
        </div>
      </div>
    </div>
  );
};

const RiskSection = ({ riskRegister, selectedSprint, selectedAssignee }) => {
  const filteredRisks = useMemo(() => {
    return riskRegister.filter(risk => {
      const sprintMatch = selectedSprint === 'all' || risk.sprint === selectedSprint;
      const assigneeMatch = selectedAssignee === 'all' || risk.assignee === selectedAssignee;
      return sprintMatch && assigneeMatch;
    });
  }, [riskRegister, selectedSprint, selectedAssignee]);

  const highRisks = filteredRisks.filter(r => r.riskLevel === 'High');
  const mediumRisks = filteredRisks.filter(r => r.riskLevel === 'Medium');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-red-50 border-l-4 border-red-500 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-3xl">🔴</span>
            <span className="text-4xl font-bold text-red-700">{highRisks.length}</span>
          </div>
          <div className="text-sm font-semibold text-red-800">High Priority Risks</div>
        </div>
        <div className="bg-amber-50 border-l-4 border-amber-500 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-3xl">🟠</span>
            <span className="text-4xl font-bold text-amber-700">{mediumRisks.length}</span>
          </div>
          <div className="text-sm font-semibold text-amber-800">Medium Risks</div>
        </div>
        <div className="bg-slate-50 border-l-4 border-slate-300 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <AlertCircle className="w-8 h-8 text-slate-600" />
            <span className="text-4xl font-bold text-slate-700">{filteredRisks.length}</span>
          </div>
          <div className="text-sm font-semibold text-slate-800">Total Risks</div>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6">
        <h2 className="text-xl font-bold text-slate-900 mb-4">Risk Details</h2>
        {filteredRisks.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">✅</div>
            <h3 className="text-2xl font-bold text-green-600 mb-2">No Risks Detected!</h3>
            <p className="text-slate-600">All items appear to be on track.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left py-3 px-3 font-semibold text-slate-700">Issue Key</th>
                  <th className="text-left py-3 px-3 font-semibold text-slate-700">Project</th>
                  <th className="text-left py-3 px-3 font-semibold text-slate-700">Assignee</th>
                  <th className="text-center py-3 px-3 font-semibold text-slate-700">Level</th>
                  <th className="text-left py-3 px-3 font-semibold text-slate-700">Reason</th>
                </tr>
              </thead>
              <tbody>
                {filteredRisks.map((risk, idx) => (
                  <tr key={idx} className={`border-b border-slate-100 ${risk.riskLevel === 'High' ? 'bg-red-50' : 'bg-amber-50'}`}>
                    <td className="py-3 px-3 font-mono font-semibold text-blue-600">{risk.issueKey}</td>
                    <td className="py-3 px-3 text-slate-700">{risk.project}</td>
                    <td className="py-3 px-3 text-slate-700">{risk.assignee}</td>
                    <td className="py-3 px-3 text-center">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${risk.riskLevel === 'High' ? 'bg-red-100 text-red-800 border border-red-300' : 'bg-amber-100 text-amber-800 border border-amber-300'}`}>
                        {risk.riskLevel}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-600">{risk.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const CapacitySection = ({ stats, assigneeCaps, setAssigneeCaps }) => {
  return (
    <div className="bg-white rounded-xl p-6">
      <h2 className="text-xl font-bold text-slate-900 mb-4">Sprint Capacity Planning</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Assignee</th>
              <th className="px-4 py-3 text-center font-semibold text-slate-700">Sprint Capacity</th>
              <th className="px-4 py-3 text-center font-semibold text-slate-700">In Progress</th>
              <th className="px-4 py-3 text-center font-semibold text-slate-700">To Do</th>
              <th className="px-4 py-3 text-center font-semibold text-slate-700">Used</th>
              <th className="px-4 py-3 text-center font-semibold text-slate-700">Remaining</th>
              <th className="px-4 py-3 text-center font-semibold text-slate-700">Utilization</th>
              <th className="px-4 py-3 text-center font-semibold text-slate-700">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {Object.entries(stats).map(([assignee, data]) => (
              <tr key={assignee} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-bold text-gray-900">{assignee}</td>
                <td className="px-4 py-3 text-center">
                  <input
                    type="number"
                    min={0}
                    value={assigneeCaps[assignee] ?? data.sprintCapacity}
                    onChange={(e) => setAssigneeCaps(prev => ({ ...prev, [assignee]: Number(e.target.value) || 0 }))}
                    className="w-20 px-2 py-1 rounded text-center border border-slate-300 text-slate-900 bg-white"
                  />
                </td>
                <td className="px-4 py-3 text-center font-semibold text-blue-600">{data.inProgressStoryPoints.toFixed(1)}</td>
                <td className="px-4 py-3 text-center font-semibold text-gray-600">{data.toDoStoryPoints.toFixed(1)}</td>
                <td className="px-4 py-3 text-center font-bold text-gray-900">{data.capacityUsed.toFixed(1)}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`font-bold ${data.capacityRemaining < 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {data.capacityRemaining.toFixed(1)}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-full bg-gray-200 rounded-full h-4">
                      <div
                        className={`h-4 rounded-full ${data.allocationStatus === 'Over Allocated' ? 'bg-red-600' : data.allocationStatus === 'On Track' ? 'bg-green-600' : 'bg-orange-500'}`}
                        style={{ width: `${Math.min(data.capacityUtilization, 100)}%` }}
                      />
                    </div>
                    <span className="text-base font-bold">{data.capacityUtilization.toFixed(0)}%</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-3 py-1 rounded-full text-sm font-bold border-2 ${data.allocationStatus === 'Over Allocated' ? 'bg-red-100 text-red-800 border-red-300' : data.allocationStatus === 'On Track' ? 'bg-green-100 text-green-800 border-green-300' : 'bg-orange-100 text-orange-800 border-orange-300'}`}>
                    {data.allocationStatus}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SprintsSection = ({ milestoneTracking, getProjectColor, selectedSprint }) => {
  const filteredMilestones = useMemo(() => {
    if (selectedSprint === 'all') return milestoneTracking;
    return milestoneTracking.filter(m => m.sprint === selectedSprint);
  }, [milestoneTracking, selectedSprint]);

  return (
    <div className="bg-white rounded-xl p-6">
      <h2 className="text-xl font-bold text-slate-900 mb-4">Sprint Milestones</h2>
      {filteredMilestones.length === 0 ? (
        <p className="text-slate-600">No milestone data available</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-3 font-semibold text-slate-700">Project</th>
                <th className="text-left py-3 px-3 font-semibold text-slate-700">Sprint</th>
                <th className="text-center py-3 px-3 font-semibold text-slate-700">Target End</th>
                <th className="text-center py-3 px-3 font-semibold text-slate-700">Days Left</th>
                <th className="text-center py-3 px-3 font-semibold text-slate-700">Progress</th>
                <th className="text-center py-3 px-3 font-semibold text-slate-700">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredMilestones.map((m, idx) => (
                <tr key={idx} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: getProjectColor(m.project) }} />
                      <span className="font-medium text-slate-800">{m.project}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-slate-700">{m.sprint}</td>
                  <td className="py-3 px-3 text-center font-mono text-xs text-slate-600">{m.targetEnd}</td>
                  <td className="py-3 px-3 text-center">
                    {m.daysRemaining !== null ? (
                      <span className={`font-medium ${m.daysRemaining < 0 ? 'text-red-600' : 'text-slate-700'}`}>
                        {m.daysRemaining < 0 ? `${Math.abs(m.daysRemaining)}d overdue` : `${m.daysRemaining}d`}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="py-3 px-3">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2.5 bg-slate-200 rounded-full overflow-hidden min-w-[80px]">
                        <div className={`h-full ${m.status === 'Complete' ? 'bg-emerald-500' : m.status === 'On Track' ? 'bg-green-500' : m.status === 'At Risk' ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${m.percentComplete}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-slate-700 w-10 text-right">{m.percentComplete}%</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${m.status === 'Complete' ? 'bg-emerald-100 text-emerald-800' : m.status === 'On Track' ? 'bg-green-100 text-green-800' : m.status === 'At Risk' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>
                      {m.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const ProjectsSection = ({ projectProgressData, getProjectColor }) => {
  return (
    <div className="bg-white rounded-xl p-6">
      <h2 className="text-xl font-bold text-slate-900 mb-4">Project Progress</h2>
      {projectProgressData.length === 0 ? (
        <p className="text-slate-600">No project data available</p>
      ) : (
        <div className="space-y-4">
          {projectProgressData.map((p) => (
            <div key={p.project}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: getProjectColor(p.project) }} />
                  <span className="font-medium text-slate-900">{p.project}</span>
                </div>
                <div className="text-xs text-slate-600">
                  {p.doneItems}/{p.totalItems} items · {p.completedSP.toFixed(1)}/{p.totalSP.toFixed(1)} SP
                </div>
              </div>
              <div className="w-full bg-slate-200 rounded h-3 overflow-hidden">
                <div className="h-3" style={{ width: `${p.percentSP !== null ? p.percentSP : p.percentCount}%`, backgroundColor: getProjectColor(p.project) }} />
              </div>
              <div className="text-xs text-slate-500 mt-1">
                {p.percentSP !== null ? `${p.percentSP.toFixed(1)}% complete (SP)` : `${p.percentCount.toFixed(1)}% complete (by items)`}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const DataSection = ({ stats, filteredData }) => {
  const [showNoStoryPoints, setShowNoStoryPoints] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');

  const displayData = useMemo(() => {
    let result = filteredData;
    if (showNoStoryPoints) {
      result = result.filter(item => (parseFloat(item['Story Points']) || 0) === 0);
    }
    if (statusFilter !== 'all') {
      result = result.filter(item => item['Status'] === statusFilter);
    }
    return result;
  }, [filteredData, showNoStoryPoints, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts = { 'Done': 0, 'In Progress': 0, 'To Do': 0, 'Awaiting Testing': 0, 'Awaiting Versioning': 0, 'Other': 0 };
    filteredData.forEach(item => {
      const status = item['Status'];
      if (counts.hasOwnProperty(status)) counts[status]++;
      else counts['Other']++;
    });
    return counts;
  }, [filteredData]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <button onClick={() => setStatusFilter(statusFilter === 'Done' ? 'all' : 'Done')} className={`p-4 rounded-lg border-l-4 transition-all cursor-pointer hover:shadow-md ${statusFilter === 'Done' ? 'bg-green-100 border-green-600 ring-2 ring-green-500 shadow-lg' : 'bg-green-50 border-green-500 hover:bg-green-100'}`}>
          <div className="text-3xl font-bold text-green-700">{statusCounts['Done']}</div>
          <div className="text-sm font-semibold text-green-800 uppercase mt-1">Done</div>
          {statusFilter === 'Done' && <div className="text-xs text-green-600 mt-1">✓ Active Filter</div>}
        </button>

        <button onClick={() => setStatusFilter(statusFilter === 'In Progress' ? 'all' : 'In Progress')} className={`p-4 rounded-lg border-l-4 transition-all cursor-pointer hover:shadow-md ${statusFilter === 'In Progress' ? 'bg-blue-100 border-blue-600 ring-2 ring-blue-500 shadow-lg' : 'bg-blue-50 border-blue-500 hover:bg-blue-100'}`}>
          <div className="text-3xl font-bold text-blue-700">{statusCounts['In Progress']}</div>
          <div className="text-sm font-semibold text-blue-800 uppercase mt-1">In Progress</div>
          {statusFilter === 'In Progress' && <div className="text-xs text-blue-600 mt-1">✓ Active Filter</div>}
        </button>

        <button onClick={() => setStatusFilter(statusFilter === 'To Do' ? 'all' : 'To Do')} className={`p-4 rounded-lg border-l-4 transition-all cursor-pointer hover:shadow-md ${statusFilter === 'To Do' ? 'bg-gray-100 border-gray-600 ring-2 ring-gray-500 shadow-lg' : 'bg-gray-50 border-gray-400 hover:bg-gray-100'}`}>
          <div className="text-3xl font-bold text-gray-700">{statusCounts['To Do']}</div>
          <div className="text-sm font-semibold text-gray-800 uppercase mt-1">To Do</div>
          {statusFilter === 'To Do' && <div className="text-xs text-gray-600 mt-1">✓ Active Filter</div>}
        </button>

        <button onClick={() => setStatusFilter(statusFilter === 'Awaiting Testing' ? 'all' : 'Awaiting Testing')} className={`p-4 rounded-lg border-l-4 transition-all cursor-pointer hover:shadow-md ${statusFilter === 'Awaiting Testing' ? 'bg-amber-100 border-amber-600 ring-2 ring-amber-500 shadow-lg' : 'bg-amber-50 border-amber-500 hover:bg-amber-100'}`}>
          <div className="text-3xl font-bold text-amber-700">{statusCounts['Awaiting Testing']}</div>
          <div className="text-sm font-semibold text-amber-800 uppercase mt-1">Awaiting Testing</div>
          {statusFilter === 'Awaiting Testing' && <div className="text-xs text-amber-600 mt-1">✓ Active Filter</div>}
        </button>

        <button onClick={() => setStatusFilter(statusFilter === 'Awaiting Versioning' ? 'all' : 'Awaiting Versioning')} className={`p-4 rounded-lg border-l-4 transition-all cursor-pointer hover:shadow-md ${statusFilter === 'Awaiting Versioning' ? 'bg-purple-100 border-purple-600 ring-2 ring-purple-500 shadow-lg' : 'bg-purple-50 border-purple-500 hover:bg-purple-100'}`}>
          <div className="text-3xl font-bold text-purple-700">{statusCounts['Awaiting Versioning']}</div>
          <div className="text-sm font-semibold text-purple-800 uppercase mt-1">Awaiting Versioning</div>
          {statusFilter === 'Awaiting Versioning' && <div className="text-xs text-purple-600 mt-1">✓ Active Filter</div>}
        </button>

        <button onClick={() => setStatusFilter(statusFilter === 'Other' ? 'all' : 'Other')} className={`p-4 rounded-lg border-l-4 transition-all cursor-pointer hover:shadow-md ${statusFilter === 'Other' ? 'bg-slate-100 border-slate-600 ring-2 ring-slate-500 shadow-lg' : 'bg-slate-50 border-slate-400 hover:bg-slate-100'}`}>
          <div className="text-3xl font-bold text-slate-700">{statusCounts['Other']}</div>
          <div className="text-sm font-semibold text-slate-800 uppercase mt-1">Other</div>
          {statusFilter === 'Other' && <div className="text-xs text-slate-600 mt-1">✓ Active Filter</div>}
        </button>
      </div>

      {(statusFilter !== 'all' || showNoStoryPoints) && (
        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="text-sm text-blue-800">
              <span className="font-semibold">Active Filters:</span>
              {statusFilter !== 'all' && <span className="inline-block bg-blue-200 px-3 py-1 rounded ml-2 text-xs font-medium">{statusFilter}</span>}
              {showNoStoryPoints && <span className="inline-block bg-blue-200 px-3 py-1 rounded ml-2 text-xs font-medium">No Story Points</span>}
            </div>
            <button onClick={() => { setStatusFilter('all'); setShowNoStoryPoints(false); }} className="text-sm text-blue-600 hover:text-blue-800 font-semibold underline">
              Clear All
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900 mb-4">Assignee Details</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Assignee</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">Epics</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">Stories</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">Bugs</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">Tasks/Sub-tasks</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">Total SP</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">Done SP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {Object.entries(stats).map(([assignee, data]) => (
                <tr key={assignee} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{assignee}</td>
                  <td className="px-4 py-3 text-center text-gray-700">{data.epics}</td>
                  <td className="px-4 py-3 text-center text-gray-700">{data.stories}</td>
                  <td className="px-4 py-3 text-center text-gray-700">{data.bugs}</td>
                  <td className="px-4 py-3 text-center text-gray-700">{data.tasks + data.subtasks}</td>
                  <td className="px-4 py-3 text-center font-semibold text-gray-900">{data.totalStoryPoints.toFixed(1)}</td>
                  <td className="px-4 py-3 text-center text-green-600 font-semibold">{data.completedStoryPoints.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900">
            Raw Data ({displayData.length} items)
          </h2>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showNoStoryPoints}
              onChange={(e) => setShowNoStoryPoints(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
            />
            <span className="text-sm font-medium text-slate-700">
              Show only tickets without Story Points
            </span>
          </label>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Issue Key</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Type</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Assignee</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">SP</th>
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {displayData.slice(0, 100).map((item, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-blue-600 font-semibold">
                    {item['Issue key'] || item['Key']}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      item['Issue Type'] === 'Story' ? 'bg-green-100 text-green-800' :
                      item['Issue Type'] === 'Bug' ? 'bg-red-100 text-red-800' :
                      item['Issue Type'] === 'Task' || item['Issue Type'] === 'Sub-task' ? 'bg-blue-100 text-blue-800' :
                      item['Issue Type'] === 'Epic' ? 'bg-purple-100 text-purple-800' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {item['Issue Type'] || 'N/A'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-900 font-medium">
                    {item['Assignee'] || item['D'] || 'Unassigned'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      item['Status'] === 'Done' ? 'bg-green-100 text-green-800' :
                      item['Status'] === 'In Progress' ? 'bg-blue-100 text-blue-800' :
                      item['Status'] === 'Awaiting Testing' ? 'bg-amber-100 text-amber-800' :
                      item['Status'] === 'Awaiting Versioning' ? 'bg-purple-100 text-purple-800' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {item['Status'] || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-slate-900">
                    {item['Story Points'] || '-'}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{item['Summary']}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {displayData.length > 100 && (
            <p className="text-center text-sm text-slate-500 mt-6">
              Showing first 100 of {displayData.length} items
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
//mmmm
const TimelineSection = ({ timelineData, programEndDate, setProgramEndDate, getProjectColor, onProjectClick, projectTargets, setProjectTargets }) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [statusFilter, setStatusFilter] = useState('all');
  const [showInsights, setShowInsights] = useState(true);
  const [showGantt, setShowGantt] = useState(true);

  const enhancedTimelineData = useMemo(() => {
    return timelineData.map(project => {
      const customTarget = projectTargets[project.project];
      const effectiveEnd = customTarget || project.endDate;
      const projectedEnd = new Date(effectiveEnd);
      const daysToTarget = Math.ceil((projectedEnd - today) / (1000 * 60 * 60 * 24));
      const isComplete = project.percentComplete >= 100;
      const isDelayed = daysToTarget < 0 && !isComplete;
      const isEarly = daysToTarget > 14 && !isComplete;
      const status = isComplete ? 'Complete' : isDelayed ? 'Delayed' : isEarly ? 'Early' : 'On Track';

      const sortOrder = isDelayed ? 0 : isEarly ? 1 : status === 'On Track' ? 2 : 3;

      return {
        ...project,
        effectiveEndDate: effectiveEnd,
        daysToTarget,
        status,
        isComplete,
        isDelayed,
        isEarly,
        sortOrder,
      };
    });
  }, [timelineData, projectTargets]);

  const filteredAndSortedData = useMemo(() => {
    let data = enhancedTimelineData;
    if (statusFilter !== 'all') {
      data = data.filter(p => p.status === statusFilter);
    }
    return data.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [enhancedTimelineData, statusFilter]);

  // Gantt date range
  const ganttDates = filteredAndSortedData.flatMap(p => [p.startDate, p.effectiveEndDate]);
  if (programEndDate) ganttDates.push(programEndDate);
  const ganttMin = ganttDates.length ? new Date(Math.min(...ganttDates.map(d => new Date(d)))) : today;
  const ganttMax = ganttDates.length ? new Date(Math.max(...ganttDates.map(d => new Date(d)))) : today;
  ganttMin.setMonth(ganttMin.getMonth() - 1);
  ganttMax.setMonth(ganttMax.getMonth() + 2);
  const ganttTotalDays = Math.ceil((ganttMax - ganttMin) / (1000 * 60 * 60 * 24));

  // Corporate month header
  const monthHeader = [];
  let current = new Date(ganttMin);
  while (current <= ganttMax) {
    const percent = ((current - ganttMin) / (1000 * 60 * 60 * 24) / ganttTotalDays) * 100;
    monthHeader.push({
      month: current.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase(),
      year: current.getFullYear(),
      percent,
    });
    current.setMonth(current.getMonth() + 1);
  }

  // Overlap shading
  const overlapZones = [];
  const dayStep = 7;
  for (let day = 0; day < ganttTotalDays; day += dayStep) {
    const currentDate = new Date(ganttMin);
    currentDate.setDate(currentDate.getDate() + day);
    const active = filteredAndSortedData.filter(p => 
      currentDate >= new Date(p.startDate) && currentDate <= new Date(p.effectiveEndDate)
    ).length;
    if (active >= 3) {
      const start = (day / ganttTotalDays) * 100;
      const end = ((day + dayStep) / ganttTotalDays) * 100;
      overlapZones.push({ start, end });
    }
  }

  // Analytics & Insights
  const analytics = useMemo(() => {
    const complete = filteredAndSortedData.filter(p => p.isComplete).length;
    const onTrack = filteredAndSortedData.filter(p => p.status === 'On Track').length;
    const early = filteredAndSortedData.filter(p => p.status === 'Early').length;
    const delayed = filteredAndSortedData.filter(p => p.isDelayed).length;
    const totalSP = filteredAndSortedData.reduce((sum, p) => sum + p.totalSP, 0);
    const completedSP = filteredAndSortedData.reduce((sum, p) => sum + p.completedSP, 0);
    const avgDays = filteredAndSortedData.length > 0 
      ? (filteredAndSortedData.reduce((sum, p) => sum + p.daysToTarget, 0) / filteredAndSortedData.length).toFixed(1)
      : 0;

    return { complete, onTrack, early, delayed, totalSP, completedSP, avgDays: parseFloat(avgDays), total: filteredAndSortedData.length };
  }, [filteredAndSortedData]);

  const insights = [];
  if (analytics.delayed > 0) insights.push(`⚠️ ${analytics.delayed} project${analytics.delayed > 1 ? 's are' : ' is'} delayed`);
  if (analytics.early > 0) insights.push(`✓ ${analytics.early} project${analytics.early > 1 ? 's are' : ' is'} ahead`);
  if (analytics.complete > 0) insights.push(`✓ ${analytics.complete} project${analytics.complete > 1 ? 's' : ''} completed`);
  if (analytics.avgDays !== 0) insights.push(`Overall ${Math.abs(analytics.avgDays)} days ${analytics.avgDays > 0 ? 'ahead' : 'behind'}`);

  return (
    <div className="space-y-8">
      {/* Header & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-bold text-white">Program Timeline</h2>
          <p className="text-xl text-slate-400 mt-2">Project delivery status and scheduling</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <button 
            onClick={() => setStatusFilter('Delayed')} 
            className={`px-6 py-3 rounded-xl font-medium transition ${statusFilter === 'Delayed' ? 'bg-red-600 text-white shadow-lg' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
          >
            Delayed Only
          </button>
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-6 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white text-lg focus:ring-4 focus:ring-blue-500"
          >
            <option value="all">All Projects</option>
            <option value="Delayed">Delayed</option>
            <option value="Early">Early</option>
            <option value="On Track">On Track</option>
            <option value="Complete">Complete</option>
          </select>
          <button 
            onClick={() => setShowGantt(!showGantt)}
            className="px-6 py-3 bg-slate-700 text-white rounded-xl hover:bg-slate-600 font-medium"
          >
            {showGantt ? 'Hide' : 'Show'} Overlap View
          </button>
          <label className="flex items-center gap-4 text-lg">
            <span className="text-slate-300 font-medium">Program Target:</span>
            <input 
              type="date" 
              value={programEndDate} 
              onChange={(e) => setProgramEndDate(e.target.value)}
              className="px-5 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white focus:ring-4 focus:ring-blue-500"
            />
          </label>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6">
        <KPICard icon={Briefcase} value={analytics.total} label="Total Projects" status="neutral" />
        <KPICard icon={CheckCircle} value={analytics.complete} label="Complete" status="success" />
        <KPICard icon={TrendingUp} value={analytics.onTrack + analytics.early} label="On Track/Early" status="success" />
        <KPICard icon={AlertCircle} value={analytics.delayed} label="Delayed" status="critical" />
        <KPICard icon={Calendar} value={analytics.avgDays >= 0 ? `+${analytics.avgDays}` : analytics.avgDays} label="Avg Days to Target" status={analytics.avgDays >= 0 ? "success" : "warning"} />
        <KPICard icon={Target} value={`${analytics.completedSP.toFixed(0)} / ${analytics.totalSP.toFixed(0)} SP`} label="Story Points" status="neutral" />
      </div>

      {/* Smart Insights */}
      {showInsights && insights.length > 0 && (
        <div className="bg-gradient-to-r from-slate-800/80 to-slate-900/80 border border-slate-700 rounded-2xl p-8 shadow-2xl">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-2xl font-bold text-white">Smart Insights</h3>
            <button onClick={() => setShowInsights(false)} className="text-slate-400 hover:text-white text-3xl">×</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {insights.map((insight, i) => (
              <div key={i} className="bg-slate-800/50 rounded-xl px-6 py-5 flex items-center gap-4">
                <span className="text-4xl">{insight.split(' ')[0]}</span>
                <span className="text-lg text-slate-200">{insight.substring(insight.indexOf(' ') + 1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gantt View */}
      {showGantt && (
        <div className="bg-slate-900/60 rounded-2xl p-10 shadow-2xl">
          <h3 className="text-3xl font-bold text-white mb-8">Project Overlap & Concurrency</h3>

          {/* Clean Corporate Date Header */}
          <div className="relative h-24 mb-12">
            <div className="absolute inset-x-0 top-0 h-px bg-slate-600" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-slate-600" />
            <div className="flex h-full items-end justify-between px-8">
              {monthHeader.map((m, i) => (
                <div key={i} className="text-center pb-4">
                  <div className="text-3xl font-extrabold text-white">{m.month}</div>
                  <div className="text-xl text-slate-400 mt-1">{m.year}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Gantt Content */}
          <div className="overflow-x-auto">
            <div style={{ minWidth: '1600px', height: `${filteredAndSortedData.length * 80 + 120}px`, position: 'relative' }}>
              {/* Overlap Shading */}
              {overlapZones.map((zone, i) => (
                <div key={i} className="absolute top-0 bottom-0 bg-red-900/15" style={{ left: `${zone.start}%`, width: `${zone.end - zone.start}%` }} />
              ))}

              {/* TODAY & TARGET Lines */}
              <div className="absolute top-0 bottom-0 w-4 bg-yellow-400 z-30 shadow-[0_0_40px_rgba(250,204,21,0.9)]" style={{ left: `${((today - ganttMin) / (1000*60*60*24) / ganttTotalDays) * 100}%` }}>
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full bg-yellow-400 text-black font-bold px-8 py-4 rounded-b-3xl shadow-2xl text-2xl">
                  TODAY
                </div>
              </div>
              {programEndDate && (
                <div className="absolute top-0 bottom-0 w-4 bg-purple-500 z-30 shadow-[0_0_40px_rgba(168,85,247,0.9)]" style={{ left: `${((new Date(programEndDate) - ganttMin) / (1000*60*60*24) / ganttTotalDays) * 100}%` }}>
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-full bg-purple-600 text-white font-bold px-8 py-4 rounded-b-3xl shadow-2xl text-2xl">
                    TARGET
                  </div>
                </div>
              )}

              {/* Project Bars */}
              {filteredAndSortedData.map((project, i) => {
                const startPercent = ((new Date(project.startDate) - ganttMin) / (1000*60*60*24) / ganttTotalDays) * 100;
                const widthPercent = ((new Date(project.effectiveEndDate) - new Date(project.startDate)) / (1000*60*60*24) / ganttTotalDays) * 100;

                const barColor = project.isComplete ? 'bg-gradient-to-r from-green-600 to-emerald-500' :
                                 project.isDelayed ? 'bg-gradient-to-r from-red-700 to-red-600' :
                                 project.isEarly ? 'bg-gradient-to-r from-emerald-600 to-teal-500' :
                                 'bg-gradient-to-r from-blue-600 to-indigo-500';

                return (
                  <div 
                    key={project.project} 
                    className={`absolute h-16 rounded-2xl shadow-2xl ${barColor} opacity-90 hover:opacity-100 transition-all cursor-pointer`}
                    style={{ top: `${i * 80 + 120}px`, left: `${startPercent}%`, width: `${widthPercent}%` }}
                    onClick={() => onProjectClick(project.project)}
                  >
                    <div className="h-full bg-white/25 rounded-2xl" style={{ width: `${project.percentComplete}%` }} />
                    <div className="absolute inset-0 flex items-center pl-10 text-white font-bold text-2xl truncate">
                      {project.project} ({project.percentComplete}%)
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="mt-12 bg-slate-800/80 backdrop-blur rounded-2xl p-8 max-w-md mx-auto">
            <h4 className="text-xl font-bold text-white mb-6 text-center">Legend</h4>
            <div className="grid grid-cols-2 gap-6">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-r from-red-700 to-red-600 rounded-xl" />
                <span className="text-white font-medium">Delayed</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-indigo-500 rounded-xl" />
                <span className="text-white font-medium">On Track</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-r from-emerald-600 to-teal-500 rounded-xl" />
                <span className="text-white font-medium">Early</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-r from-green-600 to-emerald-500 rounded-xl" />
                <span className="text-white font-medium">Complete</span>
              </div>
            </div>
            <div className="mt-6 pt-6 border-t border-slate-700 text-center text-slate-400">
              Red shaded zones indicate periods with 3+ concurrent projects
            </div>
          </div>
        </div>
      )}

      {/* Main Table with Target Date Editors */}
      <div className="bg-slate-900/50 rounded-2xl overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-800/70">
              <tr>
                <th className="px-10 py-6 text-left text-sm font-semibold text-slate-300 uppercase tracking-wider">Project</th>
                <th className="px-10 py-6 text-left text-sm font-semibold text-slate-300 uppercase tracking-wider">Status</th>
                <th className="px-10 py-6 text-center text-sm font-semibold text-slate-300 uppercase tracking-wider">Progress</th>
                <th className="px-10 py-6 text-center text-sm font-semibold text-slate-300 uppercase tracking-wider">Story Points</th>
                <th className="px-10 py-6 text-left text-sm font-semibold text-slate-300 uppercase tracking-wider">Target End Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filteredAndSortedData.map((project, index) => {
                const statusColor = project.isComplete ? 'text-green-400 bg-green-900/40' :
                                    project.isDelayed ? 'text-red-400 bg-red-900/40' :
                                    project.isEarly ? 'text-emerald-400 bg-emerald-900/40' :
                                    'text-blue-400 bg-blue-900/40';

                const statusIcon = project.isComplete ? '✓' : project.isDelayed ? '⚠️' : project.isEarly ? '↑' : '→';

                return (
                  <tr key={project.project} className={`hover:bg-slate-800/50 transition-all ${index % 2 === 0 ? 'bg-slate-800/20' : ''}`}>
                    <td className="px-10 py-8">
                      <button 
                        onClick={() => onProjectClick(project.project)}
                        className="text-2xl font-bold text-white hover:text-blue-300 transition"
                      >
                        {project.project}
                      </button>
                      <div className="text-sm text-slate-400 mt-2">
                        Started {new Date(project.startDate).toLocaleDateString()}
                      </div>
                    </td>
                    <td className="px-10 py-8">
                      <div className={`inline-flex items-center gap-4 px-6 py-4 rounded-2xl font-medium ${statusColor}`}>
                        <span className="text-3xl">{statusIcon}</span>
                        <div>
                          <div className="text-xl">{project.status}</div>
                          {project.isDelayed && <div className="text-sm opacity-90">{Math.abs(project.daysToTarget)} days late</div>}
                          {project.isEarly && <div className="text-sm opacity-90">{project.daysToTarget} days early</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-10 py-8">
                      <div className="flex items-center gap-6">
                        <div className="flex-1 bg-slate-700 rounded-2xl h-14 overflow-hidden">
                          <div 
                            className={`h-full rounded-2xl transition-all duration-1000 ${
                              project.isComplete ? 'bg-gradient-to-r from-green-500 to-emerald-400' :
                              project.isDelayed ? 'bg-gradient-to-r from-red-600 to-red-500' :
                              project.isEarly ? 'bg-gradient-to-r from-emerald-500 to-teal-400' :
                              'bg-gradient-to-r from-blue-500 to-indigo-400'
                            }`}
                            style={{ width: `${project.percentComplete}%` }}
                          />
                        </div>
                        <span className="text-3xl font-extrabold text-white w-24 text-right">
                          {project.percentComplete}%
                        </span>
                      </div>
                    </td>
                    <td className="px-10 py-8 text-center">
                      <div className="text-2xl font-bold text-slate-200">
                        {project.completedSP.toFixed(1)} / {project.totalSP.toFixed(1)}
                      </div>
                      <div className="text-sm text-slate-500 mt-1">Story Points</div>
                    </td>
                    <td className="px-10 py-8">
                      <div className="flex items-center gap-6">
                        <input
                          type="date"
                          value={projectTargets[project.project] || ''}
                          onChange={(e) => {
                            const newTargets = { ...projectTargets };
                            if (e.target.value) {
                              newTargets[project.project] = e.target.value;
                            } else {
                              delete newTargets[project.project];
                            }
                            setProjectTargets(newTargets);
                          }}
                          className="px-6 py-4 bg-slate-700 border border-slate-600 rounded-2xl text-white text-lg focus:ring-4 focus:ring-blue-500 focus:border-blue-500 transition-all"
                        />
                        <span className="text-lg text-slate-300">
                          {new Date(project.effectiveEndDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// All other sections (OverviewSection, RiskSection, CapacitySection, SprintsSection, ProjectsSection, DataSection) remain exactly as in your previous full version.
// Paste them after this TimelineSection and before export default.

export default SprintDashboard;