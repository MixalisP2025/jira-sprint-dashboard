import React, { useState, useMemo, useEffect } from 'react';
import {
  Upload, Users, TrendingUp, CheckCircle, Clock, AlertCircle,
  Calendar, Home, LayoutDashboard, Shield, Briefcase, Database,
  Target, BarChart3, Edit3, X, Save, Filter, PieChart, Download, Mail, Copy, Check
} from 'lucide-react';
import {
  PieChart as RechartsPieChart, Pie, Cell,
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, Legend
} from 'recharts';
import KPICard from './components/KPICard';
import FilterPanel from './components/FilterPanel';
import JiraRefreshButton from './components/JiraRefreshButton';
import ServerStatus from './components/ServerStatus';
import SprintHealthTab from './components/SprintHealthTab';
import AllocationTab from './components/AllocationTab';
import CSRTicketsTab from './components/CSRTicketsTab';
import CSRAnalyticsTab from './components/CSRAnalyticsTab.jsx';
import {
  pingDB, saveIssuesToDB, loadIssuesFromDB,
  saveCapacityToDB, loadCapacityFromDB,
  saveSettingsToDB, loadSettingsFromDB,
} from './utils/dbSync';

// ─── Greek public holidays (fixed + Orthodox Easter) ─────────────────────────
function getGreekHolidays(year) {
  const fixed = [
    `${year}-01-01`, `${year}-01-06`, `${year}-03-25`, `${year}-05-01`,
    `${year}-08-15`, `${year}-10-28`, `${year}-12-25`, `${year}-12-26`,
  ];
  // Orthodox Easter via Meeus/Jones/Butcher (Julian → Gregorian +13 days)
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, month - 1, day + 13));
  const add = (dt, n) => { const x = new Date(dt); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const es = easter.toISOString().slice(0, 10);
  return new Set([...fixed, add(easter, -48), add(easter, -2), es, add(easter, 1), add(easter, 50)]);
}

