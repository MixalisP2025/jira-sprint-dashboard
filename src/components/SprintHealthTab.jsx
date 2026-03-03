import React, { useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';
import { CheckCircle, AlertCircle, Clock, TrendingUp, Users, Zap } from 'lucide-react';

const SprintHealthTab = ({ tickets = [], sprints = [], selectedSprint, selectedAssignee, selectedProject }) => {
  const metrics = useMemo(() => {
    if (!tickets.length) return null;

    const total = tickets.length;
    const done = tickets.filter(t => {
      const s = (t['Status'] || '').toLowerCase();
      return s === 'done' || s === 'closed' || s === 'resolved';
    }).length;

    const inProgress = tickets.filter(t => {
      const s = (t['Status'] || '').toLowerCase();
      return s === 'in progress';
    }).length;

    const toDo = tickets.filter(t => {
      const s = (t['Status'] || '').toLowerCase();
      return s === 'to do' || s === 'open' || s === 'new';
    }).length;

    const awaiting = tickets.filter(t => {
      const s = (t['Status'] || '').toLowerCase();
      return s.includes('awaiting') || s.includes('testing') || s.includes('review');
    }).length;

    const completionRate = total > 0 ? Math.round((done / total) * 100) : 0;

    const totalSP = tickets.reduce((sum, t) => sum + (parseFloat(t['Story Points']) || 0), 0);
    const doneSP = tickets
      .filter(t => {
        const s = (t['Status'] || '').toLowerCase();
        return s === 'done' || s === 'closed' || s === 'resolved';
      })
      .reduce((sum, t) => sum + (parseFloat(t['Story Points']) || 0), 0);

    const activeSP = tickets
      .filter(t => {
        const s = (t['Status'] || '').toLowerCase();
        return s === 'in progress' || s === 'to do' || s === 'open' || s === 'new';
      })
      .reduce((sum, t) => sum + (parseFloat(t['Story Points']) || 0), 0);

    // Bugs
    const bugs = tickets.filter(t => (t['Issue Type'] || '') === 'Bug').length;
    const bugRate = total > 0 ? Math.round((bugs / total) * 100) : 0;

    // Unassigned
    const unassigned = tickets.filter(t => !t['Assignee'] || t['Assignee'] === 'Unassigned').length;

    // Overloaded assignees
    const spByAssignee = {};
    tickets.forEach(t => {
      const a = t['Assignee'] || 'Unassigned';
      const s = (t['Status'] || '').toLowerCase();
      const isActive = s === 'in progress' || s === 'to do' || s === 'open' || s === 'new';
      if (isActive) {
        spByAssignee[a] = (spByAssignee[a] || 0) + (parseFloat(t['Story Points']) || 0);
      }
    });
    const overloaded = Object.entries(spByAssignee).filter(([, sp]) => sp > 16).length;

    // Health score (0-100)
    let score = 100;
    if (completionRate < 30) score -= 20;
    else if (completionRate < 60) score -= 10;
    if (bugRate > 30) score -= 15;
    else if (bugRate > 15) score -= 7;
    if (overloaded > 0) score -= overloaded * 5;
    if (unassigned > total * 0.2) score -= 10;
    score = Math.max(0, Math.min(100, score));

    // Burndown-style data (simulate based on status distribution)
    const sprintList = sprints.filter(s => s !== 'all');
    const burndownData = sprintList.slice(0, 8).map((sprint, i) => {
      const sprintTickets = tickets.filter(t => {
        const ts = t['Sprint'] || t['G'] || '';
        return ts === sprint || ts.includes(sprint);
      });
      const sprintDone = sprintTickets.filter(t => {
        const s = (t['Status'] || '').toLowerCase();
        return s === 'done' || s === 'closed' || s === 'resolved';
      }).length;
      const sprintTotal = sprintTickets.length;
      return {
        sprint: sprint.length > 20 ? sprint.slice(-10) : sprint,
        completed: sprintDone,
        total: sprintTotal,
        rate: sprintTotal > 0 ? Math.round((sprintDone / sprintTotal) * 100) : 0,
      };
    }).reverse();

    // Project health breakdown
    const projectMap = {};
    tickets.forEach(t => {
      const proj = t['Project'] || t['B'] || 'Unknown';
      if (!projectMap[proj]) projectMap[proj] = { total: 0, done: 0, bugs: 0 };
      projectMap[proj].total++;
      const s = (t['Status'] || '').toLowerCase();
      if (s === 'done' || s === 'closed' || s === 'resolved') projectMap[proj].done++;
      if ((t['Issue Type'] || '') === 'Bug') projectMap[proj].bugs++;
    });

    const projectHealth = Object.entries(projectMap).map(([name, d]) => ({
      name,
      rate: d.total > 0 ? Math.round((d.done / d.total) * 100) : 0,
      total: d.total,
      done: d.done,
      bugs: d.bugs,
    })).sort((a, b) => b.total - a.total);

    // Focus actions
    const focusActions = [];
    if (overloaded > 0) focusActions.push(`${overloaded} assignee(s) overloaded — rebalance workload`);
    if (unassigned > 0) focusActions.push(`${unassigned} unassigned ticket(s) — assign to team members`);
    if (bugRate > 20) focusActions.push(`High bug rate (${bugRate}%) — prioritise bug fixes`);
    if (completionRate < 40 && selectedSprint !== 'all') focusActions.push(`Low completion rate (${completionRate}%) — review sprint scope`);

    return {
      total, done, inProgress, toDo, awaiting,
      completionRate, totalSP, doneSP, activeSP,
      bugs, bugRate, unassigned, overloaded,
      score, burndownData, projectHealth, focusActions,
    };
  }, [tickets, sprints, selectedSprint]);

  if (!tickets.length) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        No data loaded. Upload Jira data or refresh from Jira.
      </div>
    );
  }

  if (!metrics) return null;

  const scoreColor = metrics.score >= 75 ? 'text-green-400' : metrics.score >= 50 ? 'text-yellow-400' : 'text-red-400';
  const scoreBg = metrics.score >= 75 ? 'bg-green-500/10 border-green-500/30' : metrics.score >= 50 ? 'bg-yellow-500/10 border-yellow-500/30' : 'bg-red-500/10 border-red-500/30';

  return (
    <div className="space-y-6">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-blue-400" />
            <span className="text-xs text-slate-400">Completion Rate</span>
          </div>
          <div className="text-2xl font-bold text-white">{metrics.completionRate}%</div>
          <div className="text-xs text-slate-500">{metrics.done}/{metrics.total} tickets</div>
        </div>

        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-xs text-slate-400">Story Points Done</span>
          </div>
          <div className="text-2xl font-bold text-white">{metrics.doneSP.toFixed(0)}</div>
          <div className="text-xs text-slate-500">of {metrics.totalSP.toFixed(0)} total SP</div>
        </div>

        <div className="bg-slate-800 rounded-xl p-4 border border-slate-700">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="w-4 h-4 text-red-400" />
            <span className="text-xs text-slate-400">Bug Rate</span>
          </div>
          <div className="text-2xl font-bold text-white">{metrics.bugRate}%</div>
          <div className="text-xs text-slate-500">{metrics.bugs} bugs in scope</div>
        </div>

        <div className={`rounded-xl p-4 border ${scoreBg}`}>
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-4 h-4 text-purple-400" />
            <span className="text-xs text-slate-400">Health Score</span>
          </div>
          <div className={`text-2xl font-bold ${scoreColor}`}>{metrics.score}/100</div>
          <div className="text-xs text-slate-500">
            {metrics.score >= 75 ? 'Healthy' : metrics.score >= 50 ? 'Needs attention' : 'At risk'}
          </div>
        </div>
      </div>

      {/* Burndown Chart */}
      {metrics.burndownData.length > 1 && (
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h3 className="text-sm font-semibold text-slate-300 mb-4">Completion Rate by Sprint</h3>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics.burndownData}>
                <defs>
                  <linearGradient id="healthGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="sprint" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} unit="%" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  labelStyle={{ color: '#e2e8f0' }}
                  formatter={(v) => [`${v}%`, 'Completion']}
                />
                <Area type="monotone" dataKey="rate" stroke="#3b82f6" fill="url(#healthGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Project Health + Focus Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Project Health */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-400" />
            Project Health
          </h3>
          <div className="space-y-3">
            {metrics.projectHealth.slice(0, 6).map(proj => (
              <div key={proj.name}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-slate-300 truncate max-w-[60%]">{proj.name}</span>
                  <span className="text-slate-400">{proj.rate}% done · {proj.bugs} bugs</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full ${proj.rate >= 70 ? 'bg-green-500' : proj.rate >= 40 ? 'bg-yellow-500' : 'bg-red-500'}`}
                    style={{ width: `${proj.rate}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Focus Actions */}
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
          <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
            <Clock className="w-4 h-4 text-orange-400" />
            Focus Actions
          </h3>
          {metrics.focusActions.length === 0 ? (
            <div className="flex items-center gap-2 text-green-400 text-sm">
              <CheckCircle className="w-4 h-4" />
              Sprint looks healthy — no immediate actions needed
            </div>
          ) : (
            <ul className="space-y-2">
              {metrics.focusActions.map((action, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                  <AlertCircle className="w-4 h-4 text-orange-400 mt-0.5 shrink-0" />
                  {action}
                </li>
              ))}
            </ul>
          )}

          {/* Status breakdown */}
          <div className="mt-4 pt-4 border-t border-slate-700 grid grid-cols-2 gap-2 text-xs">
            <div className="text-slate-400">In Progress: <span className="text-white font-medium">{metrics.inProgress}</span></div>
            <div className="text-slate-400">To Do: <span className="text-white font-medium">{metrics.toDo}</span></div>
            <div className="text-slate-400">Awaiting: <span className="text-white font-medium">{metrics.awaiting}</span></div>
            <div className="text-slate-400">Unassigned: <span className="text-white font-medium">{metrics.unassigned}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SprintHealthTab;
