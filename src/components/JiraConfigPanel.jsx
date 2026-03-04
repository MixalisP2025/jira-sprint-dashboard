import React, { useState, useMemo } from 'react';
import { Settings, Calendar, Database, Save, X, Plus, AlertCircle, CheckCircle, Code } from 'lucide-react';
import { JIRA_CONFIG, buildJQL } from '../config/jiraConfig.js';

// ─── JQL parser / validator ───────────────────────────────────────────────────
function parseJQL(jql) {
  const errors = [];
  const warnings = [];

  if (!jql || !jql.trim()) {
    errors.push('JQL query is empty.');
    return { valid: false, errors, warnings };
  }

  // Basic structural checks
  const openParens  = (jql.match(/\(/g) || []).length;
  const closeParens = (jql.match(/\)/g) || []).length;
  if (openParens !== closeParens) errors.push(`Unbalanced parentheses: ${openParens} opening, ${closeParens} closing.`);

  const openQuotes = (jql.match(/"/g) || []).length;
  if (openQuotes % 2 !== 0) errors.push('Unmatched double-quote character.');

  // Warn about common mistakes
  if (/\bAND\s+AND\b/i.test(jql)) warnings.push('Double AND detected — possible typo.');
  if (/\bOR\s+OR\b/i.test(jql)) warnings.push('Double OR detected — possible typo.');
  if (/=\s*$/.test(jql.trim())) errors.push('Query ends with an operator — missing value.');

  // Extract project keys from JQL for cross-check
  const projectMatch = jql.match(/project\s+in\s*\(([^)]+)\)/i);
  const jqlProjects = projectMatch
    ? projectMatch[1].split(',').map(p => p.trim().replace(/^["']|["']$/g, ''))
    : [];

  return { valid: errors.length === 0, errors, warnings, jqlProjects };
}

// Extract project list from a JQL string
function extractProjectsFromJQL(jql) {
  const m = jql.match(/project\s+in\s*\(([^)]+)\)/i);
  if (!m) return [];
  return m[1].split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));
}

// Rebuild the project(...) clause in a JQL string with a new project list
function rebuildProjectsInJQL(jql, projects) {
  const clause = `project in (${projects.map(p => `"${p}"`).join(',')})`;
  if (/project\s+in\s*\([^)]+\)/i.test(jql)) {
    return jql.replace(/project\s+in\s*\([^)]+\)/i, clause);
  }
  return clause + (jql.trim() ? ' AND ' + jql.trim() : '');
}

const BASE_PROJECTS = ['CC', 'WTR1', 'DND', 'CSFR', 'AISITS', 'ACI', 'CSR', 'AFMS', 'AFSDWAM', 'BROAD', 'BMS', 'CADEP', 'CCTA', 'CTONGO', 'CABO', 'CPM', 'CS000344', 'CFT', 'CS00300', 'CS00304', 'CS00332', 'INSETT', 'CSAU', 'IRROA', 'SMSI', 'CS00386', 'CSDRECONC', 'CS00398A', 'CS00398B', 'CNBIL408', 'CS00415PT', 'CSB', 'CS00429', 'CS00434', 'CBAHESF', 'CS441SAPD', 'COGP', 'TRFCSPRM', 'CCPI', 'DRM', 'DWHP', 'NXCLR', 'ECBS', 'FAA', 'FSM', 'BSWAP21', 'ISE', 'INTTAX', 'MOS', 'MDP', 'MCA', 'OGSN', 'OTPCA', 'PIR', 'PIRSOW', 'PEWS', 'PS', 'RC', 'RF', 'RB', 'SSP', 'SRFCSS', 'SETINPFILE', 'SSLM', 'SD', 'SIR', 'SPROJ', 'SRDUAT', 'STLU', 'SI', 'T2S', 'TT', 'TP', 'T0ORS', 'UP', 'UPB', 'UPNTOLD', 'WFNDS', 'WBILL', 'XPRES', 'XPONGO', 'QO00443'];