function workingDaysBetween(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const start = new Date(startDate); start.setUTCHours(0, 0, 0, 0);
  const end   = new Date(endDate);   end.setUTCHours(0, 0, 0, 0);
  if (end <= start) return 0;
  const holidays = new Set();
  for (let y = start.getUTCFullYear(); y <= end.getUTCFullYear(); y++)
    getGreekHolidays(y).forEach(h => holidays.add(h));
  let count = 0;
  const cur = new Date(start); cur.setUTCDate(cur.getUTCDate() + 1);
  while (cur <= end) {
    const dow = cur.getUTCDay(), iso = cur.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

// Tooltip Component
const Tooltip = ({ children, content }) => {
  const [show, setShow] = useState(false);
  
  return (
    <div className="relative inline-block">
      <div 
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className="cursor-help"
      >
        {children}
      </div>
      {show && (
        <div className="absolute z-50 w-72 p-3 bg-slate-900 text-white text-xs rounded-lg shadow-xl -top-2 left-full ml-2">
          <div className="whitespace-pre-line">{content}</div>
          <div className="absolute right-full top-3 border-8 border-transparent border-r-slate-900"></div>
        </div>
      )}
    </div>
  );
};

const SprintDashboard = () => {
  // ============== STATE ==============
  const [data, setData] = useState([]);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [cachedData, setCachedData] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedSprint, setSelectedSprint] = useState('all');
  const [selectedAssignee, setSelectedAssignee] = useState('all');
  const [selectedProject, setSelectedProject] = useState('all');
  const [sprintDates, setSprintDates] = useState({});
  const [assigneeCaps, setAssigneeCaps] = useState({});
  const [sprintDaysConfig, setSprintDaysConfig] = useState({});
  const [programEndDate, setProgramEndDate] = useState('');
  const [projectTargets, setProjectTargets] = useState({});
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // NEW: Bulk capacity edit state
  const [showBulkCapacityEdit, setShowBulkCapacityEdit] = useState(false);
  const [selectedAssignees, setSelectedAssignees] = useState(new Set());
  const [bulkCapacityValue, setBulkCapacityValue] = useState('');
  
  // DB status: 'checking' | 'online' | 'offline'
  const [dbStatus, setDbStatus] = useState('checking');
  
  // ============== PERSIST SETTINGS ==============
  useEffect(() => {
    async function init() {
      // 1. Check DB connectivity
      const online = await pingDB();
      setDbStatus(online ? 'online' : 'offline');

      if (online) {
        // ── Load from Oracle ──────────────────────────────────────
        try {
          const [caps, settings, issues] = await Promise.all([
            loadCapacityFromDB(),
            loadSettingsFromDB(),
            loadIssuesFromDB(),
          ]);

          if (caps && Object.keys(caps).length > 0) setAssigneeCaps(caps);
          if (settings) {
            if (settings.sprintDaysConfig) setSprintDaysConfig(settings.sprintDaysConfig);
            if (settings.programEndDate)   setProgramEndDate(settings.programEndDate);
            if (settings.projectTargets)   setProjectTargets(settings.projectTargets);
          }
          if (Array.isArray(issues) && issues.length > 0) {
            setCachedData(issues);
            setData(issues);
          }
          // Always show current session load time
          setLastUpdated(new Date());
        } catch (e) {
          console.warn('DB load failed, falling back to localStorage:', e);
          loadFromLocalStorage();
        }
      } else {
        // ── Fallback: localStorage ────────────────────────────────
        loadFromLocalStorage();
      }
    }

    function loadFromLocalStorage() {
      try {
        const savedCaps = localStorage.getItem('assigneeCaps');
        if (savedCaps) setAssigneeCaps(JSON.parse(savedCaps));
        const savedDays = localStorage.getItem('sprintDaysConfig');
        if (savedDays) setSprintDaysConfig(JSON.parse(savedDays));
        const savedProgramEnd = localStorage.getItem('programEndDate');
        if (savedProgramEnd) setProgramEndDate(savedProgramEnd);
        const savedProjectTargets = localStorage.getItem('projectTargets');
        if (savedProjectTargets) setProjectTargets(JSON.parse(savedProjectTargets));
        const savedData = localStorage.getItem('cachedDashboardData');
        const savedTimestamp = localStorage.getItem('lastUpdatedTimestamp');
        if (savedData) {
          const parsed = JSON.parse(savedData);
          setCachedData(parsed);
          setData(parsed);
          // Always update to now when loading cached data — shows when data was last loaded into session
          setLastUpdated(new Date());
          localStorage.setItem('lastUpdatedTimestamp', new Date().toISOString());
        }
        if (!localStorage.getItem('cachedDashboardData') && savedTimestamp) setLastUpdated(new Date(savedTimestamp));
      } catch (e) {}
    }

    init();
  }, []);
  
  // Update clock every second
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem('assigneeCaps', JSON.stringify(assigneeCaps));
    if (dbStatus === 'online' && Object.keys(assigneeCaps).length > 0) {
      saveCapacityToDB(assigneeCaps).catch(() => {});
    }
  }, [assigneeCaps, dbStatus]);

  useEffect(() => {
    localStorage.setItem('sprintDaysConfig', JSON.stringify(sprintDaysConfig));
    if (dbStatus === 'online' && Object.keys(sprintDaysConfig).length > 0) {
      saveSettingsToDB({ sprintDaysConfig: JSON.parse(JSON.stringify(sprintDaysConfig)) }).catch(() => {});
    }
  }, [sprintDaysConfig, dbStatus]);

  useEffect(() => {
    if (programEndDate) {
      localStorage.setItem('programEndDate', programEndDate);
    } else {
      localStorage.removeItem('programEndDate');
    }
    if (dbStatus === 'online' && programEndDate) {
      saveSettingsToDB({ programEndDate }).catch(() => {});
    }
  }, [programEndDate, dbStatus]);

  useEffect(() => {
    localStorage.setItem('projectTargets', JSON.stringify(projectTargets));
    if (dbStatus === 'online' && Object.keys(projectTargets).length > 0) {
      saveSettingsToDB({ projectTargets: JSON.parse(JSON.stringify(projectTargets)) }).catch(() => {});
    }
  }, [projectTargets, dbStatus]);

  // ============== JIRA REFRESH HANDLER ==============
  const handleJiraRefresh = async (jiraData) => {
    try {
      console.log('=== HANDLE JIRA REFRESH DEBUG ===');
      console.log('Received jiraData:', jiraData);
      console.log('Type of jiraData:', typeof jiraData);
      console.log('Is Array:', Array.isArray(jiraData));
      console.log('Length:', jiraData?.length);
      
      // The jiraData should already be transformed by JiraRefreshButton
      // It should be an array of dashboard-formatted items
      if (!Array.isArray(jiraData)) {
        console.error('❌ jiraData is not an array!', jiraData);
        throw new Error('Invalid data format received from Jira refresh');
      }
      
      if (jiraData.length === 0) {
        console.warn('⚠️ Received empty array from Jira');
      } else {
        console.log('✅ Received', jiraData.length, 'items from Jira');
        console.log('First item sample:', {
          Key: jiraData[0].Key,
          Assignee: jiraData[0].Assignee,
          Status: jiraData[0].Status,
          'Story Points': jiraData[0]['Story Points'],
          Sprint: jiraData[0].Sprint,
          allKeys: Object.keys(jiraData[0])
        });
      }
      
      const timestamp = new Date();
      setData(jiraData);
      setLastUpdated(timestamp);
      setCachedData(jiraData);
      
      // NEW: Extract and set sprint dates for Timeline/Gantt chart
      if (window.jiraSprintDates && Object.keys(window.jiraSprintDates).length > 0) {
        console.log('✅ Setting sprint dates from Jira:', window.jiraSprintDates);
        setSprintDates(window.jiraSprintDates);
      } else {
        console.log('⚠️ No sprint dates found in window.jiraSprintDates, trying fallback extraction...');
        // Fallback: Extract dates from data
        const dates = {};
        jiraData.forEach(item => {
          const sprint = item['Sprint'] || item['G'] || '';
          if (sprint && !dates[sprint]) {
            const dateMatch = sprint.match(/(\d{2})-(\d{2})-(\d{2})\s+to\s+(\d{2})-(\d{2})-(\d{2})/);
            if (dateMatch) {
              const [_, startDay, startMonth, startYear, endDay, endMonth, endYear] = dateMatch;
              dates[sprint] = {
                start: `${startMonth}/${startDay}/20${startYear}`,
                end: `${endMonth}/${endDay}/20${endYear}`
              };
            }
          }
        });
        
        if (Object.keys(dates).length > 0) {
          console.log('✅ Extracted sprint dates from sprint names:', dates);
          setSprintDates(dates);
        } else {
          console.warn('⚠️ No sprint dates could be extracted from data');
        }
      }
      
      // Save to localStorage
      localStorage.setItem('cachedDashboardData', JSON.stringify(jiraData));
      localStorage.setItem('lastUpdatedTimestamp', timestamp.toISOString());
      
      // Save to Oracle DB (fire-and-forget, don't block UI)
      if (dbStatus === 'online') {
        saveIssuesToDB(jiraData).catch(e => console.warn('DB save issues failed:', e));
        saveSettingsToDB({ lastUpdated: timestamp.toISOString() }).catch(() => {});
      }
      
      console.log('✅ Data state updated with', jiraData.length, 'items');
      console.log('=== HANDLE JIRA REFRESH END ===');
    } catch (error) {
      console.error('❌ Error handling Jira refresh:', error);
      throw error;
    }
  };
  
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
      const sprint = item['Sprint'] || 
                     item['G'] || 
                     item['Custom field (Sprint)'] || 
                     item['Sprints'] ||
                     item['Sprint Name'] ||
                     '';
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

  // FIXED: Enhanced Greek encoding detection with UTF-16 support
  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const buffer = await file.arrayBuffer();
      let text;
      let successfulEncoding = null;

      // Check for BOM and UTF-16
      const bytes = new Uint8Array(buffer);
      
      // UTF-16 LE BOM
      if (bytes[0] === 0xFF && bytes[1] === 0xFE) {
        const decoder = new TextDecoder('utf-16le');
        text = decoder.decode(buffer);
        successfulEncoding = 'UTF-16LE';
        console.log('✅ Detected UTF-16LE with BOM');
      }
      // UTF-16 BE BOM
      else if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
        const decoder = new TextDecoder('utf-16be');
        text = decoder.decode(buffer);
        successfulEncoding = 'UTF-16BE';
        console.log('✅ Detected UTF-16BE with BOM');
      }
      // UTF-8 BOM
      else if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
        const decoder = new TextDecoder('utf-8');
        text = decoder.decode(buffer);
        successfulEncoding = 'UTF-8 with BOM';
        console.log('✅ Detected UTF-8 with BOM');
      }
      
      // If no BOM detected, try encodings
      if (!text) {
        const encodings = [
          { name: 'utf-16le', label: 'UTF-16LE (no BOM)' },
          { name: 'utf-16be', label: 'UTF-16BE (no BOM)' },
          { name: 'windows-1253', label: 'Windows-1253 (Greek)' },
          { name: 'utf-8', label: 'UTF-8' },
          { name: 'iso-8859-7', label: 'ISO-8859-7 (Greek)' },
          { name: 'windows-1252', label: 'Windows-1252' }
        ];

        for (const encoding of encodings) {
          try {
            const decoder = new TextDecoder(encoding.name, { fatal: false });
            const decoded = decoder.decode(buffer);
            
            const sample = decoded.substring(0, 500);
            const hasValidContent = /[a-zA-Z0-9]/.test(sample);
            // Fixed: Use Unicode escape instead of literal replacement character
            const replacementCount = (sample.match(/\uFFFD/g) || []).length;
            
            if (hasValidContent && replacementCount < 10) {
              text = decoded;
              successfulEncoding = encoding.label;
              console.log(`✅ Successfully decoded using ${encoding.label}`);
              break;
            }
          } catch (err) {
            continue;
          }
        }
      }

      if (!text) {
        console.log('Using Windows-1252 fallback');
        const decoder = new TextDecoder('windows-1252', { fatal: false });
        text = decoder.decode(buffer);
        successfulEncoding = 'Windows-1252 (Fallback)';
      }

      const parsedData = parseJiraText(text);
      
      if (parsedData.length === 0) {
        throw new Error('No data parsed. Check file format.');
      }
      
      const timestamp = new Date();
      setData(parsedData);
      setLastUpdated(timestamp);
      setCachedData(parsedData);
      
      // Save to localStorage
      localStorage.setItem('cachedDashboardData', JSON.stringify(parsedData));
      localStorage.setItem('lastUpdatedTimestamp', timestamp.toISOString());
      
      // Save to Oracle DB
      if (dbStatus === 'online') {
        saveIssuesToDB(parsedData).catch(e => console.warn('DB save issues failed:', e));
        saveSettingsToDB({ lastUpdated: timestamp.toISOString() }).catch(() => {});
      }
      
      console.log(`✅ Loaded ${parsedData.length} items with ${successfulEncoding}`);
      alert(`Loaded ${parsedData.length} items\n${successfulEncoding}`);
      
    } catch (err) {
      console.error('Error:', err);
      alert(`Failed: ${err.message}`);
    }
  };

  const handleGoHome = () => {
    setData([]);
    setSelectedSprint('all');
    setSelectedAssignee('all');
    setSelectedProject('all');
    setActiveTab('overview');
  };

  const handleProjectClick = (projectName) => {
    setSelectedProject(projectName);
    setActiveTab('overview');
  };

  // NEW: Bulk capacity edit handlers
  const handleSelectAllAssignees = (assigneeList) => {
    if (selectedAssignees.size === assigneeList.length) {
      setSelectedAssignees(new Set());
    } else {
      setSelectedAssignees(new Set(assigneeList));
    }
  };

  const handleToggleAssignee = (assignee) => {
    const newSelected = new Set(selectedAssignees);
    if (newSelected.has(assignee)) {
      newSelected.delete(assignee);
    } else {
      newSelected.add(assignee);
    }
    setSelectedAssignees(newSelected);
  };

  const handleBulkCapacityUpdate = () => {
    if (selectedAssignees.size === 0) {
      alert('Please select at least one assignee');
      return;
    }
    
    const capacity = parseInt(bulkCapacityValue);
    if (isNaN(capacity) || capacity < 0) {
      alert('Please enter a valid capacity value (0 or greater)');
      return;
    }

    const updatedCaps = { ...assigneeCaps };
    selectedAssignees.forEach(assignee => {
      updatedCaps[assignee] = capacity;
    });

    setAssigneeCaps(updatedCaps);
    setSelectedAssignees(new Set());
    setBulkCapacityValue('');
    setShowBulkCapacityEdit(false);
    alert(`Successfully updated sprint capacity for ${selectedAssignees.size} assignee(s) to ${capacity}`);
  };

  // ============== COMPUTED DATA ==============
  const sprints = useMemo(() => {
    const set = new Set();
    data.forEach(item => {
      const sprint = item['Sprint'] || 
                     item['G'] || 
                     item['Custom field (Sprint)'] || 
                     item['Sprints'] ||
                     item['Sprint Name'] ||
                     '';
      if (sprint) {
        // Handle multi-sprint issues (comma-separated)
        if (sprint.includes(',')) {
          sprint.split(',').forEach(s => {
            const trimmed = s.trim();
            if (trimmed) set.add(trimmed);
          });
        } else {
          set.add(sprint);
        }
      }
    });
    const arr = Array.from(set);
    arr.sort((a, b) => {
      const na = (a && (a.match(/(\d+)/) || [])[1]) || null;
      const nb = (b && (b.match(/(\d+)/) || [])[1]) || null;
      if (na && nb) return Number(nb) - Number(na);
      return b.localeCompare(a);
    });
    // Add Backlog option if any items have no sprint
    const hasBacklog = data.some(item => {
      const s = item['Sprint'] || item['G'] || item['Custom field (Sprint)'] || item['Sprints'] || item['Sprint Name'] || '';
      return !s.trim();
    });
    return ['all', ...(hasBacklog ? ['backlog'] : []), ...arr];
  }, [data]);

  const assignees = useMemo(() => {
    // HARDCODED: Exclude specific assignees from dropdowns
    const EXCLUDED_ASSIGNEES = ['Sotiris Mavrogianneas', 'Sofia Boustantzi'];
    
    const set = new Set();
    data.forEach(item => {
      const assignee = item['Assignee'] || item['D'] || '';
      if (assignee && !EXCLUDED_ASSIGNEES.includes(assignee)) {
        set.add(assignee);
      }
    });
    return ['all', ...Array.from(set).sort()];
  }, [data]);

  // Projects extractor
  const projects = useMemo(() => {
    const set = new Set();
    data.forEach(item => {
      const project = item['Project'] || item['B'] || '';
      if (project) set.add(project);
    });
    const projectList = ['all', ...Array.from(set).sort()];
    console.log('📊 Projects extracted from data:', projectList);
    return projectList;
  }, [data]);

  const filteredData = useMemo(() => {
    // HARDCODED: Exclude specific assignees from all screens
    const EXCLUDED_ASSIGNEES = ['Sotiris Mavrogianneas', 'Sofia Boustantzi'];
    
    return data.filter(item => {
      const sprint = item['Sprint'] || 
                     item['G'] || 
                     item['Custom field (Sprint)'] || 
                     item['Sprints'] ||
                     item['Sprint Name'] ||
                     '';
      
      const assignee = item['Assignee'] || item['D'] || '';
      const project = item['Project'] || item['B'] || '';
      
      // Exclude hardcoded assignees
      if (EXCLUDED_ASSIGNEES.includes(assignee)) {
        return false;
      }
      
      let sprintMatch = selectedSprint === 'all';
      if (!sprintMatch && selectedSprint === 'backlog') {
        sprintMatch = !sprint.trim(); // items with no sprint
      } else if (!sprintMatch && sprint) {
        if (sprint.includes(',')) {
          sprintMatch = sprint.split(',').some(s => s.trim() === selectedSprint);
        } else {
          sprintMatch = sprint === selectedSprint;
        }
      }
      
      const assigneeMatch = selectedAssignee === 'all' || assignee === selectedAssignee;
      const projectMatch = selectedProject === 'all' || project === selectedProject;
      
      return sprintMatch && assigneeMatch && projectMatch;
    });
  }, [data, selectedSprint, selectedAssignee, selectedProject]);

  // UPDATED: CRITICAL FIX - New capacity model with Active Workload only
  const stats = useMemo(() => {
    console.log('🔍 ===== STATS CALCULATION START =====');
    console.log('filteredData length:', filteredData.length);
    console.log('selectedSprint:', selectedSprint);
    console.log('selectedAssignee:', selectedAssignee);
    console.log('selectedProject:', selectedProject);
    
    // CRITICAL FIX: Auto-update capacity configuration with correct names from Jira
    const jiraAssigneeNames = new Set();
    filteredData.forEach(item => {
      const assignee = item['Assignee'] || item['D'];
      if (assignee && assignee !== 'Unassigned') {
        jiraAssigneeNames.add(assignee);
      }
    });
    
    // Check for name mismatches and auto-fix
    const updatedCaps = { ...assigneeCaps };
    let needsUpdate = false;
    
    // Add any new assignees from Jira with default capacity
    jiraAssigneeNames.forEach(jiraName => {
      if (!updatedCaps[jiraName]) {
        updatedCaps[jiraName] = 16; // Default capacity
        needsUpdate = true;
        console.log(`✨ Auto-added new assignee: "${jiraName}" with 16 SP capacity`);
      }
    });
    
    // Update state if needed (handled by useEffect outside this useMemo)

    // Use updated caps for this calculation
    const capsToUse = { ...assigneeCaps, ...updatedCaps };

    // ── Holiday capacity multiplier ───────────────────────────────────────────
    // Base capacity (stored in DB) is for a full sprint with no holidays.
    // When a sprint has public holidays, effective capacity is reduced proportionally.
    // assigneeCaps stores the BASE — stats.sprintCapacity reflects the effective value.
    let holidayCapacityMultiplier = 1;
    if (selectedSprint && selectedSprint !== 'all' && sprintDates[selectedSprint]) {
      const sd = sprintDates[selectedSprint];
      const [sm, sday, sy] = sd.start.split('/');
      const [em, eday, ey] = sd.end.split('/');
      const sprintStart = new Date(`${sy}-${sm.padStart(2,'0')}-${sday.padStart(2,'0')}T00:00:00Z`);
      const sprintEnd   = new Date(`${ey}-${em.padStart(2,'0')}-${eday.padStart(2,'0')}T00:00:00Z`);
      const totalWorkingDays = workingDaysBetween(sprintStart, sprintEnd);
      if (totalWorkingDays > 0) {
        const allHolidays = new Set();
        for (let y = sprintStart.getFullYear(); y <= sprintEnd.getFullYear(); y++)
          getGreekHolidays(y).forEach(h => allHolidays.add(h));
        let holidaysInSprint = 0;
        const cur = new Date(sprintStart); cur.setDate(cur.getDate() + 1);
        while (cur <= sprintEnd) {
          const dow = cur.getDay(), iso = cur.toISOString().slice(0, 10);
          if (dow !== 0 && dow !== 6 && allHolidays.has(iso)) holidaysInSprint++;
          cur.setDate(cur.getDate() + 1);
        }
        if (holidaysInSprint > 0)
          holidayCapacityMultiplier = (totalWorkingDays - holidaysInSprint) / totalWorkingDays;
      }
    }

    // ── Time-elapsed capacity multiplier ─────────────────────────────────────
    // Effective capacity = base × (daysRemaining / totalDays)
    // This reflects how much of the sprint is still ahead of us.
    // Only applies when a specific sprint is selected and we're mid-sprint.
    let timeElapsedMultiplier = 1;
    if (selectedSprint && selectedSprint !== 'all' && sprintDates[selectedSprint]) {
      const sd = sprintDates[selectedSprint];
      const [sm, sday, sy] = sd.start.split('/');
      const [em, eday, ey] = sd.end.split('/');
      const sprintStart = new Date(`${sy}-${sm.padStart(2,'0')}-${sday.padStart(2,'0')}T00:00:00Z`);
      const sprintEnd   = new Date(`${ey}-${em.padStart(2,'0')}-${eday.padStart(2,'0')}T00:00:00Z`);
      // Use day-before-start so workingDaysBetween (exclusive of start) includes the sprint start day
      const dayBeforeStart = new Date(sprintStart); dayBeforeStart.setUTCDate(dayBeforeStart.getUTCDate() - 1);
      const todayLocal2 = new Date();
      const today = new Date(`${todayLocal2.getFullYear()}-${String(todayLocal2.getMonth()+1).padStart(2,'0')}-${String(todayLocal2.getDate()).padStart(2,'0')}T00:00:00Z`);
      const totalDays     = workingDaysBetween(dayBeforeStart, sprintEnd);   // includes sprint start day
      const elapsedDays   = Math.max(0, Math.min(workingDaysBetween(dayBeforeStart, today), totalDays)); // includes today
      const daysRemaining = Math.max(0, totalDays - elapsedDays);
      if (totalDays > 0 && daysRemaining < totalDays) {
        timeElapsedMultiplier = daysRemaining / totalDays;
      }
    }
    
    // DEBUG: Show first 10 items to see what we're working with
    if (filteredData.length > 0) {
      console.log('📋 First 10 items in filteredData:');
      filteredData.slice(0, 10).forEach((item, index) => {
        const assignee = item['Assignee'] || item['D'] || 'Unassigned';
        const status = item['Status'] || '';
        const sp = item['Story Points'];
        const sprint = item['Sprint'] || item['G'] || '';
        console.log(`  [${index}] ${item.Key}: ${assignee} | Sprint: ${sprint} | Status: ${status} | SP: ${sp}`);
      });
      
      // DEBUG: Count items per assignee
      const itemsPerAssignee = {};
      const spPerAssignee = {};
      filteredData.forEach(item => {
        const assignee = item['Assignee'] || item['D'] || 'Unassigned';
        const sp = parseFloat(item['Story Points']) || 0;
        itemsPerAssignee[assignee] = (itemsPerAssignee[assignee] || 0) + 1;
        spPerAssignee[assignee] = (spPerAssignee[assignee] || 0) + sp;
      });
      
      console.log('\n📊 Items per assignee in filteredData:');
      Object.entries(itemsPerAssignee)
        .sort((a, b) => b[1] - a[1])
        .forEach(([name, count]) => {
          console.log(`  ${name}: ${count} items, ${spPerAssignee[name].toFixed(1)} total SP`);
        });
    }
    
    const byAssignee = {};
    
    filteredData.forEach((item, index) => {
      const assignee = item['Assignee'] || item['D'] || 'Unassigned';
      
      // DEBUG: Track unique assignees
      if (!window.assigneeDebug) window.assigneeDebug = new Set();
      if (!window.assigneeDebug.has(assignee)) {
        window.assigneeDebug.add(assignee);
        console.log(`👤 NEW ASSIGNEE FOUND: "${assignee}"`);
      }
      
      if (!byAssignee[assignee]) {
        byAssignee[assignee] = {
          // Capacity relevant metrics
          // timeElapsedMultiplier already accounts for holidays (workingDaysBetween excludes them)
          // so we don't apply holidayCapacityMultiplier separately to avoid double-counting
          sprintCapacity: Math.round((capsToUse[assignee] || 16) * timeElapsedMultiplier * 10) / 10,
          activeWorkload: 0,  // NEW: Only To Do + In Progress
          remainingCapacity: 0,
          
          // Status based on remaining capacity (no percentages)
          capacityStatus: 'Has Capacity',
          pmGuidance: '',
          
          // Completed/awaiting work (transparency only)
          completedWorkload: 0,  // Done
          awaitingWorkload: 0,   // Awaiting Testing + Awaiting Versioning
          
          // Totals for transparency
          totalStoryPoints: 0,
          totalCompletedSP: 0,
          
          // Counts
          activeItems: 0,
          completedItems: 0,
          awaitingItems: 0,
          
          // Issue type counts
          stories: 0,
          bugs: 0,
          tasks: 0,
          subtasks: 0,
          
          // Time tracking
          timeBasedActiveSP: 0,
          timeBasedCompletedSP: 0,
          
          items: [],
        };
      }

      const type = item['Issue Type'];
      if (type === 'Story') byAssignee[assignee].stories++;
      else if (type === 'Bug') byAssignee[assignee].bugs++;
      else if (type === 'Task' || type === 'Sub-task') byAssignee[assignee].tasks++;
      else if (type === 'Epic') byAssignee[assignee].epics++;

      const status = item['Status'] || '';
      
      // Get Story Points with comprehensive logging
      const sp = parseFloat(item['Story Points']) || 
                 parseFloat(item['Story points']) ||
                 parseFloat(item['Custom field (Story Points)']) ||
                 parseFloat(item['Story Point Estimate']) ||
                 parseFloat(item['Σ Story Points']) ||
                 parseFloat(item['Story Point']) ||
                 0;
      
      // DEBUG: Log items with story points for first 30 items
      if (index < 30 && sp > 0) {
        console.log(`💎 Item ${index} HAS SP:`, {
          key: item.Key,
          assignee: assignee,
          status: status,
          sp: sp,
          rawSP: item['Story Points'],
          allSPFields: {
            'Story Points': item['Story Points'],
            'Story points': item['Story points'],
            'Custom field (Story Points)': item['Custom field (Story Points)']
          }
        });
      }
      
      // DEBUG: Log ALL items for specific assignees to see why they have 0 SP
      if (assignee === 'Tasos Hatzimpogos' || assignee === 'Panagiota Gidakou' || assignee === 'Tania Strati') {
        if (index < 5) {
          console.log(`🔍 DEBUG ${assignee} item:`, {
            key: item.Key,
            status: status,
            sprint: item['Sprint'] || item['G'],
            'Story Points': item['Story Points'],
            'Story points': item['Story points'],
            allKeys: Object.keys(item).filter(k => k.toLowerCase().includes('story') || k.toLowerCase().includes('point'))
          });
        }
      }
      
      // Time tracking (for transparency)
      const timeEstimateSeconds = parseFloat(item['Original Estimate']) || 0;
      const SECONDS_PER_SP = 4 * 3600; // 4 hours per SP
      const timeSP = timeEstimateSeconds > 0 ? timeEstimateSeconds / SECONDS_PER_SP : 0;

      // CRITICAL DEBUG: Log all unique status values
      if (!window.jiraStatusDebug) window.jiraStatusDebug = new Set();
      if (status && !window.jiraStatusDebug.has(status)) {
        window.jiraStatusDebug.add(status);
        console.log(`🔍 NEW STATUS FOUND: "${status}"`);
      }

      // CRITICAL FIX: Enhanced status matching to handle Jira variations
      const statusLower = status.toLowerCase();
      let statusCategory = 'unknown';
      
      if (status === 'To Do' || status === 'In Progress' || 
          statusLower === 'to do' || statusLower === 'in progress' ||
          statusLower === 'open' || statusLower === 'new' || statusLower === 'reopened') {
        // This work is ACTIVE and consumes capacity
        byAssignee[assignee].activeWorkload += sp;
        byAssignee[assignee].activeItems++;
        statusCategory = 'active';
        
        if (timeSP > 0 && (type === 'Sub-task' || type === 'Task')) {
          byAssignee[assignee].timeBasedActiveSP += timeSP;
        }
      } 
      // COMPLETED/DOWNSTREAM work is EXCLUDED from capacity
      else if (status === 'Done' || statusLower === 'done' || 
               statusLower === 'closed' || statusLower === 'resolved' || statusLower === 'complete') {
        byAssignee[assignee].completedWorkload += sp;
        byAssignee[assignee].completedItems++;
        byAssignee[assignee].totalCompletedSP += sp;
        statusCategory = 'completed';
        
        if (timeSP > 0 && (type === 'Sub-task' || type === 'Task')) {
          byAssignee[assignee].timeBasedCompletedSP += timeSP;
        }
      }
      else if (status === 'Awaiting Testing' || status === 'Awaiting Versioning' ||
               statusLower.includes('awaiting') || statusLower.includes('testing') || statusLower.includes('review')) {
        byAssignee[assignee].awaitingWorkload += sp;
        byAssignee[assignee].awaitingItems++;
        statusCategory = 'awaiting';
      }
      else {
        // DEFAULT: Unknown statuses treated as active (conservative approach)
        byAssignee[assignee].activeWorkload += sp;
        byAssignee[assignee].activeItems++;
        statusCategory = 'active (default)';
        console.warn(`⚠️ Unknown status "${status}" treated as active`);
      }

      // Debug status categorization for items with story points
      if (sp > 0 && index < 50) {
        console.log(`📋 ${item.Key || item['Issue key']}: ${assignee} | Status: "${status}" → ${statusCategory} | SP: ${sp}`);
      }

      // Track total for transparency
      if (sp > 0) {
        byAssignee[assignee].totalStoryPoints += sp;
      }

      byAssignee[assignee].items.push(item);
    });

    // Calculate capacity metrics and status
    Object.keys(byAssignee).forEach(assignee => {
      const d = byAssignee[assignee];
      
      // NEW: Add time-based work to active workload if it's active
      d.activeWorkload += d.timeBasedActiveSP;
      
      // CRITICAL: Remaining capacity calculation
      d.remainingCapacity = d.sprintCapacity - d.activeWorkload;
      
      // NEW: Simplified status logic based only on remaining capacity
      if (d.remainingCapacity > 0) {
        d.capacityStatus = 'Has Capacity';
        d.pmGuidance = `✅ Has capacity — ${d.remainingCapacity.toFixed(1)} SP available`;
      } else if (d.remainingCapacity === 0) {
        d.capacityStatus = 'Fully Allocated';
        d.pmGuidance = '🟡 Fully allocated — no buffer';
      } else {
        d.capacityStatus = 'Overloaded';
        d.pmGuidance = `❌ Overloaded — reduce scope by ${Math.abs(d.remainingCapacity).toFixed(1)} SP`;
      }
    });

    // CAPACITY SUMMARY LOG
    console.log('\n✅ ===== CAPACITY SUMMARY =====');
    console.log('Total assignees in byAssignee:', Object.keys(byAssignee).length);
    
    // Show ALL assignees first with their exact names
    console.log('\n📊 ALL ASSIGNEES (exact names from Jira):');
    Object.entries(byAssignee)
      .sort((a, b) => b[1].totalStoryPoints - a[1].totalStoryPoints)
      .forEach(([assignee, data]) => {
        console.log(`  "${assignee}": ${data.items.length} items, ${data.totalStoryPoints.toFixed(1)} total SP, ${data.activeWorkload.toFixed(1)} active, ${data.completedWorkload.toFixed(1)} completed`);
      });
    
    // Show capacity configuration
    console.log('\n⚙️ CAPACITY CONFIGURATION (using capsToUse):');
    Object.entries(capsToUse).forEach(([name, cap]) => {
      const hasData = byAssignee[name] !== undefined;
      console.log(`  "${name}": ${cap} SP ${hasData ? '✅ HAS DATA' : '❌ NO DATA (name mismatch?)'}`);
    });
    
    // Show only those with story points
    console.log('\n💎 ASSIGNEES WITH STORY POINTS:');
    Object.entries(byAssignee)
      .filter(([name, data]) => data.totalStoryPoints > 0)
      .sort((a, b) => b[1].totalStoryPoints - a[1].totalStoryPoints)
      .forEach(([assignee, data]) => {
        console.log(`"${assignee}":`, {
          capacity: data.sprintCapacity,
          active: data.activeWorkload.toFixed(1),
          completed: data.completedWorkload.toFixed(1),
          awaiting: data.awaitingWorkload.toFixed(1),
          remaining: data.remainingCapacity.toFixed(1),
          status: data.capacityStatus
        });
      });
    console.log('===== END CAPACITY SUMMARY =====\n');

    return byAssignee;
  }, [filteredData, assigneeCaps, selectedSprint, sprintDates]);

  // Auto-add new assignees from Jira with default capacity
  useEffect(() => {
    const jiraAssigneeNames = new Set();
    data.forEach(item => {
      const assignee = item['Assignee'] || item['D'];
      if (assignee && assignee !== 'Unassigned') {
        jiraAssigneeNames.add(assignee);
      }
    });

    const newCaps = {};
    let hasNew = false;
    jiraAssigneeNames.forEach(name => {
      if (!assigneeCaps[name]) {
        newCaps[name] = 16;
        hasNew = true;
      }
    });

    if (hasNew) {
      setAssigneeCaps(prev => ({ ...prev, ...newCaps }));
    }
  }, [data]);

  const sprintTimeline = useMemo(() => {
    if (selectedSprint === 'all') return null;
    const dates = sprintDates[selectedSprint];
    if (!dates) return null;

    // Use UTC date to avoid timezone offset shifting the day count (Greece = UTC+3)
    const todayLocal = new Date();
    const today = new Date(`${todayLocal.getFullYear()}-${String(todayLocal.getMonth()+1).padStart(2,'0')}-${String(todayLocal.getDate()).padStart(2,'0')}T00:00:00Z`);

    const [startMonth, startDay, startYear] = dates.start.split('/');
    const [endMonth, endDay, endYear] = dates.end.split('/');

    const startDate = new Date(`${startYear}-${startMonth.padStart(2,'0')}-${startDay.padStart(2,'0')}T00:00:00Z`);
    const endDate   = new Date(`${endYear}-${endMonth.padStart(2,'0')}-${endDay.padStart(2,'0')}T00:00:00Z`);

    // Use day-before-start so workingDaysBetween (exclusive of start) includes the sprint start day
    const dayBeforeStart = new Date(startDate); dayBeforeStart.setUTCDate(dayBeforeStart.getUTCDate() - 1);
    const defaultDays = workingDaysBetween(dayBeforeStart, endDate);
    const configuredDays = sprintDaysConfig[selectedSprint] || defaultDays;

    const elapsedDays = Math.max(0, Math.min(workingDaysBetween(dayBeforeStart, today), configuredDays));
    const currentDay = Math.min(elapsedDays, configuredDays); // elapsedDays now includes today
    const daysRemaining = Math.max(0, configuredDays - elapsedDays);
    const percentTimeElapsed = Math.min(100, Math.max(0, configuredDays > 0 ? Math.round((elapsedDays / configuredDays) * 100) : 0));

    return {
      startDate: dates.start,
      endDate: dates.end,
      elapsedDays: currentDay,
      totalDays: configuredDays,
      daysRemaining,
      percentTimeElapsed,
      isConfigured: !!sprintDaysConfig[selectedSprint]
    };
  }, [selectedSprint, sprintDates, sprintDaysConfig]);

  // Compute Greek public holidays within the selected sprint for capacity warning
  const sprintHolidays = useMemo(() => {
    if (!selectedSprint || selectedSprint === 'all' || !sprintDates[selectedSprint]) return [];
    const sd = sprintDates[selectedSprint];
    const [sm, sday, sy] = sd.start.split('/');
    const [em, eday, ey] = sd.end.split('/');
    const sprintStart = new Date(`${sy}-${sm.padStart(2,'0')}-${sday.padStart(2,'0')}T00:00:00Z`);
    const sprintEnd   = new Date(`${ey}-${em.padStart(2,'0')}-${eday.padStart(2,'0')}T00:00:00Z`);

    const allHolidays = new Set();
    for (let y = sprintStart.getFullYear(); y <= sprintEnd.getFullYear(); y++)
      getGreekHolidays(y).forEach(h => allHolidays.add(h));

    const names = {
      '01-01': 'New Year\'s Day', '01-06': 'Epiphany', '03-25': 'Independence Day',
      '05-01': 'Labour Day', '08-15': 'Assumption of Mary', '10-28': 'Ohi Day',
      '12-25': 'Christmas Day', '12-26': 'Second Day of Christmas',
    };
    const found = [];
    const cur = new Date(sprintStart); cur.setDate(cur.getDate() + 1);
    while (cur <= sprintEnd) {
      const dow = cur.getDay(), iso = cur.toISOString().slice(0, 10);
      if (dow !== 0 && dow !== 6 && allHolidays.has(iso)) {
        const mmdd = iso.slice(5);
        found.push({ date: iso, name: names[mmdd] || 'Public Holiday' });
      }
      cur.setDate(cur.getDate() + 1);
    }
    return found;
  }, [selectedSprint, sprintDates]);

  // Sprint Health Summary - UPDATED with new model
  const sprintHealthSummary = useMemo(() => {
    if (selectedSprint === 'all') return null;
    
    const totalCapacity = Object.values(stats).reduce((sum, s) => sum + s.sprintCapacity, 0);
    const activeWorkload = Object.values(stats).reduce((sum, s) => sum + s.activeWorkload, 0);
    const remainingCapacity = totalCapacity - activeWorkload;
    
    let healthStatus = '';
    let healthMessage = '';
    let healthColor = '';
    
    if (remainingCapacity > 0) {
      healthStatus = 'Has Capacity';
      healthMessage = `Sprint has ${remainingCapacity.toFixed(1)} SP available capacity. Active workload is ${activeWorkload.toFixed(1)} SP.`;
      healthColor = 'text-green-700 bg-green-50 border-green-300';
    } else if (remainingCapacity === 0) {
      healthStatus = 'Fully Allocated';
      healthMessage = 'Sprint is fully allocated with no buffer for additional work.';
      healthColor = 'text-amber-700 bg-amber-50 border-amber-300';
    } else {
      healthStatus = 'Overloaded';
      healthMessage = `Sprint is overloaded by ${Math.abs(remainingCapacity).toFixed(1)} SP. Scope reduction required.`;
      healthColor = 'text-red-700 bg-red-50 border-red-300';
    }
    
    return {
      status: healthStatus,
      message: healthMessage,
      color: healthColor,
      totalCapacity: totalCapacity.toFixed(1),
      activeWorkload: activeWorkload.toFixed(1),
      remainingCapacity: remainingCapacity.toFixed(1)
    };
  }, [selectedSprint, stats]);

  const riskRegister = useMemo(() => {
    const risks = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const assigneeStatus = {};
    Object.entries(stats).forEach(([assignee, s]) => {
      assigneeStatus[assignee] = s.capacityStatus;
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

      const statusVal = assigneeStatus[assignee] || 'Has Capacity';

      if (targetEndDate && daysLate > 0 && status !== 'Done') {
        risks.push({ issueKey, project, assignee, riskLevel: 'High', reason: `Overdue by ${daysLate} day${daysLate !== 1 ? 's' : ''}`, daysLate, status, sp, sprint });
      } else if (statusVal === 'Overloaded' && (status === 'To Do' || status === 'In Progress')) {
        risks.push({ issueKey, project, assignee, riskLevel: 'High', reason: `Assignee overloaded (${stats[assignee]?.activeWorkload?.toFixed(1) || 0} SP active work)`, daysLate, status, sp, sprint });
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
        const targetEnd = new Date(`${endYear}-${endMonth.padStart(2,'0')}-${endDay.padStart(2,'0')}T00:00:00Z`);
        const todayUTC  = new Date(today.toISOString().slice(0,10) + 'T00:00:00Z');
        daysRemaining = workingDaysBetween(todayUTC, targetEnd);
        if (targetEnd < todayUTC) daysRemaining = -Math.abs(workingDaysBetween(targetEnd, todayUTC));
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
    console.log('🗓️ === TIMELINE DATA CALCULATION START ===');
    console.log('Total data items:', data.length);
    console.log('Available sprint dates:', Object.keys(sprintDates).length);
    console.log('Sprint dates:', sprintDates);
    
    if (data.length === 0) {
      console.log('❌ No data available for timeline');
      return [];
    }

    const projectMap = {};

    data.forEach((item, index) => {
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

      const sp = parseFloat(item['Story Points']) || 
                 parseFloat(item['Story points']) ||
                 parseFloat(item['Custom field (Story Points)']) ||
                 0;
      projectMap[project].totalSP += sp;
      projectMap[project].items++;

      if (status === 'Done') {
        projectMap[project].completedSP += sp;
        projectMap[project].doneItems++;
      }
      
      // Debug first few items per project
      if (projectMap[project].items <= 3) {
        console.log(`  ${project} - Item ${projectMap[project].items}:`, {
          sprint,
          status,
          sp,
          hasSprintDate: !!sprintDates[sprint]
        });
      }
    });

    console.log('📊 Projects found:', Object.keys(projectMap).length);
    Object.entries(projectMap).forEach(([name, proj]) => {
      console.log(`  ${name}: ${proj.sprints.size} sprints, ${proj.items} items, ${proj.totalSP.toFixed(1)} SP`);
    });

    const timeline = Object.values(projectMap).map(p => {
      let minStart = null;
      let maxEnd = null;

      p.sprints.forEach(sprint => {
        const dates = sprintDates[sprint];
        if (dates) {
          const start = new Date(dates.start);
          const end = new Date(dates.end);

          if (!minStart || start < minStart) minStart = start;
          if (!maxEnd || end > maxEnd) maxEnd = end;
        }
      });

      const percentComplete = p.totalSP > 0
        ? (p.completedSP / p.totalSP) * 100
        : p.items > 0 ? (p.doneItems / p.items) * 100 : 0;

      const result = {
        ...p,
        startDate: minStart ? minStart.toISOString().split('T')[0] : null,
        endDate: maxEnd ? maxEnd.toISOString().split('T')[0] : null,
        percentComplete: Math.round(percentComplete),
        targetEndDate: projectTargets[p.project] || (maxEnd ? maxEnd.toISOString().split('T')[0] : null),
        sprints: Array.from(p.sprints) // Convert Set to Array for logging
      };
      
      console.log(`  ${p.project} timeline:`, {
        startDate: result.startDate,
        endDate: result.endDate,
        percentComplete: result.percentComplete,
        sprintCount: result.sprints.length,
        hasStartDate: !!minStart,
        hasEndDate: !!maxEnd
      });

      return result;
    }).filter(p => {
      const hasValidDates = p.startDate && p.endDate;
      if (!hasValidDates) {
        console.log(`⚠️  Filtered out ${p.project}: missing dates (start: ${p.startDate}, end: ${p.endDate})`);
      }
      return hasValidDates;
    }).sort((a, b) => new Date(a.endDate) - new Date(b.endDate));

    console.log('✅ Final timeline items:', timeline.length);
    console.log('🗓️ === TIMELINE DATA CALCULATION END ===\n');

    return timeline;
  }, [data, sprintDates, projectTargets]);

  // UPDATED: Metrics based on new capacity model
  const totalSP = Object.values(stats).reduce((sum, s) => sum + s.totalStoryPoints, 0);
  const completedSP = Object.values(stats).reduce((sum, s) => sum + s.totalCompletedSP, 0);
  const activeWorkload = Object.values(stats).reduce((sum, s) => sum + s.activeWorkload, 0);
  const awaitingWorkload = Object.values(stats).reduce((sum, s) => sum + s.awaitingWorkload, 0);
  const completionRate = totalSP > 0 ? Math.round((completedSP / totalSP) * 100) : 0;
  const highRisks = riskRegister.filter(r => r.riskLevel === 'High').length;
  const overloadedCount = Object.values(stats).filter(s => s.capacityStatus === 'Overloaded').length;
  const fullyAllocatedCount = Object.values(stats).filter(s => s.capacityStatus === 'Fully Allocated').length;
  const hasCapacityCount = Object.values(stats).filter(s => s.capacityStatus === 'Has Capacity').length;

  const getProjectColor = (name) => {
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];
    let hash = 0;
    for (let i = 0; i < (name || '').length; i++) {
      hash = (hash << 5) - hash + name.charCodeAt(i);
      hash |= 0;
    }
    return colors[Math.abs(hash) % colors.length];
  };

  // UPDATED: Restored Capacity Dashboard tab
  const tabs = {
    overview: { icon: LayoutDashboard, label: 'Overview' },
    assignees: { icon: Users, label: 'Assignees' },
    risks: { icon: Shield, label: 'Risk Register' },
    capacity: { icon: Users, label: 'Capacity' },
    health: { icon: TrendingUp, label: 'Health' },
    sprints: { icon: Target, label: 'Sprints' },
    projects: { icon: Briefcase, label: 'Projects' },
    timeline: { icon: BarChart3, label: 'Timeline' },
    data: { icon: Database, label: 'Raw Data' },
    allocation: { icon: Target, label: 'Allocation' },
    csr: { icon: Briefcase, label: "CSR Tickets" },
    'csr-analytics': { icon: BarChart3, label: 'CSR Analytics' },
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
            
            {/* Server Status on Home Screen */}
            <div className="flex justify-center mb-6">
              <ServerStatus />
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-6">
              <JiraRefreshButton 
                onRefresh={handleJiraRefresh}
                disabled={false}
              />
              
              <label className="inline-block px-8 py-4 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors text-lg font-semibold">
                Upload Jira Data (TSV/CSV)
                <input type="file" accept=".csv,.tsv,.txt" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>
            
            {lastUpdated && (
              <div className="mt-8 pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-500">
                  <Clock className="w-3 h-3 inline mr-1" />
                  Last updated: {lastUpdated.toLocaleString('en-GB', { 
                    day: '2-digit', 
                    month: '2-digit', 
                    year: 'numeric', 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: false 
                  })}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Bulk Capacity Edit Modal */}
      {showBulkCapacityEdit && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl shadow-2xl max-w-2xl w-full p-8 border border-slate-700">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-3xl font-bold text-white flex items-center gap-3">
                <Edit3 className="w-8 h-8 text-blue-500" />
                Bulk Edit Sprint Capacity
              </h2>
              <button
                onClick={() => {
                  setShowBulkCapacityEdit(false);
                  setSelectedAssignees(new Set());
                  setBulkCapacityValue('');
                }}
                className="text-slate-400 hover:text-white p-2"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="bg-blue-900/30 border border-blue-700 rounded-xl p-4 mb-6">
              <p className="text-blue-200 text-sm">
                ℹ️ Selected <span className="font-bold">{selectedAssignees.size}</span> assignee(s). 
                Enter a new sprint capacity value and click Update to apply changes.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  New Sprint Capacity Value
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={bulkCapacityValue}
                  onChange={(e) => setBulkCapacityValue(e.target.value)}
                  placeholder="e.g., 14, 16, 18"
                  className="w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-lg text-white text-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={handleBulkCapacityUpdate}
                  className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors font-semibold flex items-center justify-center gap-2"
                >
                  <Save className="w-5 h-5" />
                  Update {selectedAssignees.size} Assignee(s)
                </button>
                <button
                  onClick={() => {
                    setShowBulkCapacityEdit(false);
                    setSelectedAssignees(new Set());
                    setBulkCapacityValue('');
                  }}
                  className="px-6 py-3 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition-colors font-semibold"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="sticky top-0 z-[60] bg-slate-900/95 backdrop-blur-sm border-b border-slate-700">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 
                className="text-2xl font-bold text-white cursor-pointer hover:text-blue-400 transition-colors"
                onClick={() => {
                  setActiveTab('overview');
                  setSelectedSprint('all');
                  setSelectedAssignee('all');
                  setSelectedProject('all');
                }}
                title="Click to return to Overview"
              >
                Sprint Analytics Dashboard
              </h1>
              <p className="text-sm text-slate-400 mt-1">
                {selectedSprint !== 'all' ? selectedSprint : 'All Sprints'}
                {selectedAssignee !== 'all' && ` • ${selectedAssignee}`}
                {selectedProject !== 'all' && ` • ${selectedProject}`}
              </p>
              {lastUpdated && (
                <p className="text-xs text-slate-500 mt-1">
                  <Clock className="w-3 h-3 inline mr-1" />
                  Last updated: {lastUpdated.toLocaleString('en-GB', { 
                    day: '2-digit', 
                    month: '2-digit', 
                    year: 'numeric', 
                    hour: '2-digit', 
                    minute: '2-digit',
                    hour12: false 
                  })}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-3">
                <ServerStatus />
                {/* Oracle DB status indicator */}
                <div className="flex items-center gap-1.5 text-xs">
                  <span className={`w-2 h-2 rounded-full ${dbStatus === 'online' ? 'bg-green-400' : dbStatus === 'offline' ? 'bg-slate-500' : 'bg-yellow-400 animate-pulse'}`} />
                  <span className={dbStatus === 'online' ? 'text-green-400' : 'text-slate-500'}>
                    {dbStatus === 'online' ? 'Oracle' : dbStatus === 'offline' ? 'Oracle offline' : 'DB…'}
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-lg font-mono font-semibold text-blue-400">
                  {currentTime.toLocaleTimeString('en-GB', { hour12: false })}
                </div>
                <div className="text-xs text-slate-400">
                  {currentTime.toLocaleDateString('en-GB', { 
                    day: '2-digit', 
                    month: '2-digit', 
                    year: 'numeric' 
                  })}
                </div>
              </div>
              <div className="flex gap-3">
                <JiraRefreshButton 
                  onRefresh={handleJiraRefresh}
                  disabled={false}
                />
                
                <button onClick={() => { setSelectedSprint('all'); setSelectedAssignee('all'); setSelectedProject('all'); }} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors font-medium">
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

          {activeTab !== 'timeline' && activeTab !== 'csr' && activeTab !== 'csr-analytics' && (
            <div className="pt-3">
              <FilterPanel
                sprint={selectedSprint}
                assignee={selectedAssignee}
                onSprintChange={setSelectedSprint}
                onAssigneeChange={setSelectedAssignee}
                sprints={sprints}
                assignees={assignees}
                onClearAll={() => { setSelectedSprint('all'); setSelectedAssignee('all'); setSelectedProject('all'); }}
              >
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-slate-400" />
                  <select
                    value={selectedProject}
                    onChange={(e) => setSelectedProject(e.target.value)}
                    className="px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="all">All Projects</option>
                    {projects.slice(1).map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              </FilterPanel>
            </div>
          )}
        </div>
      </div>

              <div className={`${activeTab === 'csr' || activeTab === 'csr-analytics' ? 'w-full px-4 py-6 space-y-6' : 'max-w-7xl mx-auto px-6 py-6 space-y-6'}`}>


        {activeTab === 'overview' && (
          <OverviewSection
            stats={stats}
            completionRate={completionRate}
            totalSP={totalSP}
            completedSP={completedSP}
            activeWorkload={activeWorkload}
            awaitingWorkload={awaitingWorkload}
            highRisks={highRisks}
            overloadedCount={overloadedCount}
            fullyAllocatedCount={fullyAllocatedCount}
            hasCapacityCount={hasCapacityCount}
            sprintTimeline={sprintTimeline}
            sprintHealthSummary={sprintHealthSummary}
            selectedSprint={selectedSprint}
            selectedProject={selectedProject}
            sprintDaysConfig={sprintDaysConfig}
            setSprintDaysConfig={setSprintDaysConfig}
            filteredData={filteredData}
          />
        )}

        {activeTab === 'risks' && (
          <RiskSection 
            riskRegister={riskRegister} 
            selectedSprint={selectedSprint} 
            selectedAssignee={selectedAssignee}
            selectedProject={selectedProject}
          />
        )}

        {activeTab === 'capacity' && (
          <CapacitySection 
            stats={stats} 
            assigneeCaps={assigneeCaps} 
            setAssigneeCaps={setAssigneeCaps}
            selectedAssignees={selectedAssignees}
            handleSelectAllAssignees={handleSelectAllAssignees}
            handleToggleAssignee={handleToggleAssignee}
            setShowBulkCapacityEdit={setShowBulkCapacityEdit}
            filteredData={filteredData}
            sprintHolidays={sprintHolidays}
          />
        )}

        {activeTab === 'assignees' && (
          <AssigneesSection 
            stats={stats}
          />
        )}

        {activeTab === 'sprints' && (
          <SprintsSection 
            milestoneTracking={milestoneTracking} 
            getProjectColor={getProjectColor} 
            selectedSprint={selectedSprint}
            selectedProject={selectedProject}
          />
        )}

        {activeTab === 'projects' && (
          <ProjectsSection 
            projectProgressData={projectProgressData} 
            getProjectColor={getProjectColor}
            onProjectClick={handleProjectClick}
            selectedSprint={selectedSprint}
            selectedAssignee={selectedAssignee}
            filteredData={filteredData}
          />
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
            selectedSprint={selectedSprint}
            setSelectedSprint={setSelectedSprint}
            selectedAssignee={selectedAssignee}
            setSelectedAssignee={setSelectedAssignee}
            selectedProject={selectedProject}
            setSelectedProject={setSelectedProject}
            sprints={sprints}
            assignees={assignees}
            projects={projects}
            filteredData={filteredData}
          />
        )}

        {activeTab === 'data' && (
          <DataSection 
            stats={stats} 
            filteredData={filteredData}
            selectedSprint={selectedSprint}
            selectedAssignee={selectedAssignee}
            selectedProject={selectedProject}
          />
        )}

        {activeTab === 'health' && (
          <SprintHealthTab
            tickets={filteredData}
            sprints={sprints}
            selectedSprint={selectedSprint}
            selectedAssignee={selectedAssignee}
            selectedProject={selectedProject}
          />
        )}

        {activeTab === 'allocation' && (
          <AllocationTab
            filteredData={filteredData}
            selectedSprint={selectedSprint}
            assigneeCaps={assigneeCaps}
            stats={stats}
          />
        )}

        {activeTab === 'csr' && (
          <CSRTicketsTab />
        )}

        {activeTab === 'csr-analytics' && <CSRAnalyticsTab />}
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
const OverviewSection = ({ 
  stats, 
  completionRate, 
  totalSP, 
  completedSP, 
  activeWorkload, 
  awaitingWorkload, 
  highRisks, 
  overloadedCount,
  fullyAllocatedCount,
  hasCapacityCount,
  sprintTimeline, 
  sprintHealthSummary,
  selectedSprint,
  selectedProject,
  sprintDaysConfig, 
  setSprintDaysConfig,
  filteredData
}) => {
  const [showSprintConfig, setShowSprintConfig] = useState(false);
  const [tempDays, setTempDays] = useState('');
  // ticket visibility toggles for overview table
  const [hideDoneTickets, setHideDoneTickets] = useState(false);
  const [hideTestingTickets, setHideTestingTickets] = useState(false);
  const [hideVersioningTickets, setHideVersioningTickets] = useState(false);

  // derive visible tickets safely from filteredData
  const visibleTickets = useMemo(() => {
    const source = filteredData || [];
    return source.filter(item => {
      const status = item['Status'];
      if (hideDoneTickets && status === 'Done') return false;
      if (hideTestingTickets && status === 'Awaiting Testing') return false;
      if (hideVersioningTickets && status === 'Awaiting Versioning') return false;
      return true;
    });
  }, [filteredData, hideDoneTickets, hideTestingTickets, hideVersioningTickets]);

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

      {sprintHealthSummary && (
        <div className={`border-l-4 p-6 rounded-xl ${sprintHealthSummary.color}`}>
          <div className="flex items-start gap-3 mb-4">
            <AlertCircle className="w-6 h-6 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="text-lg font-bold mb-2">Sprint Health Assessment</h3>
              <p className="text-base font-medium mb-4">{sprintHealthSummary.message}</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="font-semibold">Total Capacity</div>
                  <div className="text-2xl font-bold">{sprintHealthSummary.totalCapacity} SP</div>
                </div>
                <div>
                  <div className="font-semibold">Active Workload</div>
                  <div className="text-2xl font-bold">{sprintHealthSummary.activeWorkload} SP</div>
                </div>
                <div>
                  <div className="font-semibold">Remaining Capacity</div>
                  <div className="text-2xl font-bold">{sprintHealthSummary.remainingCapacity} SP</div>
                </div>
              </div>
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
            </p>
          </div>
        )}

        <KPICard icon={Users} value={Object.keys(stats).length} label="Team Members" status="neutral" />
        <KPICard icon={Clock} value={awaitingWorkload.toFixed(1)} label="Awaiting SP" status="neutral" subtitle="(excluded)" />
        <KPICard icon={TrendingUp} value={activeWorkload.toFixed(1)} label="Active Workload" status="warning" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-green-50 border-l-4 border-green-500 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-3xl">✅</span>
            <span className="text-4xl font-bold text-green-700">{hasCapacityCount}</span>
          </div>
          <div className="text-sm font-semibold text-green-800">Has Capacity</div>
          <div className="text-xs text-green-600 mt-1">Can take more work</div>
        </div>
        
        <div className="bg-amber-50 border-l-4 border-amber-500 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-3xl">🟡</span>
            <span className="text-4xl font-bold text-amber-700">{fullyAllocatedCount}</span>
          </div>
          <div className="text-sm font-semibold text-amber-800">Fully Allocated</div>
          <div className="text-xs text-amber-600 mt-1">No buffer</div>
        </div>
        
        <div className="bg-red-50 border-l-4 border-red-500 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-3xl">❌</span>
            <span className="text-4xl font-bold text-red-700">{overloadedCount}</span>
          </div>
          <div className="text-sm font-semibold text-red-800">Overloaded</div>
          <div className="text-xs text-red-600 mt-1">Needs scope reduction</div>
        </div>
      </div>

      {/* PM Quick Actions Panel */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 rounded-xl p-6 mb-6">
        <h3 className="text-lg font-bold text-slate-900 mb-4">📋 PM Quick Actions</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="text-3xl font-bold text-green-600 mb-1">
              {Object.values(stats).filter(s => s.remainingCapacity > 2).length}
            </div>
            <div className="text-sm text-slate-600">Can take new work (&gt;2 SP available)</div>
          </div>
          
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="text-3xl font-bold text-amber-600 mb-1">
              {Object.values(stats).filter(s => s.remainingCapacity >= 0 && s.remainingCapacity <= 2).length}
            </div>
            <div className="text-sm text-slate-600">Nearly full (0-2 SP buffer)</div>
          </div>
          
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="text-3xl font-bold text-red-600 mb-1">
              {Object.values(stats).filter(s => s.remainingCapacity < 0).length}
            </div>
            <div className="text-sm text-slate-600">Need scope reduction (overloaded)</div>
          </div>
        </div>
        
        {/* PM Recommendations */}
        {Object.values(stats).filter(s => s.remainingCapacity < 0).length > 0 && (
          <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="font-semibold text-red-800 mb-2">⚠️ Immediate Actions Needed:</div>
            <ul className="text-sm text-red-700 space-y-1">
              {Object.entries(stats)
                .filter(([_, data]) => data.remainingCapacity < 0)
                .slice(0, 5)
                .map(([name, data]) => (
                  <li key={name}>
                    <strong>{name}</strong>: Reduce active work by {Math.abs(data.remainingCapacity).toFixed(1)} SP
                    (currently {data.activeWorkload.toFixed(1)} SP active, capacity is {data.sprintCapacity} SP)
                  </li>
                ))}
            </ul>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT CHART: PM-Optimized Workload Distribution */}
        <div className="bg-white rounded-xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-900">Team Workload - Active vs Completed</h2>
            <div className="flex gap-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-red-500 rounded"></div>
                <span className="text-slate-600">Active (Overloaded)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-green-500 rounded"></div>
                <span className="text-slate-600">Active (On Track)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-slate-300 rounded"></div>
                <span className="text-slate-600">Completed</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-amber-200 rounded"></div>
                <span className="text-slate-600">Awaiting</span>
              </div>
            </div>
          </div>
          
          <div className="space-y-4">
            {Object.entries(stats)
              .sort((a, b) => b[1].activeWorkload - a[1].activeWorkload)
              .slice(0, 10)
              .map(([name, data]) => {
                const maxSP = Math.max(...Object.values(stats).map(s => s.sprintCapacity));
                const capacityWidth = (data.sprintCapacity / maxSP) * 100;
                const activeWidth = Math.min((data.activeWorkload / maxSP) * 100, 100);
                const completedWidth = Math.min((data.completedWorkload / maxSP) * 100, 100);
                const awaitingWidth = Math.min((data.awaitingWorkload / maxSP) * 100, 100);
                
                const isOverloaded = data.activeWorkload > data.sprintCapacity;
                
                return (
                  <div key={name} className="group">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-700">
                          {name.length > 20 ? name.substring(0, 20) + '...' : name}
                        </span>
                        {isOverloaded && (
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded">
                            OVERLOADED
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-slate-900">
                          Active: {data.activeWorkload.toFixed(1)} / {data.sprintCapacity} SP
                        </div>
                        <div className="text-xs text-slate-500">
                          Completed: {data.completedWorkload.toFixed(1)} SP
                          {data.awaitingWorkload > 0 && ` · Awaiting: ${data.awaitingWorkload.toFixed(1)} SP`}
                        </div>
                      </div>
                    </div>
                    
                    <div className="relative h-12 bg-slate-100 rounded-lg overflow-hidden border border-slate-200">
                      {/* Capacity reference line (background) */}
                      <div
                        className="absolute top-0 bottom-0 border-r-2 border-blue-400 z-10"
                        style={{ left: `${capacityWidth}%` }}
                      >
                        <div className="absolute -top-1 -right-3 text-xs font-bold text-blue-600 bg-white px-1 rounded">
                          {data.sprintCapacity}
                        </div>
                      </div>
                      
                      {/* Stacked bars */}
                      <div className="absolute inset-0 flex items-center">
                        {/* Active workload */}
                        <div
                          className={`h-12 transition-all relative ${
                            isOverloaded ? 'bg-red-500' : 'bg-green-500'
                          }`}
                          style={{ width: `${activeWidth}%` }}
                        >
                          {data.activeWorkload > 0 && (
                            <span className="absolute inset-0 flex items-center justify-center text-white font-bold text-sm">
                              {data.activeWorkload.toFixed(1)}
                            </span>
                          )}
                        </div>
                        
                        {/* Completed workload (grayed out, shown for transparency) */}
                        {data.completedWorkload > 0 && (
                          <div
                            className="h-8 bg-slate-300 opacity-70 relative border-l-2 border-white"
                            style={{ width: `${completedWidth}%` }}
                            title={`Completed: ${data.completedWorkload.toFixed(1)} SP`}
                          >
                            <span className="absolute inset-0 flex items-center justify-center text-slate-700 font-semibold text-xs">
                              ✓ {data.completedWorkload.toFixed(1)}
                            </span>
                          </div>
                        )}
                        
                        {/* Awaiting workload (amber, shown for transparency) */}
                        {data.awaitingWorkload > 0 && (
                          <div
                            className="h-8 bg-amber-200 opacity-70 relative border-l-2 border-white"
                            style={{ width: `${awaitingWidth}%` }}
                            title={`Awaiting: ${data.awaitingWorkload.toFixed(1)} SP`}
                          >
                            <span className="absolute inset-0 flex items-center justify-center text-amber-800 font-semibold text-xs">
                              ⏳ {data.awaitingWorkload.toFixed(1)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* PM Guidance */}
                    <div className={`text-xs mt-1 font-medium ${
                      isOverloaded ? 'text-red-600' : 'text-green-600'
                    }`}>
                      {data.pmGuidance}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* RIGHT CHART: Remaining Capacity */}
        <div className="bg-white rounded-xl p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-slate-900">Remaining Capacity</h2>
            <div className="text-xs text-slate-500">
              Negative = Overloaded | Positive = Available
            </div>
          </div>
          
          <div className="space-y-3">
            {Object.entries(stats)
              .sort((a, b) => a[1].remainingCapacity - b[1].remainingCapacity)
              .slice(0, 10)
              .map(([name, data]) => {
                const remaining = data.remainingCapacity;
                const maxAbsCapacity = Math.max(...Object.values(stats).map(s => 
                  Math.abs(s.remainingCapacity)
                ));
                
                return (
                  <div key={name}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-slate-700">
                        {name.length > 20 ? name.substring(0, 20) + '...' : name}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-500">
                          {data.activeWorkload.toFixed(1)} / {data.sprintCapacity} SP
                        </span>
                        <span className={`font-bold text-lg ${
                          remaining > 0 ? 'text-green-600' :
                          remaining === 0 ? 'text-amber-600' :
                          'text-red-600'
                        }`}>
                          {remaining > 0 ? '+' : ''}{remaining.toFixed(1)} SP
                        </span>
                      </div>
                    </div>
                    
                    <div className="relative h-8 bg-slate-200 rounded overflow-hidden">
                      {/* Center line for zero */}
                      <div className="absolute inset-y-0 left-1/2 w-0.5 bg-slate-400 z-10"></div>
                      
                      {remaining >= 0 ? (
                        // Positive capacity - show green bar from center to right
                        <div
                          className="absolute inset-y-0 bg-green-500"
                          style={{
                            left: '50%',
                            width: `${Math.min((remaining / maxAbsCapacity) * 50, 50)}%`
                          }}
                        />
                      ) : (
                        // Negative capacity - show red bar from center to left
                        <div
                          className="absolute inset-y-0 bg-red-500"
                          style={{
                            right: '50%',
                            width: `${Math.min((Math.abs(remaining) / maxAbsCapacity) * 50, 50)}%`
                          }}
                        />
                      )}
                    </div>
                    
                    {/* Show completed work as a small badge */}
                    {data.completedWorkload > 0 && (
                      <div className="text-xs text-slate-500 mt-1">
                        ✓ {data.completedWorkload.toFixed(1)} SP completed
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* NEW: Ticket List Section for Overview */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Assignee Details</h2>
            <p className="text-sm text-slate-500 mt-1">
              {visibleTickets.filter(t => (t['Assignee'] || t['D']) && (t['Assignee'] || t['D']) !== 'Unassigned').length} assigned items shown
            </p>
          </div>
          
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors">
              <input 
                type="checkbox" 
                checked={hideDoneTickets} 
                onChange={() => setHideDoneTickets(!hideDoneTickets)}
                className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
              />
              <span className="text-slate-700 text-sm font-medium select-none">Hide Completed</span>
            </label>
            
            <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors">
              <input 
                type="checkbox" 
                checked={hideTestingTickets} 
                onChange={() => setHideTestingTickets(!hideTestingTickets)}
                className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
              />
              <span className="text-slate-700 text-sm font-medium select-none">Hide Awaiting Testing</span>
            </label>
            
            <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors">
              <input 
                type="checkbox" 
                checked={hideVersioningTickets} 
                onChange={() => setHideVersioningTickets(!hideVersioningTickets)}
                className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
              />
              <span className="text-slate-700 text-sm font-medium select-none">Hide Awaiting Versioning</span>
            </label>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm text-left text-slate-700">
            <thead className="text-xs text-slate-600 uppercase bg-slate-50 font-bold">
              <tr>
                <th className="px-4 py-3">Key</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 w-1/3">Summary</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Assignee</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-center">SP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {visibleTickets.filter(t => {
                const assignee = t['Assignee'] || t['D'] || 'Unassigned';
                return assignee !== 'Unassigned';
              }).length > 0 ? (
                visibleTickets.filter(t => {
                  const assignee = t['Assignee'] || t['D'] || 'Unassigned';
                  return assignee !== 'Unassigned';
                }).slice(0, 100).map((ticket, idx) => {
                  const sp = parseFloat(ticket['Story Points']) || 
                         parseFloat(ticket['Story points']) ||
                         parseFloat(ticket['Custom field (Story Points)']) ||
                         0;
                  return (
                    <tr key={idx} className="bg-white hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 font-mono font-medium text-blue-600 whitespace-nowrap">
                        {ticket['Issue key'] || ticket['Key']}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {ticket['Issue Type']}
                      </td>
                      <td className="px-4 py-3">
                        <div className="truncate max-w-md text-slate-800" title={ticket['Summary']}>{ticket['Summary']}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {ticket['Project'] || ticket['B']}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700">
                        {ticket['Assignee'] || ticket['D'] || 'Unassigned'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap
                          ${ticket['Status'] === 'Done' ? 'bg-green-100 text-green-800 border border-green-300' : 
                            ticket['Status'] === 'In Progress' ? 'bg-blue-100 text-blue-800 border border-blue-300' :
                            ticket['Status'] === 'To Do' ? 'bg-slate-100 text-slate-700 border border-slate-300' :
                            'bg-amber-100 text-amber-800 border border-amber-300'}
                        `}>
                          {ticket['Status']}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-slate-700">
                        {sp > 0 ? sp : '-'}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="7" className="px-4 py-8 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center">
                      <span className="text-3xl mb-2">🔍</span>
                      <span className="font-medium">No assigned tickets found</span>
                      <span className="text-sm mt-1">All items are unassigned or filtered out</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {visibleTickets.filter(t => {
            const assignee = t['Assignee'] || t['D'] || 'Unassigned';
            return assignee !== 'Unassigned';
          }).length > 100 && (
            <div className="px-4 py-3 text-center text-slate-500 border-t border-slate-200 bg-slate-50">
              Showing first 100 of {visibleTickets.filter(t => {
                const assignee = t['Assignee'] || t['D'] || 'Unassigned';
                return assignee !== 'Unassigned';
              }).length} assigned items
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const RiskSection = ({ riskRegister, selectedSprint, selectedAssignee, selectedProject }) => {
  const [showHigh, setShowHigh] = useState(true);
  const [showMedium, setShowMedium] = useState(true);

  const filteredRisks = useMemo(() => {
    return riskRegister.filter(risk => {
      const sprintMatch = selectedSprint === 'all' || risk.sprint === selectedSprint;
      const assigneeMatch = selectedAssignee === 'all' || risk.assignee === selectedAssignee;
      const projectMatch = selectedProject === 'all' || risk.project === selectedProject;
      const priorityMatch = (showHigh && risk.riskLevel === 'High') || (showMedium && risk.riskLevel === 'Medium');
      return sprintMatch && assigneeMatch && projectMatch && priorityMatch;
    });
  }, [riskRegister, selectedSprint, selectedAssignee, selectedProject, showHigh, showMedium]);

  const highRisks = filteredRisks.filter(r => r.riskLevel === 'High');
  const mediumRisks = filteredRisks.filter(r => r.riskLevel === 'Medium');

  return (
    <div className="space-y-6">
      {/* Risk Register Explanation */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 rounded-xl p-6">
        <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-blue-600" />
          About Risk Register
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="bg-white rounded-lg p-4 border border-red-200">
            <div className="font-semibold text-red-700 mb-2 flex items-center gap-2">
              <span className="text-lg">🔴</span>
              High Priority Risks
            </div>
            <ul className="text-slate-700 space-y-1 text-xs">
              <li>• <strong>Overdue items</strong> - Past target date and not Done</li>
              <li>• <strong>Overloaded assignees</strong> - Active work exceeds capacity</li>
              <li>• <strong>Missing story points</strong> - No SP and due within 5 days</li>
            </ul>
          </div>
          <div className="bg-white rounded-lg p-4 border border-amber-200">
            <div className="font-semibold text-amber-700 mb-2 flex items-center gap-2">
              <span className="text-lg">🟠</span>
              Medium Priority Risks
            </div>
            <ul className="text-slate-700 space-y-1 text-xs">
              <li>• <strong>Approaching deadline</strong> - Items due soon without story points</li>
              <li>• <strong>Potential blockers</strong> - Items that may need attention</li>
            </ul>
          </div>
        </div>
        <div className="mt-4 text-xs text-slate-600 bg-white/50 rounded p-3">
          <strong>💡 Use this for:</strong> Daily standups, sprint planning, identifying overloaded team members, and stakeholder updates
        </div>
      </div>

      {/* Priority Filter Checkboxes */}
      <div className="bg-white rounded-lg border border-slate-200 p-4">
        <div className="flex items-center gap-6">
          <span className="text-sm font-semibold text-slate-700">Filter by Priority:</span>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showHigh}
              onChange={(e) => setShowHigh(e.target.checked)}
              className="w-4 h-4 text-red-600 rounded focus:ring-red-500"
            />
            <span className="text-sm font-medium text-slate-700 flex items-center gap-1">
              <span className="text-lg">🔴</span>
              High Priority
            </span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showMedium}
              onChange={(e) => setShowMedium(e.target.checked)}
              className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
            />
            <span className="text-sm font-medium text-slate-700 flex items-center gap-1">
              <span className="text-lg">🟠</span>
              Medium Priority
            </span>
          </label>
        </div>
      </div>

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
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                        risk.riskLevel === 'High' ? 'bg-red-100 text-red-800 border border-red-300' : 'bg-amber-100 text-amber-800 border border-amber-300'}`}>
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

// ─── TeamOverviewModal ────────────────────────────────────────────────────────
function TeamOverviewModal({ assigneeList, stats, filteredData, overviewTab, setOverviewTab, onClose }) {
  const [showEmailPanel, setShowEmailPanel] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const statusBadge = s => {
    const sl = (s || '').toLowerCase();
    if (sl === 'to do')       return { label: 'To Do',       cls: 'bg-slate-100 text-slate-700' };
    if (sl === 'in progress') return { label: 'In Progress', cls: 'bg-blue-100 text-blue-700' };
    if (sl === 'done')        return { label: 'Done',        cls: 'bg-green-100 text-green-700' };
    if (sl.includes('awaiting') || sl.includes('testing') || sl.includes('versioning'))
                              return { label: s,             cls: 'bg-amber-100 text-amber-700' };
    return { label: s, cls: 'bg-slate-100 text-slate-600' };
  };

  const buildReportText = () => {
    const pad = (s, n) => String(s).padEnd(n);
    const lines = [
      'TEAM OVERVIEW REPORT',
      'Generated: ' + new Date().toLocaleString(),
      '',
      '=== CAPACITY OVERVIEW ===',
      '',
      pad('Assignee', 28) + pad('Sprint Cap', 12) + pad('Active SP', 12) + pad('Remaining', 12) + 'Status',
      '-'.repeat(80),
    ];
    assigneeList.forEach(assignee => {
      const d = stats[assignee];
      lines.push(
        pad(assignee, 28) +
        pad(d.sprintCapacity + ' SP', 12) +
        pad(d.activeWorkload.toFixed(1) + ' SP', 12) +
        pad((d.remainingCapacity > 0 ? '+' : '') + d.remainingCapacity.toFixed(1) + ' SP', 12) +
        d.capacityStatus
      );
    });
    lines.push('');
    lines.push('=== SPRINT TICKETS BY ASSIGNEE ===');
    lines.push('');
    assigneeList.forEach(assignee => {
      const d = stats[assignee];
      const myTickets = (filteredData || []).filter(t => (t['Assignee'] || t['D'] || '') === assignee);
      if (!myTickets.length) return;
      const toDo     = myTickets.filter(t => (t['Status']||'').toLowerCase() === 'to do').length;
      const inProg   = myTickets.filter(t => (t['Status']||'').toLowerCase() === 'in progress').length;
      const done     = myTickets.filter(t => (t['Status']||'').toLowerCase() === 'done').length;
      const awaiting = myTickets.filter(t => { const s=(t['Status']||'').toLowerCase(); return s.includes('awaiting')||s.includes('testing')||s.includes('versioning'); }).length;
      lines.push(assignee + ' [' + d.capacityStatus + ' - ' + d.activeWorkload.toFixed(1) + '/' + d.sprintCapacity + ' SP]');
      lines.push('  To Do: ' + toDo + '  In Progress: ' + inProg + '  Done: ' + done + '  Awaiting: ' + awaiting);
      const order = { 'in progress': 0, 'to do': 1 };
      const sorted = [...myTickets].sort((a, b) => (order[(a['Status']||'').toLowerCase()]??2) - (order[(b['Status']||'').toLowerCase()]??2));
      sorted.forEach(t => {
        const key  = t['Issue key'] || t['Key'] || '';
        const sp   = t['Story Points'] ? '[' + t['Story Points'] + 'sp]' : '     ';
        const proj = t['Project'] || t['B'] || '';
        lines.push('  - ' + pad(key, 14) + ' ' + sp + '  ' + pad(t['Status']||'', 20) + ' ' + (proj ? '['+proj+'] ' : '') + (t['Summary']||''));
      });
      lines.push('');
    });
    return lines.join('\r\n');
  };

  const handleCopyForEmail = async () => {
    const text = buildReportText();
    try { await navigator.clipboard.writeText(text); }
    catch (_) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleOpenEmail = () => {
    const subject = encodeURIComponent('Team Overview - ' + new Date().toLocaleDateString());
    const a = document.createElement('a');
    a.href = 'mailto:?subject=' + subject;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handlePrint = () => {
    const printWin = window.open('', '_blank');
    const rows = assigneeList.map(assignee => {
      const d = stats[assignee];
      const myTickets = (filteredData || []).filter(t => (t['Assignee'] || t['D'] || '') === assignee);
      const toDo     = myTickets.filter(t => (t['Status']||'').toLowerCase() === 'to do').length;
      const inProg   = myTickets.filter(t => (t['Status']||'').toLowerCase() === 'in progress').length;
      const done     = myTickets.filter(t => (t['Status']||'').toLowerCase() === 'done').length;
      const awaiting = myTickets.filter(t => { const s=(t['Status']||'').toLowerCase(); return s.includes('awaiting')||s.includes('testing')||s.includes('versioning'); }).length;
      const statusColor = d.capacityStatus === 'Has Capacity' ? '#d1fae5' : d.capacityStatus === 'Fully Allocated' ? '#fef3c7' : '#fee2e2';
      const ticketRows = myTickets.map(t => '<tr><td style="padding:4px 8px;font-family:monospace;font-size:11px;color:#2563eb">' + (t['Issue key']||t['Key']||'') + '</td><td style="padding:4px 8px;font-size:11px">' + (t['Summary']||'') + '</td><td style="padding:4px 8px;font-size:11px">' + (t['Project']||t['B']||'') + '</td><td style="padding:4px 8px;font-size:11px;text-align:center">' + (t['Story Points']||'') + '</td><td style="padding:4px 8px;font-size:11px">' + (t['Status']||'') + '</td></tr>').join('');
      return '<div style="margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;page-break-inside:avoid"><div style="background:' + statusColor + ';padding:10px 14px;display:flex;justify-content:space-between;align-items:center"><div><strong style="font-size:13px">' + assignee + '</strong><span style="margin-left:10px;font-size:11px;color:#475569">' + d.capacityStatus + '</span></div><div style="font-size:12px">Active: <strong>' + d.activeWorkload.toFixed(1) + '</strong> / ' + d.sprintCapacity + ' SP | To Do: ' + toDo + ' In Prog: ' + inProg + ' Done: ' + done + ' Awaiting: ' + awaiting + '</div></div>' + (myTickets.length > 0 ? '<table style="width:100%;border-collapse:collapse"><thead><tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0"><th style="padding:4px 8px;text-align:left;font-size:11px">Key</th><th style="padding:4px 8px;text-align:left;font-size:11px">Summary</th><th style="padding:4px 8px;text-align:left;font-size:11px">Project</th><th style="padding:4px 8px;text-align:center;font-size:11px">SP</th><th style="padding:4px 8px;text-align:left;font-size:11px">Status</th></tr></thead><tbody>' + ticketRows + '</tbody></table>' : '<p style="padding:8px 14px;font-size:11px;color:#94a3b8">No tickets</p>') + '</div>';
    }).join('');
    printWin.document.write('<!DOCTYPE html><html><head><title>Team Overview</title><style>body{font-family:sans-serif;padding:24px;color:#1e293b}h1{font-size:18px;margin-bottom:4px}p.sub{color:#64748b;font-size:12px;margin-bottom:20px}@media print{body{padding:12px}}</style></head><body><h1>Team Overview</h1><p class="sub">Generated: ' + new Date().toLocaleString() + '</p>' + rows + '</body></html>');
    printWin.document.close();
    printWin.focus();
    setTimeout(() => printWin.print(), 400);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[99999] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Team Overview</h2>
            <p className="text-sm text-slate-500 mt-0.5">Capacity vs workload for all team members</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handlePrint} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
              <Download className="w-4 h-4" /> Print / PDF
            </button>
            <button onClick={() => setShowEmailPanel(s => !s)} className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
              <Mail className="w-4 h-4" /> Email
            </button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700 transition-colors ml-2">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Email helper panel */}
        {showEmailPanel && (
          <div className="bg-blue-50 border-b border-blue-200 px-6 py-4">
            <p className="text-sm text-blue-800 mb-3">
              The report is too large to fit in a mailto link. Use these two steps:
            </p>
            <div className="flex items-center gap-3">
              <button onClick={handleCopyForEmail}
                className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied!' : '1. Copy Report Text'}
              </button>
              <button onClick={handleOpenEmail}
                className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors">
                <Mail className="w-4 h-4" /> 2. Open Email Client
              </button>
              <span className="text-xs text-blue-600">Then paste (Ctrl+V) into the email body</span>
            </div>
          </div>
        )}

        <div className="flex gap-1 px-6 pt-3 pb-0 border-b border-slate-200 bg-white">
          {['capacity', 'tickets'].map(tab => (
            <button key={tab} onClick={() => setOverviewTab(tab)}
              className={'px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ' + (overviewTab === tab ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700')}>
              {tab === 'capacity' ? 'Capacity Overview' : 'Sprint Tickets'}
            </button>
          ))}
        </div>
        <div className="overflow-y-auto flex-1 p-6">
          {overviewTab === 'capacity' && (
            <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
              {assigneeList.map(assignee => {
                const d = stats[assignee];
                const active = d.activeWorkload, cap = d.sprintCapacity, remaining = d.remainingCapacity;
                const pct = cap > 0 ? Math.min(100, (active / cap) * 100) : 0;
                const statusColor = d.capacityStatus === 'Has Capacity' ? 'border-green-300 bg-green-50' : d.capacityStatus === 'Fully Allocated' ? 'border-amber-300 bg-amber-50' : 'border-red-300 bg-red-50';
                const barColor    = d.capacityStatus === 'Has Capacity' ? 'bg-green-500' : d.capacityStatus === 'Fully Allocated' ? 'bg-amber-500' : 'bg-red-500';
                const myTickets   = (filteredData || []).filter(t => (t['Assignee']||t['D']||'') === assignee);
                const toDo     = myTickets.filter(t => (t['Status']||'').toLowerCase() === 'to do').length;
                const inProg   = myTickets.filter(t => (t['Status']||'').toLowerCase() === 'in progress').length;
                const done     = myTickets.filter(t => (t['Status']||'').toLowerCase() === 'done').length;
                const awaiting = myTickets.filter(t => { const s=(t['Status']||'').toLowerCase(); return s.includes('awaiting')||s.includes('testing')||s.includes('versioning'); }).length;
                return (
                  <div key={assignee} className={'rounded-xl border-2 p-4 ' + statusColor}>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="font-bold text-slate-900 text-sm">{assignee}</div>
                        <div className={'text-xs font-semibold mt-0.5 ' + (d.capacityStatus === 'Has Capacity' ? 'text-green-700' : d.capacityStatus === 'Fully Allocated' ? 'text-amber-700' : 'text-red-700')}>{d.capacityStatus}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold text-slate-900">{active.toFixed(1)}<span className="text-xs font-normal text-slate-500"> / {cap} SP</span></div>
                        <div className={'text-xs font-semibold ' + (remaining > 0 ? 'text-green-600' : remaining === 0 ? 'text-amber-600' : 'text-red-600')}>
                          {remaining > 0 ? '+' + remaining.toFixed(1) + ' free' : remaining === 0 ? 'Full' : remaining.toFixed(1) + ' over'}
                        </div>
                      </div>
                    </div>
                    <div className="h-2 bg-white/70 rounded-full overflow-hidden mb-3">
                      <div className={'h-full rounded-full ' + barColor} style={{ width: pct + '%' }} />
                    </div>
                    <div className="grid grid-cols-4 gap-1 text-center">
                      <div className="bg-white/60 rounded-lg py-1.5"><div className="text-sm font-bold text-slate-700">{toDo}</div><div className="text-xs text-slate-500">To Do</div></div>
                      <div className="bg-white/60 rounded-lg py-1.5"><div className="text-sm font-bold text-blue-700">{inProg}</div><div className="text-xs text-slate-500">In Prog</div></div>
                      <div className="bg-white/60 rounded-lg py-1.5"><div className="text-sm font-bold text-green-700">{done}</div><div className="text-xs text-slate-500">Done</div></div>
                      <div className="bg-white/60 rounded-lg py-1.5"><div className="text-sm font-bold text-amber-700">{awaiting}</div><div className="text-xs text-slate-500">Awaiting</div></div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500 text-center">{myTickets.length} tickets total</div>
                  </div>
                );
              })}
            </div>
          )}
          {overviewTab === 'tickets' && (
            <div className="space-y-6">
              {(filteredData||[]).filter(t=>{const a=t['Assignee']||t['D']||'';return !a||a==='Unassigned';}).length > 0 && (() => {
                const unassigned = (filteredData||[]).filter(t=>{const a=t['Assignee']||t['D']||'';return !a||a==='Unassigned';});
                return (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className="bg-slate-100 px-4 py-3 flex items-center justify-between">
                      <span className="font-bold text-slate-700">Unassigned</span>
                      <span className="text-xs text-slate-500">{unassigned.length} tickets</span>
                    </div>
                    <TicketTable tickets={unassigned} statusBadge={statusBadge} />
                  </div>
                );
              })()}
              {assigneeList.map(assignee => {
                const d = stats[assignee];
                const myTickets = (filteredData||[]).filter(t => (t['Assignee']||t['D']||'') === assignee);
                if (!myTickets.length) return null;
                const headerBg = d.capacityStatus === 'Has Capacity' ? 'bg-green-50' : d.capacityStatus === 'Fully Allocated' ? 'bg-amber-50' : 'bg-red-50';
                return (
                  <div key={assignee} className="border border-slate-200 rounded-xl overflow-hidden">
                    <div className={headerBg + ' px-4 py-3 flex items-center justify-between'}>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-slate-800">{assignee}</span>
                        <span className={'text-xs font-semibold px-2 py-0.5 rounded-full ' + (d.capacityStatus === 'Has Capacity' ? 'bg-green-200 text-green-800' : d.capacityStatus === 'Fully Allocated' ? 'bg-amber-200 text-amber-800' : 'bg-red-200 text-red-800')}>{d.capacityStatus}</span>
                      </div>
                      <span className="text-xs text-slate-500">{d.activeWorkload.toFixed(1)} / {d.sprintCapacity} SP &nbsp;·&nbsp; {myTickets.length} tickets</span>
                    </div>
                    <TicketTable tickets={myTickets} statusBadge={statusBadge} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── TicketTable (used in Team Overview modal) ───────────────────────────────
function TicketTable({ tickets, statusBadge }) {
  const sorted = [...tickets].sort((a, b) => {
    const order = { 'in progress': 0, 'to do': 1, 'awaiting testing': 2, 'awaiting versioning': 2, 'done': 3 };
    const sa = order[(a['Status']||'').toLowerCase()] ?? 2;
    const sb = order[(b['Status']||'').toLowerCase()] ?? 2;
    return sa - sb;
  });
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 bg-slate-50">
          <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 w-28">Key</th>
          <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Summary</th>
          <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 w-24">Project</th>
          <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500 w-14">SP</th>
          <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500 w-36">Status</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {sorted.map((t, i) => {
          const key = t['Issue key'] || t['Key'] || '';
          const sp  = parseFloat(t['Story Points']) || 0;
          const { label, cls } = statusBadge(t['Status']);
          return (
            <tr key={key || i} className="hover:bg-slate-50">
              <td className="px-4 py-2 font-mono text-xs text-blue-600 font-semibold">{key}</td>
              <td className="px-4 py-2 text-xs text-slate-700 max-w-xs">{t['Summary'] || ''}</td>
              <td className="px-4 py-2 text-xs text-slate-500">{t['Project'] || t['B'] || ''}</td>
              <td className="px-4 py-2 text-center text-xs font-semibold text-slate-700">{sp > 0 ? sp : '—'}</td>
              <td className="px-4 py-2"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{label}</span></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// UPDATED: CRITICAL CHANGES - PM-First Capacity Section
const CapacitySection = ({ stats, assigneeCaps, setAssigneeCaps, selectedAssignees, handleSelectAllAssignees, handleToggleAssignee, setShowBulkCapacityEdit, filteredData, sprintHolidays = [] }) => {
  const assigneeList = Object.keys(stats);
  const [showTeamOverview, setShowTeamOverview] = React.useState(false);
  const [overviewTab, setOverviewTab] = React.useState('capacity');
  const [saving, setSaving] = React.useState(false);
  const [saveMsg, setSaveMsg] = React.useState('');

  const handleSaveCapacity = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      localStorage.setItem('assigneeCaps', JSON.stringify(assigneeCaps));
      await saveCapacityToDB(assigneeCaps);
      setSaveMsg('✅ Saved');
    } catch (e) {
      setSaveMsg('⚠️ Saved locally (DB unavailable)');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

  // Move calculations outside IIFE to make variables accessible
  const totalPlannedSP = Object.values(stats).reduce((sum, s) => sum + s.totalStoryPoints, 0);
  const completedSP = Object.values(stats).reduce((sum, s) => sum + s.totalCompletedSP, 0);
  const activeWorkload = Object.values(stats).reduce((sum, s) => sum + s.activeWorkload, 0);
  const awaitingWorkload = Object.values(stats).reduce((sum, s) => sum + s.awaitingWorkload, 0);
  const totalCapacity = Object.values(stats).reduce((sum, s) => sum + s.sprintCapacity, 0);

  return (
    <div className="space-y-6">
      {/* PM-First Model Explanation */}
      <div className="bg-gradient-to-r from-green-50 to-blue-50 border-l-4 border-green-500 rounded-xl p-6">
        <h3 className="text-lg font-bold text-slate-900 mb-3 flex items-center gap-2">
          <Users className="w-5 h-5 text-green-600" />
          PM-First Capacity Model
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="bg-white rounded-lg p-4 border border-green-200">
            <div className="font-semibold text-green-700 mb-2">🎯 Active Workload</div>
            <p className="text-slate-600">Only <strong>To Do + In Progress</strong> work consumes capacity.</p>
            <p className="text-xs text-slate-500 mt-1">Completed/Downstream work is excluded.</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-blue-200">
            <div className="font-semibold text-blue-700 mb-2">✅ Simple Status</div>
            <p className="text-slate-600"><strong>Has Capacity → Fully Allocated → Overloaded</strong></p>
            <p className="text-xs text-slate-500 mt-1">No percentages, just clear decisions.</p>
          </div>
        </div>
        <div className="mt-4 text-sm text-slate-700 bg-white/50 rounded p-3">
          <strong>For PMs:</strong> 
          <span className="text-green-700 ml-2">✅ Has Capacity (can add work)</span> · 
          <span className="text-amber-600 ml-2">🟡 Fully Allocated (no buffer)</span> · 
          <span className="text-red-600 ml-2">❌ Overloaded (reduce scope)</span>
        </div>
      </div>

      {/* UPDATED: Sprint Work Scope Breakdown with new model */}
      <div className="bg-white rounded-xl p-6 border-l-4 border-green-500">
        <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
          <CheckCircle className="w-5 h-5 text-green-600" />
          Sprint Work Scope (PM-First View)
        </h3>
        <div className="space-y-4">
          {/* Active Workload Section */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 mb-2">🎯 Active Workload (Consumes Capacity)</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-red-50 rounded-lg p-4 border-2 border-red-300">
                <Tooltip content="Active Workload\n\nStory Points from items in To Do or In Progress status.\nThis is the only work that consumes assignee capacity right now.">
                  <div className="text-sm font-medium text-red-700 mb-1 flex items-center gap-1">
                    <span className="text-red-400">ⓘ</span>
                    Active Workload
                  </div>
                </Tooltip>
                <div className="text-3xl font-bold text-red-900">{activeWorkload.toFixed(1)} SP</div>
                <div className="text-xs text-red-600 mt-1">Consumes capacity</div>
              </div>
              
              <div className="bg-green-50 rounded-lg p-4 border-2 border-green-200">
                <Tooltip content="Remaining Capacity\n\nSprint Capacity minus Active Workload.\nThis is what's actually available for new work.">
                  <div className="text-sm font-medium text-green-700 mb-1 flex items-center gap-1">
                    <span className="text-green-400">ⓘ</span>
                    Remaining Capacity
                  </div>
                </Tooltip>
                <div className="text-3xl font-bold text-green-900">{(totalCapacity - activeWorkload).toFixed(1)} SP</div>
                <div className="text-xs text-green-600 mt-1">Available for new work</div>
              </div>
            </div>
          </div>

          {/* Completed/Awaiting Section (Transparency only) */}
          {(completedSP > 0 || awaitingWorkload > 0) && (
            <div>
              <Tooltip content="Completed/Awaiting Work\n\nWork that is already delivered or waiting for others.\nThis is shown for transparency but does NOT consume assignee capacity.">
                <h4 className="text-sm font-semibold text-slate-700 mb-2 inline-flex items-center gap-1">
                  <span className="text-slate-400">ⓘ</span>
                  Completed/Awaiting (Excluded from Capacity)
                </h4>
              </Tooltip>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4 border-2 border-gray-200">
                  <Tooltip content="Completed Work\n\nStory Points from items marked as Done.\nWork is delivered, assignee is free.">
                    <div className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                      <span className="text-gray-400">ⓘ</span>
                      Completed (Done)
                    </div>
                    <div className="text-3xl font-bold text-gray-900">{completedSP.toFixed(1)} SP</div>
                    <div className="text-xs text-gray-600 mt-1">Delivered, excluded</div>
                  </Tooltip>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 border-2 border-gray-200">
                  <Tooltip content="Awaiting Downstream\n\nWork waiting for testing or versioning.\nAssignee's job is done, excluded from capacity.">
                    <div className="text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
                      <span className="text-gray-400">ⓘ</span>
                      Awaiting Downstream
                    </div>
                    <div className="text-3xl font-bold text-gray-900">{awaitingWorkload.toFixed(1)} SP</div>
                    <div className="text-xs text-gray-600 mt-1">Waiting for others, excluded</div>
                  </Tooltip>
                </div>
              </div>
            </div>
          )}

          {/* Clear PM Rule */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-amber-800">
                <strong>PM Decision Rule:</strong> Only look at <strong>Active Workload ({activeWorkload.toFixed(1)} SP)</strong> versus <strong>Sprint Capacity ({totalCapacity} SP)</strong>. 
                Completed/Awaiting work ({completedSP.toFixed(1)} SP) is already delivered and doesn't affect capacity.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* UPDATED: Capacity Planning Table - PM-First Design */}
      <div className="bg-white rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-bold text-slate-900">Sprint Capacity Planning</h2>
          <div className="flex items-center gap-2">
            {saveMsg && <span className="text-sm font-medium text-green-700">{saveMsg}</span>}
            <button
              onClick={handleSaveCapacity}
              disabled={saving}
              className="px-4 py-2 rounded-lg font-semibold flex items-center gap-2 bg-green-600 text-white hover:bg-green-500 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Saving…' : 'Save Capacity'}
            </button>
            <button
              onClick={() => setShowTeamOverview(true)}
              className="px-4 py-2 rounded-lg font-semibold flex items-center gap-2 bg-slate-700 text-white hover:bg-slate-600"
            >
              <Users className="w-4 h-4" />
              Team Overview
            </button>
            <button 
              onClick={() => setShowBulkCapacityEdit(true)}
              disabled={selectedAssignees.size === 0}
              className={`px-4 py-2 rounded-lg font-semibold flex items-center gap-2 ${
                selectedAssignees.size > 0 
                  ? 'bg-blue-600 text-white hover:bg-blue-500' 
                  : 'bg-slate-300 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Edit3 className="w-4 h-4" />
              Bulk Edit Capacity ({selectedAssignees.size})
            </button>
          </div>
        </div>
        {sprintHolidays.length > 0 && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg flex items-start gap-2 text-sm text-amber-800">
            <span className="text-lg flex-shrink-0">🗓️</span>
            <div>
              <strong>Public holiday{sprintHolidays.length > 1 ? 's' : ''} in this sprint:</strong>{' '}
              {sprintHolidays.map(h => `${h.name} (${h.date})`).join(', ')}.
              {' '}Consider reducing individual capacities to reflect the lost working day{sprintHolidays.length > 1 ? 's' : ''}, then click <strong>Save Capacity</strong>.
            </div>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b-2 border-slate-200">
                <th className="px-4 py-4 text-center w-12">
                  <input type="checkbox"
                    checked={selectedAssignees.size === assigneeList.length && assigneeList.length > 0}
                    onChange={() => handleSelectAllAssignees(assigneeList)}
                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                  />
                </th>
                <th className="px-4 py-4 text-left font-bold text-slate-700">Assignee</th>
                <th className="px-4 py-4 text-center font-bold text-slate-700">Sprint<br/>Capacity<br/><span className="text-xs font-normal text-slate-500">(base / eff.)</span></th>
                <th className="px-4 py-4 text-center font-bold text-slate-700 bg-red-50">Active<br/>Workload (SP)</th>
                <th className="px-4 py-4 text-center font-bold text-slate-700 bg-green-50">Remaining<br/>Capacity</th>
                <th className="px-4 py-4 text-center font-bold text-slate-700 min-w-[140px]">Capacity Status</th>
                <th className="px-4 py-4 text-left font-bold text-slate-700 min-w-[200px]">PM Guidance</th>
                <th className="px-4 py-4 text-center font-bold text-slate-700">Completed/<br/>Awaiting</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {Object.entries(stats).map(([assignee, data]) => (
                <tr key={assignee} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-4 text-center">
                    <input
                      type="checkbox"
                      checked={selectedAssignees.has(assignee)}
                      onChange={() => handleToggleAssignee(assignee)}
                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-4 py-4 font-semibold text-gray-900">{assignee}</td>
                  <td className="px-4 py-4 text-center">
                    <input
                      type="number"
                      min={0}
                      value={assigneeCaps[assignee] ?? 16}
                      onChange={(e) => setAssigneeCaps(prev => ({ ...prev, [assignee]: Number(e.target.value) || 0 }))}
                      className="w-16 px-2 py-1.5 rounded text-center border border-slate-300 text-slate-900 bg-white font-semibold"
                      title="Base capacity (full sprint, no holidays)"
                    />
                    {data.sprintCapacity !== (assigneeCaps[assignee] ?? 16) && (
                      <div className="text-xs text-amber-600 mt-1 font-medium">
                        eff. {data.sprintCapacity} SP
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 text-center bg-red-50">
                    <div className="font-bold text-red-700 text-lg">
                      {data.activeWorkload.toFixed(1)}
                    </div>
                    <div className="text-xs text-red-600 mt-0.5">
                      {data.activeItems} items
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center bg-green-50">
                    <div className={`text-xl font-bold ${
                      data.remainingCapacity > 0 ? 'text-green-600' :
                      data.remainingCapacity === 0 ? 'text-amber-600' :
                      'text-red-600'
                    }`}>
                      {data.remainingCapacity > 0 ? '+' : ''}{data.remainingCapacity.toFixed(1)}
                    </div>
                    <div className="text-xs text-slate-600 mt-0.5">
                      {data.remainingCapacity > 0 ? 'Available' : data.remainingCapacity === 0 ? 'No buffer' : 'Over capacity'}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <span className={`inline-block px-3 py-2 rounded-lg text-sm font-bold whitespace-nowrap ${
                      data.capacityStatus === 'Has Capacity' ? 'bg-green-100 text-green-800 border-2 border-green-300' :
                      data.capacityStatus === 'Fully Allocated' ? 'bg-amber-100 text-amber-800 border-2 border-amber-300' :
                      'bg-red-100 text-red-800 border-2 border-red-300'
                    }`}>
                      {data.capacityStatus}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-start gap-2">
                      <span className="text-lg flex-shrink-0">
                        {data.capacityStatus === 'Has Capacity' ? '✅' :
                         data.capacityStatus === 'Fully Allocated' ? '🟡' :
                         '❌'}
                      </span>
                      <div>
                        <span className="text-sm text-slate-700 leading-tight">
                          {data.pmGuidance}
                        </span>
                        {/* Show completed/awaiting for transparency */}
                        {(data.completedWorkload > 0 || data.awaitingWorkload > 0) && (
                          <div className="text-xs text-slate-500 mt-1">
                            {(data.completedWorkload + data.awaitingWorkload).toFixed(1)} SP (excluded)
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-center">
                    <div className="text-sm font-semibold text-slate-700">
                      {(data.completedWorkload + data.awaitingWorkload).toFixed(1)} SP
                    </div>
                    <div className="text-xs text-slate-500 mt-0.5">
                      ✓ {data.completedWorkload.toFixed(1)} / ⏳ {data.awaitingWorkload.toFixed(1)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-800">
            <strong>PM Decision Rule:</strong> Only look at <strong>Active Workload ({activeWorkload.toFixed(1)} SP)</strong> versus <strong>Sprint Capacity ({totalCapacity} SP)</strong>. 
            Completed/Awaiting work ({completedSP.toFixed(1)} SP) is already delivered and doesn't affect capacity.
          </div>
        </div>
      </div>

      {/* Team Overview Modal */}
      {showTeamOverview && (
        <TeamOverviewModal
          assigneeList={assigneeList}
          stats={stats}
          filteredData={filteredData}
          overviewTab={overviewTab}
          setOverviewTab={setOverviewTab}
          onClose={() => setShowTeamOverview(false)}
        />
      )}
    </div>
  );
};

const SprintsSection = ({ milestoneTracking, getProjectColor, selectedSprint, selectedProject }) => {
  const filteredMilestones = useMemo(() => {
    let data = milestoneTracking;
    if (selectedSprint !== 'all') {
      data = data.filter(m => m.sprint === selectedSprint);
    }
    if (selectedProject !== 'all') {
      data = data.filter(m => m.project === selectedProject);
    }
    return data;
  }, [milestoneTracking, selectedSprint, selectedProject]);

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

const ProjectsSection = ({ projectProgressData, getProjectColor, onProjectClick, selectedSprint, selectedAssignee }) => {
  const filteredProjects = useMemo(() => {
    return projectProgressData.filter(project => {
      // Filter by sprint/assignee if needed
      return true; // For now, show all projects
    });
  }, [projectProgressData, selectedSprint, selectedAssignee]);

  return (
    <div className="bg-white rounded-xl p-6">
      <h2 className="text-xl font-bold text-slate-900 mb-4">Project Progress</h2>
      {filteredProjects.length === 0 ? (
        <p className="text-slate-600">No project data available</p>
      ) : (
        <div className="space-y-4">
          {filteredProjects.map((p) => (
            <div key={p.project}>
              <div className="flex items-center justify-between mb-1">
                <button 
                  onClick={() => onProjectClick(p.project)}
                  className="flex items-center gap-2 hover:opacity-75 transition"
                >
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: getProjectColor(p.project) }} />
                  <span className="font-medium text-slate-900">{p.project}</span>
                </button>
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

// NEW: Assignees Section - moved from Raw Data
const AssigneesSection = ({ stats }) => {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900 mb-4">Assignee Details</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-semibold text-slate-700">Assignee</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">Stories</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">Bugs</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">Tasks/Sub-tasks</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">Active SP</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">Completed SP</th>
                <th className="px-4 py-3 text-center font-semibold text-slate-700">Capacity Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {Object.entries(stats).map(([assignee, data]) => (
                <tr key={assignee} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{assignee}</td>
                  <td className="px-4 py-3 text-center text-gray-700">{data.stories}</td>
                  <td className="px-4 py-3 text-center text-gray-700">{data.bugs}</td>
                  <td className="px-4 py-3 text-center text-gray-700">{data.tasks + data.subtasks}</td>
                  <td className="px-4 py-3 text-center font-semibold text-red-600">{data.activeWorkload.toFixed(1)}</td>
                  <td className="px-4 py-3 text-center text-green-600 font-semibold">{data.totalCompletedSP.toFixed(1)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-1.5 rounded-full text-sm font-bold ${
                      data.capacityStatus === 'Has Capacity' ? 'bg-green-100 text-green-800 border-2 border-green-300' :
                      data.capacityStatus === 'Fully Allocated' ? 'bg-amber-100 text-amber-800 border-2 border-amber-300' :
                      'bg-red-100 text-red-800 border-2 border-red-300'
                    }`}>
                      {data.capacityStatus}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// Theme Analysis Section - Sprint composition and strategic focus visualization
const ThemeAnalysisSection = ({ filteredData, selectedSprint, selectedAssignee, selectedProject }) => {
  // Compute all visualization data using useMemo
  const themeAnalysisData = useMemo(() => {
    if (!filteredData || filteredData.length === 0) {
      return null;
    }

    console.log('🎨 Theme Analysis - Processing', filteredData.length, 'items');
    console.log('🎨 First item sample:', filteredData[0]);

    // Initialize counters
    const workTypeCounts = { 'Story': 0, 'Bug': 0, 'Task': 0, 'Sub-task': 0 };
    const epicCounts = {};
    const epicStoryPoints = {};
    const projectCounts = {};
    const projectStoryPoints = {};
    const priorityCounts = { 'High': 0, 'Medium': 0, 'Low': 0, 'Unassigned': 0 };
    const categoryCounts = {};
    
    let totalStoryPoints = 0;
    const uniqueEpics = new Set();
    const uniqueProjects = new Set();

    // Process each issue
    filteredData.forEach(item => {
      const type = item['Issue Type'];
      const epicName = item['Epic Name'] || 'No Epic';
      const project = item['Project'] || item['B'];
      const priority = item['Priority'] || 'Unassigned';
      const sp = parseFloat(item['Story Points']) || 0;
      const labels = item['Labels'] || [];
      const components = item['Components'] || [];

      // Work type distribution (exclude Epics)
      if (workTypeCounts.hasOwnProperty(type)) {
        workTypeCounts[type]++;
      }

      // Epic distribution
      epicCounts[epicName] = (epicCounts[epicName] || 0) + 1;
      epicStoryPoints[epicName] = (epicStoryPoints[epicName] || 0) + sp;
      if (epicName !== 'No Epic') uniqueEpics.add(epicName);

      // Project distribution
      if (project) {
        projectCounts[project] = (projectCounts[project] || 0) + 1;
        projectStoryPoints[project] = (projectStoryPoints[project] || 0) + sp;
        uniqueProjects.add(project);
      }

      // Priority distribution
      if (priorityCounts.hasOwnProperty(priority)) {
        priorityCounts[priority]++;
      } else {
        priorityCounts['Unassigned']++;
      }

      // Feature categories (labels and components)
      const categories = [...labels, ...components];
      if (categories.length === 0) {
        categoryCounts['Uncategorized'] = (categoryCounts['Uncategorized'] || 0) + 1;
      } else {
        categories.forEach(cat => {
          if (cat) {
            categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
          }
        });
      }

      // Total story points
      totalStoryPoints += sp;
    });

    // Convert to chart data formats
    const total = Object.values(workTypeCounts).reduce((a, b) => a + b, 0);
    const workTypeData = Object.entries(workTypeCounts)
      .filter(([_, count]) => count > 0)
      .map(([name, value]) => ({
        name,
        value,
        percentage: ((value / total) * 100).toFixed(1)
      }));

    const epicData = Object.entries(epicCounts)
      .map(([name, count]) => ({
        name,
        count,
        storyPoints: epicStoryPoints[name]
      }))
      .sort((a, b) => b.count - a.count);

    const projectData = Object.entries(projectCounts)
      .map(([name, count]) => ({
        name,
        count,
        storyPoints: projectStoryPoints[name]
      }))
      .sort((a, b) => b.count - a.count);

    const priorityData = Object.entries(priorityCounts)
      .filter(([_, count]) => count > 0)
      .map(([name, value]) => ({
        name,
        value
      }));

    const categoryData = Object.entries(categoryCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    console.log('🎨 Theme Analysis Data:', {
      workTypeData,
      epicData: epicData.length,
      projectData: projectData.length,
      priorityData,
      categoryData: categoryData.length
    });

    return {
      totalIssues: filteredData.length,
      totalStoryPoints,
      uniqueEpics: uniqueEpics.size,
      uniqueProjects: uniqueProjects.size,
      workTypeData,
      epicData,
      projectData,
      priorityData,
      categoryData
    };
  }, [filteredData]);

  // Empty data state
  if (!themeAnalysisData) {
    console.log('⚠️ Theme Analysis: No data available', { 
      filteredDataLength: filteredData?.length,
      filteredDataSample: filteredData?.[0] 
    });
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <PieChart className="w-16 h-16 mx-auto text-gray-400 mb-4" />
          <p className="text-gray-500 text-lg">No sprint data available for the selected filters</p>
        </div>
      </div>
    );
  }

  // TODO: Add visualizations
  return (
    <div className="space-y-6">
      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Issues</p>
              <p className="text-3xl font-bold text-blue-600">{themeAnalysisData.totalIssues}</p>
            </div>
            <CheckCircle className="w-12 h-12 text-blue-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Story Points</p>
              <p className="text-3xl font-bold text-purple-600">{themeAnalysisData.totalStoryPoints.toFixed(1)}</p>
            </div>
            <Target className="w-12 h-12 text-purple-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Unique Epics</p>
              <p className="text-3xl font-bold text-green-600">{themeAnalysisData.uniqueEpics}</p>
            </div>
            <Briefcase className="w-12 h-12 text-green-500 opacity-20" />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Unique Projects</p>
              <p className="text-3xl font-bold text-orange-600">{themeAnalysisData.uniqueProjects}</p>
            </div>
            <LayoutDashboard className="w-12 h-12 text-orange-500 opacity-20" />
          </div>
        </div>
      </div>

      {/* TODO: Add charts */}
      
      {/* Work Type Distribution & Priority Mix */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Work Type Pie Chart */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Work Type Distribution</h3>
          {themeAnalysisData.workTypeData.length > 0 ? (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer width="100%" height="100%" key="work-type-chart">
                <RechartsPieChart key={`work-type-${themeAnalysisData.workTypeData.length}`}>
                  <Pie
                    data={themeAnalysisData.workTypeData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percentage }) => `${name}: ${percentage}%`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {themeAnalysisData.workTypeData.map((entry, index) => {
                      const colors = {
                        'Story': '#3b82f6',
                        'Bug': '#ef4444',
                        'Task': '#eab308',
                        'Sub-task': '#a855f7'
                      };
                      return <Cell key={`cell-${index}`} fill={colors[entry.name] || '#64748b'} />;
                    })}
                  </Pie>
                  <RechartsTooltip 
                    formatter={(value, name, props) => [
                      `${value} issues (${props.payload.percentage}%)`,
                      props.payload.name
                    ]}
                  />
                  <Legend />
                </RechartsPieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-gray-400">
              No work type data available
            </div>
          )}
        </div>

        {/* Priority Mix Pie Chart */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">Priority Mix</h3>
          {themeAnalysisData.priorityData.length > 0 ? (
            <div style={{ width: '100%', height: 300 }}>
              <ResponsiveContainer width="100%" height="100%" key="priority-chart">
                <RechartsPieChart key={`priority-${themeAnalysisData.priorityData.length}`}>
                  <Pie
                    data={themeAnalysisData.priorityData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => {
                      const total = themeAnalysisData.priorityData.reduce((sum, item) => sum + item.value, 0);
                      const percentage = ((value / total) * 100).toFixed(1);
                      return `${name}: ${percentage}%`;
                    }}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {themeAnalysisData.priorityData.map((entry, index) => {
                      const colors = {
                        'High': '#ef4444',
                        'Medium': '#eab308',
                        'Low': '#22c55e',
                        'Unassigned': '#64748b'
                      };
                      return <Cell key={`cell-${index}`} fill={colors[entry.name] || '#64748b'} />;
                    })}
                  </Pie>
                  <RechartsTooltip 
                    formatter={(value, name, props) => {
                      const total = themeAnalysisData.priorityData.reduce((sum, item) => sum + item.value, 0);
                      const percentage = ((value / total) * 100).toFixed(1);
                      return [`${value} issues (${percentage}%)`, props.payload.name];
                    }}
                  />
                  <Legend />
                </RechartsPieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-gray-400">
              No priority data available
            </div>
          )}
        </div>
      </div>

      {/* Epic Distribution Bar Chart */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Epic Distribution</h3>
        {themeAnalysisData.epicData.length > 0 ? (
          <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer width="100%" height="100%" key="epic-chart">
              <BarChart data={themeAnalysisData.epicData} layout="horizontal" key={`epic-${themeAnalysisData.epicData.length}`}>
                <XAxis 
                  type="category" 
                  dataKey="name" 
                  angle={-45}
                  textAnchor="end"
                  height={100}
                  interval={0}
                />
                <YAxis type="number" />
                <RechartsTooltip 
                  formatter={(value, name) => {
                    if (name === 'count') return [value, 'Issues'];
                    if (name === 'storyPoints') return [value.toFixed(1), 'Story Points'];
                    return [value, name];
                  }}
                />
                <Legend />
                <Bar dataKey="count" fill="#3b82f6" name="Issue Count" />
                <Bar dataKey="storyPoints" fill="#a855f7" name="Story Points" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center h-[400px] text-gray-400">
            No epic data available
          </div>
        )}
      </div>

      {/* Project Focus Bar Chart */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Project Focus</h3>
        {themeAnalysisData.projectData.length > 0 ? (
          <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer width="100%" height="100%" key="project-chart">
              <BarChart data={themeAnalysisData.projectData} layout="vertical" key={`project-${themeAnalysisData.projectData.length}`}>
                <XAxis type="number" />
                <YAxis 
                  type="category" 
                  dataKey="name" 
                  width={150}
                />
                <RechartsTooltip 
                  formatter={(value, name) => {
                    if (name === 'count') return [value, 'Issues'];
                    if (name === 'storyPoints') return [value.toFixed(1), 'Story Points'];
                    return [value, name];
                  }}
                />
                <Legend />
                <Bar dataKey="count" fill="#10b981" name="Issue Count" />
                <Bar dataKey="storyPoints" fill="#f59e0b" name="Story Points" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center h-[400px] text-gray-400">
            No project data available
          </div>
        )}
      </div>

      {/* Feature Categories Bar Chart */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4">Feature Categories (Top 10)</h3>
        {themeAnalysisData.categoryData.length > 0 ? (
          <div style={{ width: '100%', height: 400 }}>
            <ResponsiveContainer width="100%" height="100%" key="category-chart">
              <BarChart data={themeAnalysisData.categoryData} layout="horizontal" key={`category-${themeAnalysisData.categoryData.length}`}>
                <XAxis 
                  type="category" 
                  dataKey="name" 
                  angle={-45}
                  textAnchor="end"
                  height={100}
                  interval={0}
                />
                <YAxis type="number" />
                <RechartsTooltip 
                  formatter={(value) => [value, 'Issues']}
                />
                <Bar dataKey="count" fill="#8b5cf6" name="Issue Count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center h-[400px] text-gray-400">
            No category data available
          </div>
        )}
      </div>
    </div>
  );
};

// Enhanced DataSection - simplified to show only tickets with filters
const DataSection = ({ stats, filteredData, selectedSprint, selectedAssignee, selectedProject }) => {
  const [showNoStoryPoints, setShowNoStoryPoints] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [hideDone, setHideDone] = useState(false);
  const [storiesOnly, setStoriesOnly] = useState(false);
  const [hideAwaitingTesting, setHideAwaitingTesting] = useState(false);
  const [hideAwaitingVersioning, setHideAwaitingVersioning] = useState(false);
  const [showFlaggedOnly, setShowFlaggedOnly] = useState(false);
  const [flaggedTickets, setFlaggedTickets] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('flaggedTickets') || '[]')); }
    catch { return new Set(); }
  });

  const toggleFlag = (key) => {
    setFlaggedTickets(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem('flaggedTickets', JSON.stringify([...next]));
      return next;
    });
  };

  const clearAllFlags = () => {
    setFlaggedTickets(new Set());
    localStorage.removeItem('flaggedTickets');
  };
  
  // NEW: Use ALL data, not just filteredData
  const allData = useMemo(() => {
    return filteredData;
  }, [filteredData]);

  // Issue type KPI counts
  const issueTypeCounts = useMemo(() => {
    const counts = {};
    allData.forEach(item => {
      const type = item['Issue Type'] || 'Other';
      counts[type] = (counts[type] || 0) + 1;
    });
    // Sort by count descending
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [allData]);

  const TYPE_STYLES = {
    'Story':    { bg: 'bg-blue-50',   border: 'border-blue-300',   text: 'text-blue-800',   icon: '📖' },
    'Bug':      { bg: 'bg-red-50',    border: 'border-red-300',    text: 'text-red-800',    icon: '🐛' },
    'Task':     { bg: 'bg-green-50',  border: 'border-green-300',  text: 'text-green-800',  icon: '✅' },
    'Sub-task': { bg: 'bg-slate-50',  border: 'border-slate-300',  text: 'text-slate-700',  icon: '🔹' },
    'Epic':     { bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-800', icon: '⚡' },
  };
  
  const displayData = useMemo(() => {
    let result = allData;
    if (typeFilter !== 'all') {
      result = result.filter(item => (item['Issue Type'] || 'Other') === typeFilter);
    }
    if (showNoStoryPoints) {
      result = result.filter(item => (parseFloat(item['Story Points']) || 0) === 0);
    }
    if (statusFilter !== 'all') {
      result = result.filter(item => item['Status'] === statusFilter);
    }
    if (hideDone) {
      result = result.filter(item => item['Status'] !== 'Done');
    }
    if (storiesOnly) {
      result = result.filter(item => item['Issue Type'] === 'Story');
    }
    if (hideAwaitingTesting) {
      result = result.filter(item => item['Status'] !== 'Awaiting Testing');
    }
    if (hideAwaitingVersioning) {
      result = result.filter(item => item['Status'] !== 'Awaiting Versioning');
    }
    if (showFlaggedOnly) {
      result = result.filter(item => flaggedTickets.has(item['Issue key'] || item['Key']));
    }
    return result;
  }, [allData, showNoStoryPoints, statusFilter, typeFilter, hideDone, storiesOnly, hideAwaitingTesting, hideAwaitingVersioning, showFlaggedOnly, flaggedTickets]);

  const exportToExcel = () => {
    // Prepare data for export
    const exportData = displayData.map(ticket => ({
      'Key': ticket['Issue key'] || ticket['Key'],
      'Type': ticket['Issue Type'],
      'Summary': ticket['Summary'],
      'Project': ticket['Project'] || ticket['B'],
      'Assignee': ticket['Assignee'] || ticket['D'] || 'Unassigned',
      'Status': ticket['Status'],
      'Story Points': parseFloat(ticket['Story Points']) || parseFloat(ticket['Story points']) || parseFloat(ticket['Custom field (Story Points)']) || 0,
      'Sprint': ticket['Sprint'] || ticket['G'] || '',
      'Priority': ticket['Priority'] || '',
      'Created': ticket['Created'] || '',
      'Updated': ticket['Updated'] || '',
      'Due Date': ticket['Due Date'] || ticket['Due date'] || ''
    }));

    // Convert to CSV
    const headers = Object.keys(exportData[0] || {});
    const csvContent = [
      headers.join(','),
      ...exportData.map(row => 
        headers.map(header => {
          const value = row[header] || '';
          // Escape quotes and wrap in quotes if contains comma
          const escaped = String(value).replace(/"/g, '""');
          return escaped.includes(',') || escaped.includes('\n') ? `"${escaped}"` : escaped;
        }).join(',')
      )
    ].join('\n');

    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `jira-export-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const statusCounts = useMemo(() => {
    const counts = { 'Done': 0, 'In Progress': 0, 'To Do': 0, 'Awaiting Testing': 0, 'Awaiting Versioning': 0, 'Other': 0 };
    allData.forEach(item => {
      const status = item['Status'];
      if (counts.hasOwnProperty(status)) counts[status]++;
      else counts['Other']++;
    });
    return counts;
  }, [allData]);

  return (
    <div className="space-y-6">
      {/* Issue Type KPI Row */}
      {issueTypeCounts.length > 0 && (
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Issue Types — click to filter</p>
          <div className="flex flex-wrap gap-3">
            {issueTypeCounts.map(([type, count]) => {
              const style = TYPE_STYLES[type] || { bg: 'bg-slate-50', border: 'border-slate-300', text: 'text-slate-700', icon: '🔷' };
              const isActive = typeFilter === type;
              return (
                <button
                  key={type}
                  onClick={() => setTypeFilter(isActive ? 'all' : type)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all hover:shadow-md ${
                    isActive
                      ? `${style.bg} ${style.border} ring-2 ring-offset-1 shadow-lg`
                      : `${style.bg} ${style.border} hover:opacity-80`
                  }`}
                >
                  <span>{style.icon}</span>
                  <span className={`text-2xl font-bold ${style.text}`}>{count}</span>
                  <span className={`text-sm font-medium ${style.text}`}>{type}</span>
                  {isActive && <span className={`text-xs ${style.text} ml-1`}>✓</span>}
                </button>
              );
            })}
            {typeFilter !== 'all' && (
              <button
                onClick={() => setTypeFilter('all')}
                className="flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-slate-100 text-slate-600 text-sm font-medium hover:bg-slate-200 transition-all"
              >
                ✕ Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Status Filter Cards */}
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

      {(statusFilter !== 'all' || showNoStoryPoints || hideDone || storiesOnly || typeFilter !== 'all') && (
        <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="text-sm text-blue-800">
              <span className="font-semibold">Active Filters:</span>
              {statusFilter !== 'all' && <span className="inline-block bg-blue-200 px-3 py-1 rounded ml-2 text-xs font-medium">{statusFilter}</span>}
              {typeFilter !== 'all' && <span className="inline-block bg-blue-200 px-3 py-1 rounded ml-2 text-xs font-medium">Type: {typeFilter}</span>}
              {showNoStoryPoints && <span className="inline-block bg-blue-200 px-3 py-1 rounded ml-2 text-xs font-medium">No Story Points</span>}
              {hideDone && <span className="inline-block bg-blue-200 px-3 py-1 rounded ml-2 text-xs font-medium">Hide Done</span>}
              {storiesOnly && <span className="inline-block bg-blue-200 px-3 py-1 rounded ml-2 text-xs font-medium">Stories Only</span>}
            </div>
            <button onClick={() => { setStatusFilter('all'); setTypeFilter('all'); setShowNoStoryPoints(false); setHideDone(false); setStoriesOnly(false); }} className="text-sm text-blue-600 hover:text-blue-800 font-semibold underline">
              Clear All
            </button>
          </div>
        </div>
      )}

      {/* All Tickets Table - NO HEADING, just tickets */}
      <div className="bg-white rounded-xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <p className="text-sm text-slate-500">
              Showing {displayData.length} of {allData.length} extracted tickets
            </p>
          </div>
          
          <div className="flex flex-wrap gap-3">
            <button
              onClick={exportToExcel}
              disabled={displayData.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
            >
              <Download className="w-4 h-4" />
              Export to Excel
            </button>
            
            <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors">
              <input 
                type="checkbox" 
                checked={storiesOnly} 
                onChange={() => setStoriesOnly(!storiesOnly)}
                className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
              />
              <span className="text-slate-700 text-sm font-medium select-none">Stories Only</span>
            </label>
            
            <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors">
              <input 
                type="checkbox" 
                checked={hideDone} 
                onChange={() => setHideDone(!hideDone)}
                className="w-4 h-4 text-green-600 rounded focus:ring-green-500"
              />
              <span className="text-slate-700 text-sm font-medium select-none">Hide Completed</span>
            </label>
            
            <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors">
              <input 
                type="checkbox" 
                checked={hideAwaitingTesting} 
                onChange={() => setHideAwaitingTesting(!hideAwaitingTesting)}
                className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
              />
              <span className="text-slate-700 text-sm font-medium select-none">Hide Awaiting Testing</span>
            </label>

            <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors">
              <input 
                type="checkbox" 
                checked={hideAwaitingVersioning} 
                onChange={() => setHideAwaitingVersioning(!hideAwaitingVersioning)}
                className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
              />
              <span className="text-slate-700 text-sm font-medium select-none">Hide Awaiting Versioning</span>
            </label>
            
            <label className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors">
              <input 
                type="checkbox" 
                checked={showNoStoryPoints} 
                onChange={() => setShowNoStoryPoints(!showNoStoryPoints)}
                className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
              />
              <span className="text-slate-700 text-sm font-medium select-none">No Story Points Only</span>
            </label>

            <button
              onClick={() => setShowFlaggedOnly(!showFlaggedOnly)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${
                showFlaggedOnly
                  ? 'bg-orange-500 border-orange-500 text-white'
                  : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-orange-50 hover:border-orange-300'
              }`}
            >
              🚩 Flagged{flaggedTickets.size > 0 && <span className={`px-1.5 py-0.5 rounded-full text-xs font-bold ${showFlaggedOnly ? 'bg-white text-orange-600' : 'bg-orange-500 text-white'}`}>{flaggedTickets.size}</span>}
            </button>

            {flaggedTickets.size > 0 && (
              <button
                onClick={clearAllFlags}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-100 text-slate-500 text-sm hover:bg-red-50 hover:text-red-600 hover:border-red-300 transition-colors"
              >
                ✕ Clear Flags
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm text-left text-slate-700">
            <thead className="text-xs text-slate-600 uppercase bg-slate-50 font-bold">
              <tr>
                <th className="px-3 py-3 text-center w-10">🚩</th>
                <th className="px-4 py-3">Key</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 w-1/3">Summary</th>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Assignee</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-center">SP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {displayData.length > 0 ? (
                displayData.slice(0, 200).map((ticket, idx) => {
                  const key = ticket['Issue key'] || ticket['Key'];
                  const isFlagged = flaggedTickets.has(key);
                  const sp = parseFloat(ticket['Story Points']) || 
                         parseFloat(ticket['Story points']) ||
                         parseFloat(ticket['Custom field (Story Points)']) ||
                         0;
                  return (
                    <tr key={idx} className={`transition-colors hover:bg-slate-50 ${isFlagged ? 'bg-orange-50' : 'bg-white'}`}>
                      <td className="px-3 py-3 text-center">
                        <button
                          onClick={() => toggleFlag(key)}
                          title={isFlagged ? 'Remove flag' : 'Flag for sprint planning'}
                          className={`text-lg leading-none transition-all hover:scale-125 ${isFlagged ? 'opacity-100' : 'opacity-20 hover:opacity-60'}`}
                        >
                          🚩
                        </button>
                      </td>
                      <td className="px-4 py-3 font-mono font-medium text-blue-600 whitespace-nowrap">
                        {key}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {ticket['Issue Type']}
                      </td>
                      <td className="px-4 py-3">
                        <div className="truncate max-w-md text-slate-800" title={ticket['Summary']}>{ticket['Summary']}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {ticket['Project'] || ticket['B']}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-700">
                        {ticket['Assignee'] || ticket['D'] || 'Unassigned'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap
                          ${ticket['Status'] === 'Done' ? 'bg-green-100 text-green-800 border border-green-300' : 
                            ticket['Status'] === 'In Progress' ? 'bg-blue-100 text-blue-800 border border-blue-300' :
                            ticket['Status'] === 'To Do' ? 'bg-slate-100 text-slate-700 border border-slate-300' :
                            'bg-amber-100 text-amber-800 border border-amber-300'}
                        `}>
                          {ticket['Status']}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center font-mono font-bold text-slate-700">
                        {sp > 0 ? sp : '-'}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="8" className="px-4 py-8 text-center text-slate-500">
                    <div className="flex flex-col items-center justify-center">
                      <span className="text-3xl mb-2">{showFlaggedOnly ? '🚩' : '🔍'}</span>
                      <span className="font-medium">{showFlaggedOnly ? 'No flagged tickets' : 'No tickets found'}</span>
                      <span className="text-sm mt-1">{showFlaggedOnly ? 'Flag tickets using the 🚩 button on each row' : 'Try adjusting the filters above'}</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {displayData.length > 200 && (
            <div className="px-4 py-3 text-center text-slate-500 border-t border-slate-200 bg-slate-50">
              Showing first 200 of {displayData.length} items
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const TimelineSection = ({ 
  timelineData, 
  programEndDate, 
  setProgramEndDate, 
  getProjectColor, 
  onProjectClick, 
  projectTargets, 
  setProjectTargets, 
  selectedSprint,
  setSelectedSprint,
  selectedAssignee,
  setSelectedAssignee,
  selectedProject,
  setSelectedProject,
  sprints,
  assignees,
  projects,
  filteredData
}) => {
  console.log('📅 TimelineSection rendering with:', {
    timelineDataLength: timelineData.length,
    programEndDate,
    projectTargetsCount: Object.keys(projectTargets).length
  });
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [statusFilter, setStatusFilter] = useState('all');
  const [showInsights, setShowInsights] = useState(true);
  const [showGantt, setShowGantt] = useState(true);
  const [ongoingProjects, setOngoingProjects] = useState({});

  // Ticket visibility filters
  const [hideDoneTickets, setHideDoneTickets] = useState(false);
  const [hideTestingTickets, setHideTestingTickets] = useState(false);
  const [hideVersioningTickets, setHideVersioningTickets] = useState(false);

  const visibleTickets = useMemo(() => {
    if (!filteredData) return [];
    return filteredData.filter(item => {
      const status = item['Status'];
      if (hideDoneTickets && status === 'Done') return false;
      if (hideTestingTickets && status === 'Awaiting Testing') return false;
      if (hideVersioningTickets && status === 'Awaiting Versioning') return false;
      return true;
    });
  }, [filteredData, hideDoneTickets, hideTestingTickets, hideVersioningTickets]);

  const handleToggleOngoing = (projectName) => {
    setOngoingProjects(prev => ({
      ...prev,
      [projectName]: !prev[projectName]
    }));
  };
  
  // Show helpful message if no timeline data
  if (timelineData.length === 0) {
    return (
      <div className="space-y-6">
        <div className="bg-amber-50 border-l-4 border-amber-500 p-6 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-6 h-6 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-900 mb-2">No Timeline Data Available</h3>
              <p className="text-amber-800 text-sm mb-3">
                Timeline data requires sprint date information. This could mean:
              </p>
              <ul className="text-amber-700 text-sm space-y-1 ml-4 list-disc">
                <li>Sprint dates are not being extracted from Jira API data</li>
                <li>Your Jira issues don't have sprint information</li>
                <li>The data transformation is not capturing sprint dates</li>
              </ul>
              <p className="text-amber-800 text-sm mt-3 font-semibold">
                💡 Check the browser console (F12) for "TIMELINE DATA CALCULATION" logs to debug.
              </p>
              <div className="mt-4 p-3 bg-amber-100 rounded border border-amber-300">
                <p className="text-xs text-amber-900 font-mono">
                  Look for: "🗓️ === TIMELINE DATA CALCULATION START ===" in console
                </p>
              </div>
            </div>
          </div>
        </div>
        
        {/* Still show ticket list even if timeline is empty */}
        {filteredData && filteredData.length > 0 && (
          <div className="bg-slate-900 rounded-2xl p-8 shadow-2xl border border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-6 mb-6">
              <div>
                <h3 className="text-2xl font-bold text-white">Sprint Backlog Items</h3>
                <p className="text-slate-400 mt-1">{filteredData.length} items available</p>
              </div>
            </div>
            <div className="text-center py-8 text-slate-400">
              <p>Ticket list available once timeline data is loaded</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  const enhancedTimelineData = useMemo(() => {
    return timelineData.map(project => {
      const customTarget = projectTargets[project.project];
      const effectiveEnd = customTarget || project.endDate;
      const projectedEnd = new Date(effectiveEnd);
      const daysToTarget = Math.ceil((projectedEnd - today) / (1000 * 60 * 60 * 24));
      const isComplete = project.percentComplete >= 100;
      const isOngoing = ongoingProjects[project.project] || false;
      
      let status, isDelayed, isEarly;
      if (isOngoing) {
        status = 'Ongoing';
        isDelayed = false;
        isEarly = false;
      } else {
        isDelayed = daysToTarget < 0 && !isComplete;
        isEarly = daysToTarget > 14 && !isComplete;
        status = isComplete ? 'Complete' : isDelayed ? 'Delayed' : isEarly ? 'Early' : 'On Track';
      }
      const sortOrder = isOngoing ? 4 : isDelayed ? 0 : isEarly ? 1 : status === 'On Track' ? 2 : 3;

      return {
        ...project,
        effectiveEndDate: effectiveEnd,
        daysToTarget,
        isComplete,
        isDelayed,
        isEarly,
        isOngoing,
        sortOrder,
        status
      };
    });
  }, [timelineData, projectTargets, ongoingProjects]);

  const filteredAndSortedData = useMemo(() => {
    let data = enhancedTimelineData;
    if (statusFilter !== 'all') {
      data = data.filter(p => p.status === statusFilter);
    }
    return data.sort((a, b) => a.sortOrder - b.sortOrder);
  }, [enhancedTimelineData, statusFilter]);

  const ganttDates = filteredAndSortedData.flatMap(p => [p.startDate, p.effectiveEndDate]);
  if (programEndDate) ganttDates.push(programEndDate);
  const ganttMin = ganttDates.length ? new Date(Math.min(...ganttDates.map(d => new Date(d)))) : today;
  const ganttMax = ganttDates.length ? new Date(Math.max(...ganttDates.map(d => new Date(d)))) : today;
  ganttMin.setMonth(ganttMin.getMonth() - 1);
  ganttMax.setMonth(ganttMax.getMonth() + 2);
  const ganttTotalDays = Math.ceil((ganttMax - ganttMin) / (1000 * 60 * 60 * 24));
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
  const analytics = useMemo(() => {
    const complete = filteredAndSortedData.filter(p => p.isComplete).length;
    const onTrack = filteredAndSortedData.filter(p => p.status === 'On Track').length;
    const early = filteredAndSortedData.filter(p => p.status === 'Early').length;
    const delayed = filteredAndSortedData.filter(p => p.isDelayed).length;
    const ongoing = filteredAndSortedData.filter(p => p.isOngoing).length;
    const totalSP = filteredAndSortedData.reduce((sum, p) => sum + p.totalSP, 0);
    const completedSP = filteredAndSortedData.reduce((sum, p) => sum + p.completedSP, 0);
    const avgDays = filteredAndSortedData.length > 0 
      ? (filteredAndSortedData.reduce((sum, p) => sum + p.daysToTarget, 0) / filteredAndSortedData.length).toFixed(1)
      : 0;

    return { complete, onTrack, early, delayed, ongoing, totalSP, completedSP, avgDays: parseFloat(avgDays), total: filteredAndSortedData.length };
  }, [filteredAndSortedData]);
  const insights = [];
  if (analytics.delayed > 0) insights.push(`⚠️ ${analytics.delayed} project${analytics.delayed > 1 ? 's are' : ' is'} delayed`);
  if (analytics.early > 0) insights.push(`✓ ${analytics.early} project${analytics.early > 1 ? 's are' : ' is'} ahead`);
  if (analytics.complete > 0) insights.push(`✓ ${analytics.complete} project${analytics.complete > 1 ? 's' : ''} completed`);
  if (analytics.ongoing > 0) insights.push(`🔄 ${analytics.ongoing} ongoing project${analytics.ongoing > 1 ? 's' : ''}`);
  if (analytics.avgDays !== 0) insights.push(`Overall ${Math.abs(analytics.avgDays)} days ${analytics.avgDays > 0 ? 'ahead' : 'behind'}`);

  return (
    <div className="space-y-8">
      {/* Header Section */}
      <div className="flex flex-wrap items-center justify-between gap-6">
        <div>
          <h2 className="text-4xl font-bold text-white mb-2">Program Timeline</h2>
          <p className="text-lg text-slate-400">Project delivery status and scheduling</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button 
            onClick={() => setStatusFilter('Delayed')} 
            className={`px-5 py-2.5 rounded-lg font-semibold transition-all ${statusFilter === 'Delayed' ? 'bg-red-600 text-white shadow-lg shadow-red-500/30' : 'bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700'}`}
          >
            🔴 Delayed Only
          </button>
          <select 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-5 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500 hover:bg-slate-700 transition-all"
          >
            <option value="all">All Projects</option>
            <option value="Delayed">Delayed</option>
            <option value="Early">Early</option>
            <option value="On Track">On Track</option>
            <option value="Complete">Complete</option>
            <option value="Ongoing">Ongoing</option>
          </select>
          <button 
            onClick={() => setShowGantt(!showGantt)}
            className="px-5 py-2.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 font-semibold border border-slate-700 transition-all"
          >
            {showGantt ? '👁️ Hide' : '👁️‍🗨️ Show'} Overlap View
          </button>
          <div className="flex items-center gap-3 bg-slate-800 px-4 py-2.5 rounded-lg border border-slate-700">
            <span className="text-slate-300 font-semibold">🎯 Program Target:</span>
            <input 
              type="date" 
              value={programEndDate} 
              onChange={(e) => setProgramEndDate(e.target.value)}
              className="px-4 py-1.5 bg-slate-900 border border-slate-600 rounded-md text-white font-medium focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl p-5 border border-slate-700 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <Briefcase className="w-8 h-8 text-blue-400" />
            <span className="text-4xl font-bold text-white">{analytics.total}</span>
          </div>
          <div className="text-sm font-semibold text-slate-300">Total Projects</div>
        </div>
        
        <div className="bg-gradient-to-br from-green-900/40 to-green-950/40 rounded-xl p-5 border border-green-700/50 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <CheckCircle className="w-8 h-8 text-green-400" />
            <span className="text-4xl font-bold text-green-300">{analytics.complete}</span>
          </div>
          <div className="text-sm font-semibold text-green-200">Complete</div>
        </div>
        
        <div className="bg-gradient-to-br from-emerald-900/40 to-emerald-950/40 rounded-xl p-5 border border-emerald-700/50 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <TrendingUp className="w-8 h-8 text-emerald-400" />
            <span className="text-4xl font-bold text-emerald-300">{analytics.onTrack + analytics.early}</span>
          </div>
          <div className="text-sm font-semibold text-emerald-200">On Track/Early</div>
        </div>
        
        <div className="bg-gradient-to-br from-red-900/40 to-red-950/40 rounded-xl p-5 border border-red-700/50 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <span className="text-4xl font-bold text-red-300">{analytics.delayed}</span>
          </div>
          <div className="text-sm font-semibold text-red-200">Delayed</div>
        </div>
        
        <div className="bg-gradient-to-br from-blue-900/40 to-blue-950/40 rounded-xl p-5 border border-blue-700/50 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <Calendar className="w-8 h-8 text-blue-400" />
            <span className={`text-4xl font-bold ${analytics.avgDays >= 0 ? 'text-green-300' : 'text-amber-300'}`}>
              {analytics.avgDays >= 0 ? `+${analytics.avgDays}` : analytics.avgDays}
            </span>
          </div>
          <div className="text-sm font-semibold text-blue-200">Avg Days to Target</div>
        </div>
        
        <div className="bg-gradient-to-br from-purple-900/40 to-purple-950/40 rounded-xl p-5 border border-purple-700/50 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <Target className="w-8 h-8 text-purple-400" />
            <span className="text-3xl font-bold text-purple-300">{analytics.completedSP.toFixed(0)}/{analytics.totalSP.toFixed(0)}</span>
          </div>
          <div className="text-sm font-semibold text-purple-200">Story Points</div>
        </div>
      </div>

      {/* Smart Insights */}
      {showInsights && insights.length > 0 && (
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 border border-slate-700 rounded-2xl p-8 shadow-2xl backdrop-blur-sm">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-2xl font-bold text-white flex items-center gap-3">
              <span className="text-3xl">💡</span>
              Smart Insights
            </h3>
            <button 
              onClick={() => setShowInsights(false)} 
              className="text-slate-400 hover:text-white text-2xl w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-700 transition-all"
            >
              ×
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {insights.map((insight, i) => (
              <div key={i} className="bg-slate-800/60 rounded-xl px-5 py-4 flex items-center gap-4 border border-slate-700 hover:border-slate-600 transition-all">
                <span className="text-3xl">{insight.split(' ')[0]}</span>
                <span className="text-base text-slate-200 font-medium">{insight.substring(insight.indexOf(' ') + 1)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gantt Chart / Overlap View */}
      {showGantt && (
        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 rounded-2xl p-8 shadow-2xl border border-slate-700 backdrop-blur-sm">
          <h3 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
            <span className="text-3xl">📊</span>
            Project Overlap & Concurrency
          </h3>
          
          {/* Horizontal Month Timeline */}
          <div className="relative mb-8 bg-slate-900/50 rounded-xl p-6 border border-slate-700">
            {/* Month Headers */}
            <div className="flex justify-between items-center mb-4">
              {monthHeader.map((m, i) => (
                <div key={i} className="flex-1 text-center">
                  <div className="text-xl font-bold text-white">{m.month}</div>
                  <div className="text-sm text-slate-400">{m.year}</div>
                </div>
              ))}
            </div>
            
            {/* Timeline Bar */}
            <div className="relative h-8 bg-slate-800 rounded-lg overflow-hidden">
              {/* Gradient bar showing time progression */}
              <div className="absolute inset-0 bg-gradient-to-r from-red-500 via-purple-500 via-blue-500 to-cyan-500 opacity-80"></div>
              
              {/* Overlap zones */}
              {overlapZones.map((zone, i) => (
                <div key={i}
                  className="absolute top-0 bottom-0 bg-amber-500/30 border-t-2 border-b-2 border-amber-400"
                  style={{ left: `${zone.start}%`, width: `${zone.end - zone.start}%` }}
                />
              ))}
            </div>
            
            {/* Legend */}
            <div className="flex items-center justify-between mt-4 text-sm">
              <div className="flex items-center gap-3 text-slate-400">
                <div className="w-4 h-4 bg-amber-500/30 border border-amber-400 rounded"></div>
                <span>High overlap zone (≥3 projects)</span>
              </div>
              <div className="text-slate-300 font-semibold">
                {filteredAndSortedData.length} active projects shown
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Project Timeline Details Table */}
      <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 rounded-2xl p-8 shadow-2xl border border-slate-700 backdrop-blur-sm">
        <h3 className="text-3xl font-bold text-white mb-8 flex items-center gap-3">
          <span className="text-3xl">📅</span>
          Project Timeline Details
        </h3>
        <div className="overflow-x-auto rounded-xl border border-slate-700 shadow-lg">
          <table className="w-full text-sm" style={{ minWidth: '1100px' }}>
            <thead className="bg-slate-800/80">
              <tr className="border-b border-slate-700">
                <th className="py-4 px-6 text-left font-semibold text-slate-300" style={{ width: '20%' }}>Project</th>
                <th className="py-4 px-6 text-left font-semibold text-slate-300" style={{ width: '25%' }}>Progress</th>
                <th className="py-4 px-6 text-center font-semibold text-slate-300" style={{ width: '12%' }}>Start Date</th>
                <th className="py-4 px-6 text-center font-semibold text-slate-300" style={{ width: '12%' }}>Target End</th>
                <th className="py-4 px-6 text-center font-semibold text-slate-300" style={{ width: '8%' }}>Ongoing</th>
                <th className="py-4 px-6 text-center font-semibold text-slate-300" style={{ width: '13%' }}>Days to Target</th>
                <th className="py-4 px-6 text-center font-semibold text-slate-300" style={{ width: '10%' }}>Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {filteredAndSortedData.map((project, i) => (
                <tr key={i} className="hover:bg-slate-800/30 transition-all group bg-slate-900/40">
                  <td className="py-4 px-6">
                    <button
                      onClick={() => onProjectClick(project.project)}
                      className="flex items-center gap-3 hover:opacity-80 transition-all"
                    >
                      <span className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: getProjectColor(project.project) }}>
                      </span>
                      <span className="font-medium text-white text-left">{project.project}</span>
                    </button>
                  </td>
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-slate-700/50 rounded-full h-6 overflow-hidden border border-slate-600 min-w-[140px]">
                        <div
                          className="h-6 rounded-full transition-all duration-500 relative"
                          style={{
                            width: `${project.percentComplete}%`,
                            background: `linear-gradient(90deg, ${getProjectColor(project.project)}, ${getProjectColor(project.project)}dd)`,
                          }}
                        >
                          {project.percentComplete > 20 && (
                            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
                              {project.percentComplete}%
                            </span>
                          )}
                        </div>
                      </div>
                      {project.percentComplete <= 20 && (
                        <span className="text-sm font-bold text-white">
                          {project.percentComplete}%
                        </span>
                      )}
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {project.completedSP.toFixed(0)} SP
                      </span>
                    </div>
                  </td>
                  <td className="py-4 px-6 text-center">
                    <div className="text-sm font-medium text-slate-300">
                      {project.startDate ? new Date(project.startDate).toLocaleDateString('en-GB') : '-'}
                    </div>
                  </td>
                  <td className="py-4 px-6 text-center">
                    <input
                      type="date"
                      value={projectTargets[project.project] || project.endDate}
                      onChange={(e) =>
                        setProjectTargets(prev => ({
                          ...prev,
                          [project.project]: e.target.value,
                        }))
                      }
                      disabled={project.isOngoing}
                      className={`px-2 py-1.5 border rounded text-xs focus:ring-2 focus:ring-blue-500 w-full transition-all ${
                        project.isOngoing 
                          ? 'bg-slate-700/50 border-slate-600 text-slate-500 cursor-not-allowed' 
                          : 'bg-slate-800 border-slate-600 text-white hover:bg-slate-750'
                      }`}
                    />
                  </td>
                  <td className="py-4 px-6 text-center">
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={project.isOngoing}
                        onChange={() => handleToggleOngoing(project.project)}
                        className="w-4 h-4 text-blue-500 bg-slate-800 border-slate-600 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
                      />
                    </label>
                  </td>
                  <td className="py-4 px-6 text-center">
                    <div
                      className={`text-lg font-bold ${
                        project.isOngoing
                          ? 'text-blue-400'
                          : project.isComplete
                          ? 'text-green-400'
                          : project.daysToTarget >= 0
                          ? 'text-green-400'
                          : 'text-red-400'
                      }`}
                    >
                      {project.isOngoing
                        ? '∞'
                        : project.isComplete
                        ? '✓'
                        : project.daysToTarget >= 0
                        ? `${project.daysToTarget}d`
                        : `${Math.abs(project.daysToTarget)}d late`}
                    </div>
                  </td>
                  <td className="py-4 px-6 text-center">
                    <span
                      className={`px-3 py-1.5 rounded-full text-xs font-bold ${
                        project.isOngoing
                          ? 'bg-blue-900/40 text-blue-300 border border-blue-700/50'
                          : project.isComplete
                          ? 'bg-emerald-900/40 text-emerald-300 border border-emerald-700/50'
                          : project.isDelayed
                          ? 'bg-red-900/40 text-red-300 border border-red-700/50'
                          : 'bg-green-900/40 text-green-300 border border-green-700/50'
                      }`}
                    >
                      {project.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filteredAndSortedData.length === 0 && (
          <div className="text-center py-20 bg-slate-800/30 rounded-xl border border-slate-700">
            <div className="text-7xl mb-6">📊</div>
            <h4 className="text-2xl font-bold text-slate-300 mb-3">
              No projects match the selected filter
            </h4>
            <p className="text-lg text-slate-400">
              Try changing the status filter or upload more data
            </p>
          </div>
        )}

        {/* How to Use Guide */}
        <div className="mt-8 p-6 bg-gradient-to-br from-slate-800/60 to-slate-900/60 rounded-xl border border-slate-700">
          <h4 className="text-xl font-bold text-white mb-5 flex items-center gap-2">
            <span className="text-2xl">💡</span>
            How to Use This Timeline
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="flex items-start gap-4 p-4 bg-slate-800/40 rounded-lg border border-slate-700/50">
              <span className="text-3xl">🎯</span>
              <div>
                <h5 className="text-base font-semibold text-white mb-1">Set Target Dates</h5>
                <p className="text-sm text-slate-400">
                  Use the date picker to adjust project target end dates
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-slate-800/40 rounded-lg border border-slate-700/50">
              <span className="text-3xl">🔄</span>
              <div>
                <h5 className="text-base font-semibold text-white mb-1">Mark as Ongoing</h5>
                <p className="text-sm text-slate-400">
                  Check "Ongoing" for projects with no fixed end date
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-slate-800/40 rounded-lg border border-slate-700/50">
              <span className="text-3xl">⚠️</span>
              <div>
                <h5 className="text-base font-semibold text-white mb-1">Monitor Delays</h5>
                <p className="text-sm text-slate-400">
                  Red projects are delayed and need immediate attention
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4 p-4 bg-slate-800/40 rounded-lg border border-slate-700/50">
              <span className="text-3xl">👀</span>
              <div>
                <h5 className="text-base font-semibold text-white mb-1">Track Overlap</h5>
                <p className="text-sm text-slate-400">
                  Amber zones show where 3+ projects overlap (resource contention)
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SprintDashboard;
