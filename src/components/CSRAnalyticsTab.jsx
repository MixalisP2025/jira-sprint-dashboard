import React, { useState, useEffect, useMemo } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Cell
} from 'recharts';
import { fetchCSRIssues, transformCSRIssue } from '../utils/csrService.js';

// ---------------------------------------------------------------------------
// ISO week helper
// ---------------------------------------------------------------------------

/**
 * Returns the ISO week string 'YYYY-Www' for a given date string.
 * Uses the standard ISO 8601 week algorithm.
 * @param {string} dateStr - ISO date string
 * @returns {string} e.g. '2025-W03'
 */
export function getISOWeek(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';

  // Copy date so we don't mutate original
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

  // ISO week: Thursday of the week determines the year
  // Set to nearest Thursday: current date + 4 - current day number (Mon=1, Sun=7)
  const dayNum = date.getUTCDay() || 7; // convert Sunday (0) to 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);

  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  const year = date.getUTCFullYear();

  return `${year}-W${String(weekNo).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Chart data helpers
// ---------------------------------------------------------------------------

/**
 * Groups tickets by ISO week of their created date.
 * @param {object[]} tickets
 * @returns {{ week: string, count: number }[]} sorted ascending by week
 */
export function buildWeeklyVolume(tickets) {
  const map = {};
  for (const t of tickets) {
    const week = getISOWeek(t.created);
    if (!week) continue;
    map[week] = (map[week] || 0) + 1;
  }
  return Object.entries(map)
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

/**
 * Groups resolved tickets by ISO week of their resolved date and computes avg resolution days.
 * @param {object[]} tickets
 * @returns {{ week: string, avgDays: number }[]} sorted ascending by week
 */
export function buildResolutionTrend(tickets) {
  const map = {};
  for (const t of tickets) {
    if (!t.resolved || !t.created) continue;
    const week = getISOWeek(t.resolved);
    if (!week) continue;
    const days = Math.floor(
      (new Date(t.resolved) - new Date(t.created)) / 86400000
    );
    if (!map[week]) map[week] = { total: 0, count: 0 };
    map[week].total += days;
    map[week].count += 1;
  }
  return Object.entries(map)
    .map(([week, { total, count }]) => ({ week, avgDays: total / count }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

/**
 * Builds backlog growth data per ISO week.
 * @param {object[]} tickets
 * @returns {{ week: string, created: number, resolved: number, delta: number, cumulative: number }[]}
 */
export function buildBacklogGrowth(tickets) {
  const map = {};

  for (const t of tickets) {
    const cWeek = getISOWeek(t.created);
    if (cWeek) {
      if (!map[cWeek]) map[cWeek] = { created: 0, resolved: 0 };
      map[cWeek].created += 1;
    }
    if (t.resolved) {
      const rWeek = getISOWeek(t.resolved);
      if (rWeek) {
        if (!map[rWeek]) map[rWeek] = { created: 0, resolved: 0 };
        map[rWeek].resolved += 1;
      }
    }
  }

  const rows = Object.entries(map)
    .map(([week, { created, resolved }]) => ({ week, created, resolved, delta: created - resolved }))
    .sort((a, b) => a.week.localeCompare(b.week));

  let cumulative = 0;
  for (const row of rows) {
    cumulative += row.delta;
    row.cumulative = cumulative;
  }

  return rows;
}

/**
 * Groups tickets by (ISO week of created, assignee).
 * @param {object[]} tickets
 * @returns {{ data: object[], assignees: string[] }}
 *   data: array of { week, [assigneeName]: count, ... } sorted ascending
 *   assignees: distinct assignee names
 */
export function buildAssigneeWorkload(tickets) {
  const weekMap = {};
  const assigneeSet = new Set();

  for (const t of tickets) {
    const week = getISOWeek(t.created);
    if (!week) continue;
    const assignee = t.assignee || 'Unassigned';
    assigneeSet.add(assignee);
    if (!weekMap[week]) weekMap[week] = {};
    weekMap[week][assignee] = (weekMap[week][assignee] || 0) + 1;
  }

  const assignees = Array.from(assigneeSet).sort();

  const data = Object.entries(weekMap)
    .map(([week, counts]) => ({ week, ...counts }))
    .sort((a, b) => a.week.localeCompare(b.week));

  return { data, assignees };
}

// ---------------------------------------------------------------------------
// Colour palette for assignees
// ---------------------------------------------------------------------------

const ASSIGNEE_COLORS = [
  '#6366f1', '#f59e0b', '#10b981', '#ef4444', '#3b82f6',
  '#ec4899', '#14b8a6', '#f97316', '#8b5cf6', '#84cc16',
];

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function WeeklyVolumeChart({ data }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Tickets Created per Week</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip />
          <Bar dataKey="count" fill="#3b82f6" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function ResolutionTrendChart({ data }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Avg Resolution Days per Week</h3>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip formatter={(v) => v.toFixed(1)} />
          <Line
            type="monotone"
            dataKey="avgDays"
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={{ r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function BacklogGrowthChart({ data }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Cumulative Backlog Growth</h3>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip />
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke="#10b981"
            fill="#d1fae5"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function AssigneeHeatmap({ data, assignees }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Tickets per Assignee per Week</h3>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {assignees.map((assignee, i) => (
            <Bar
              key={assignee}
              dataKey={assignee}
              fill={ASSIGNEE_COLORS[i % ASSIGNEE_COLORS.length]}
              radius={[2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function CSRAnalyticsTab() {
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [includeLegacy, setIncludeLegacy] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await fetchCSRIssues();
      setIssues(raw.map(transformCSRIssue));
    } catch (e) {
      setError(e.message || 'Failed to load CSR issues');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filteredIssues = useMemo(() => {
    if (includeLegacy) return issues;
    const cutoff = new Date(Date.now() - 2 * 365 * 86400000);
    return issues.filter(t => !t.created || new Date(t.created) >= cutoff);
  }, [issues, includeLegacy]);

  const weeklyVolume    = useMemo(() => buildWeeklyVolume(filteredIssues), [filteredIssues]);
  const resolutionTrend = useMemo(() => buildResolutionTrend(filteredIssues), [filteredIssues]);
  const backlogGrowth   = useMemo(() => buildBacklogGrowth(filteredIssues), [filteredIssues]);
  const { data: assigneeData, assignees } = useMemo(() => buildAssigneeWorkload(filteredIssues), [filteredIssues]);

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-800">CSR Analytics</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
            <input type="checkbox" checked={includeLegacy} onChange={e => setIncludeLegacy(e.target.checked)} className="rounded" />
            Include legacy tickets (pre-2023)
          </label>
          <button onClick={load} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg shadow-sm hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />Refresh
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <Loader2 size={28} className="animate-spin mr-2" />
          Loading analytics…
        </div>
      )}

      {/* Charts grid */}
      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WeeklyVolumeChart data={weeklyVolume} />
          <ResolutionTrendChart data={resolutionTrend} />
          <BacklogGrowthChart data={backlogGrowth} />
          <AssigneeHeatmap data={assigneeData} assignees={assignees} />
        </div>
      )}
    </div>
  );
}