const JiraConfigPanel = ({ isOpen, onClose, onConfigChange }) => {
  const [daysBack, setDaysBack]         = useState(JIRA_CONFIG.dateRange.daysBack ?? '');
  const [selectedProjects, setSelectedProjects] = useState([...JIRA_CONFIG.projects]);
  const [extraProjects, setExtraProjects]       = useState([]); // user-added keys not in BASE_PROJECTS
  const [newProjectKey, setNewProjectKey]       = useState('');
  const [newProjectError, setNewProjectError]   = useState('');

  // JQL editor state
  const [jqlMode, setJqlMode]     = useState(false); // false = visual, true = raw JQL
  const [rawJQL, setRawJQL]       = useState('');
  const [jqlParsed, setJqlParsed] = useState(null);  // result of parseJQL

  // All known projects = base + any user-added extras
  const allProjects = useMemo(() => {
    const set = new Set([...BASE_PROJECTS, ...extraProjects]);
    return Array.from(set);
  }, [extraProjects]);

  // Live JQL preview (visual mode)
  const previewJQL = useMemo(() => {
    return buildJQL({ ...JIRA_CONFIG, dateRange: { daysBack }, projects: selectedProjects });
  }, [selectedProjects, daysBack]);

  // Switch to raw JQL mode — seed with current preview
  function enterJqlMode() {
    setRawJQL(previewJQL);
    setJqlParsed(null);
    setJqlMode(true);
  }

  // Parse & validate the raw JQL
  function handleParseJQL() {
    const result = parseJQL(rawJQL);
    setJqlParsed(result);
    // Sync checkboxes from JQL if valid
    if (result.valid && result.jqlProjects.length > 0) {
      const known = result.jqlProjects.filter(p => allProjects.includes(p));
      const unknown = result.jqlProjects.filter(p => !allProjects.includes(p));
      setSelectedProjects(result.jqlProjects);
      if (unknown.length > 0) {
        setExtraProjects(prev => [...new Set([...prev, ...unknown])]);
      }
    }
  }

  // Add a new project key
  function handleAddProject() {
    const key = newProjectKey.trim().toUpperCase();
    if (!key) { setNewProjectError('Enter a project key.'); return; }
    if (!/^[A-Z0-9_]+$/.test(key)) { setNewProjectError('Keys must be letters, numbers, or underscores.'); return; }
    if (allProjects.includes(key)) { setNewProjectError(`${key} already exists.`); return; }
    setExtraProjects(prev => [...prev, key]);
    setSelectedProjects(prev => [...prev, key]);
    setNewProjectKey('');
    setNewProjectError('');
  }

  function toggleProject(key) {
    setSelectedProjects(prev =>
      prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]
    );
  }

  function handleSave() {
    let finalJQL = jqlMode ? rawJQL : previewJQL;

    // If in JQL mode, sync projects from JQL back to config
    if (jqlMode) {
      const extracted = extractProjectsFromJQL(rawJQL);
      if (extracted.length > 0) {
        JIRA_CONFIG.projects = extracted;
      } else {
        JIRA_CONFIG.projects = [...selectedProjects];
      }
    } else {
      JIRA_CONFIG.projects = [...selectedProjects];
    }

    JIRA_CONFIG.dateRange.daysBack = daysBack === '' ? null : Number(daysBack);

    if (onConfigChange) {
      onConfigChange({ ...JIRA_CONFIG, jql: finalJQL });
    }
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-slate-800 rounded-xl p-6 w-full max-w-2xl border border-slate-700 my-8 shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-blue-400" />
            <h2 className="text-xl font-semibold text-white">Jira Configuration</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-6">

          {/* Date Range */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
              <Calendar className="w-4 h-4" />
              Date Range (days back)
            </label>
            <input
              type="number" min="1" max="365"
              value={daysBack}
              onChange={e => setDaysBack(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-400 mt-1">
              {daysBack === '' ? 'No date limit (fetch all history)' : `Fetch issues updated in the last ${daysBack} days`}
            </p>
          </div>

          {/* Mode toggle */}
          <div className="flex gap-2">
            <button
              onClick={() => setJqlMode(false)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${!jqlMode ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              Visual (checkboxes)
            </button>
            <button
              onClick={enterJqlMode}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${jqlMode ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
            >
              <Code className="w-4 h-4" /> Raw JQL
            </button>
          </div>

          {/* ── VISUAL MODE ── */}
          {!jqlMode && (
            <>
              {/* Add new project */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                  <Plus className="w-4 h-4" />
                  Add New Project Key
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g. MYPROJ"
                    value={newProjectKey}
                    onChange={e => { setNewProjectKey(e.target.value.toUpperCase()); setNewProjectError(''); }}
                    onKeyDown={e => e.key === 'Enter' && handleAddProject()}
                    className="flex-1 px-3 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase"
                  />
                  <button
                    onClick={handleAddProject}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium transition-colors"
                  >
                    Add
                  </button>
                </div>
                {newProjectError && <p className="text-xs text-red-400 mt-1">{newProjectError}</p>}
              </div>

              {/* Project checkboxes */}
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-slate-300 mb-2">
                  <Database className="w-4 h-4" />
                  Projects ({selectedProjects.length} selected)
                </label>
                <div className="space-y-1 max-h-64 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg p-3">
                  {allProjects.map(project => (
                    <label key={project} className="flex items-center gap-2 text-sm hover:bg-slate-800 px-2 py-1 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedProjects.includes(project)}
                        onChange={() => toggleProject(project)}
                        className="rounded border-slate-600 bg-slate-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-0"
                      />
                      <span className="text-slate-300">{project}</span>
                      {!BASE_PROJECTS.includes(project) && (
                        <span className="text-xs text-blue-400 ml-auto">new</span>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              {/* JQL preview */}
              <div>
                <label className="text-sm font-medium text-slate-300 mb-2 block">JQL Preview</label>
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 max-h-24 overflow-y-auto">
                  <code className="text-xs text-green-400 break-all">{previewJQL}</code>
                </div>
              </div>
            </>
          )}

          {/* ── RAW JQL MODE ── */}
          {jqlMode && (
            <div>
              <label className="text-sm font-medium text-slate-300 mb-2 block">Edit JQL Query</label>
              <textarea
                value={rawJQL}
                onChange={e => { setRawJQL(e.target.value); setJqlParsed(null); }}
                rows={6}
                className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-green-400 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
                spellCheck={false}
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleParseJQL}
                  className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 text-sm font-medium transition-colors flex items-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" /> Parse &amp; Validate
                </button>
                <button
                  onClick={() => { setRawJQL(previewJQL); setJqlParsed(null); }}
                  className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm transition-colors"
                >
                  Reset to visual
                </button>
              </div>

              {/* Validation result */}
              {jqlParsed && (
                <div className={`mt-3 p-3 rounded-lg border text-sm ${jqlParsed.valid ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-red-500/10 border-red-500/30 text-red-400'}`}>
                  {jqlParsed.valid ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      <span>JQL looks valid.{jqlParsed.jqlProjects.length > 0 ? ` Found ${jqlParsed.jqlProjects.length} project(s) — checkboxes synced.` : ''}</span>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 mb-1"><AlertCircle className="w-4 h-4 shrink-0" /><strong>Errors:</strong></div>
                      <ul className="list-disc list-inside space-y-1 text-xs">
                        {jqlParsed.errors.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                  {jqlParsed.warnings.length > 0 && (
                    <div className="mt-2 text-yellow-400 text-xs">
                      <strong>Warnings:</strong>
                      <ul className="list-disc list-inside">{jqlParsed.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
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
