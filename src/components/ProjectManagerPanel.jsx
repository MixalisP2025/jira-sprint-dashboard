import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { Briefcase, RefreshCw, FileText, Plus, EyeOff, Eye, AlertCircle, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { jiraService } from '../utils/jiraService';
import { buildPortfolio, findNewProjects, projectMatches, HEALTH, HEALTH_LABEL, T } from '../utils/projectPortfolio';
import { HEALTH_STYLE, SECTIONS, describeProject, fmtDate } from '../utils/projectReport';
import ProjectStatusReportModal from './ProjectStatusReportModal';

// The project manager view: what is tracked, how each project is doing against its
// target date, and what is new in Jira that you have not decided about yet.
//
// Two rules this panel holds to:
//  · A status is never shown without the numbers behind it. Each row carries the rate
//    measured, the forecast, and the rate that would be needed.
//  · Nothing enters the portfolio on its own. A project appearing in Jira is a prompt,
//    not a decision — you press Track or Ignore.

const HEALTH_ORDER = SECTIONS.map(s => s.key);

function HealthPill({ health }) {
  const s = HEALTH_STYLE[health] || HEALTH_STYLE[HEALTH.NO_DATA];
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-0.5 whitespace-nowrap"
      style={{ color: s.color, background: `${s.color}1a`, border: `1px solid ${s.color}55` }}
    >
      <span aria-hidden>{s.dot}</span>{HEALTH_LABEL[health]}
    </span>
  );
}

function ProjectRow({ p, onTargetChange, onOwnerChange, onNoteChange, onUntrack }) {
  const [open, setOpen] = useState(false);
  const s = HEALTH_STYLE[p.health] || HEALTH_STYLE[HEALTH.NO_DATA];
  const bar = Math.max(0, Math.min(100, p.percentComplete));

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 min-w-0 text-left">
            {open ? <ChevronDown className="w-4 h-4 text-slate-400 flex-none" /> : <ChevronRight className="w-4 h-4 text-slate-400 flex-none" />}
            <span className="font-semibold text-slate-900 truncate">{p.project}</span>
            {p.owner && <span className="text-xs text-slate-500 truncate">· {p.owner}</span>}
          </button>
          <div className="flex items-center gap-2 flex-none">
            <span className="text-xs text-slate-500 tabular-nums">{p.percentComplete}%</span>
            <HealthPill health={p.health} />
          </div>
        </div>

        <div className="mt-2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${bar}%`, background: s.color }} />
        </div>

        {/* The evidence line — the same sentence the weekly report will carry. */}
        <p className="mt-2 text-xs text-slate-600 leading-relaxed">{describeProject(p)}</p>
      </div>

      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-slate-100 bg-slate-50/60">
          <div className="grid gap-3 sm:grid-cols-3 mt-3">
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Target end date</span>
              <input
                type="date"
                value={p.targetDate || ''}
                onChange={e => onTargetChange(p.project, e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-400 outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Owner</span>
              <input
                type="text"
                value={p.owner || ''}
                onChange={e => onOwnerChange(p.project, e.target.value)}
                placeholder="Who is accountable"
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-400 outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Note for the report</span>
              <input
                type="text"
                value={p.note || ''}
                onChange={e => onNoteChange(p.project, e.target.value)}
                placeholder="e.g. waiting on vendor"
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm text-slate-800 focus:ring-2 focus:ring-blue-400 outline-none"
              />
            </label>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-4 text-xs">
            <div><span className="text-slate-500">Scope</span><div className="font-semibold text-slate-800">{p.totalSP} SP · {p.items} items</div></div>
            <div><span className="text-slate-500">Remaining</span><div className="font-semibold text-slate-800">{p.remainingSP} SP</div></div>
            <div><span className="text-slate-500">Rate</span><div className="font-semibold text-slate-800">{p.spPerWeek == null ? '—' : `${p.spPerWeek} SP/wk`}</div></div>
            <div><span className="text-slate-500">Forecast</span><div className="font-semibold text-slate-800">{p.beyondHorizon ? 'beyond horizon' : fmtDate(p.forecastDate)}</div></div>
          </div>

          {p.unpointedItems > 0 && (
            <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
              {p.unpointedItems} of {p.items} items carry no story points, so they are invisible to the forecast.
            </p>
          )}

          <button onClick={() => onUntrack(p.project)} className="mt-3 text-xs text-slate-500 hover:text-red-600 inline-flex items-center gap-1.5"
            title="Moves it to the Not tracked list at the bottom, where you can track it again">
            <EyeOff className="w-3.5 h-3.5" /> Stop tracking — moves to “Not tracked”, reversible
          </button>
        </div>
      )}
    </div>
  );
}

export default function ProjectManagerPanel({
  data,
  tracked, ignored, configured = [], projectTargets, projectMeta, snapshots,
  onTrack, onIgnore, onUntrack, onTargetChange, onOwnerChange, onNoteChange,
}) {
  const [jiraProjects, setJiraProjects] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [showReport, setShowReport] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [showIgnored, setShowIgnored] = useState(false);
  const now = useMemo(() => new Date(), []);

  const portfolio = useMemo(
    () => buildPortfolio(data, { tracked, projectTargets, projectMeta, now }),
    [data, tracked, projectTargets, projectMeta, now],
  );

  const newProjects = useMemo(
    () => (jiraProjects ? findNewProjects(jiraProjects, { tracked, ignored, configured }) : []),
    [jiraProjects, tracked, ignored, configured],
  );

  const checkJira = useCallback(async () => {
    setChecking(true); setCheckError('');
    try {
      const list = await jiraService.getProjects();
      setJiraProjects(Array.isArray(list) ? list : (list?.values || []));
    } catch (e) {
      // A failed check must not look like "no new projects" — that would quietly
      // tell you everything is accounted for when nothing was actually compared.
      setCheckError(e?.message || 'Could not reach Jira.');
      setJiraProjects(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => { checkJira(); }, [checkJira]);

  // Everything dismissed or untracked, so it can be put back. Untracking adds to
  // `ignored` (otherwise the project would resurface under "New in Jira" and the
  // untrack would look broken) — but without this list that made untracking a
  // one-way door, recoverable only by retyping the project's exact display name.
  const ignoredList = useMemo(() => {
    const jira = jiraProjects || [];
    return (ignored || []).map(id => {
      const match = jira.find(j => projectMatches(id, { key: j.key, name: j.name }));
      return { id, label: match && match.name && match.name !== id ? `${id} — ${match.name}` : id };
    }).sort((a, b) => a.id.localeCompare(b.id));
  }, [ignored, jiraProjects]);

  const counts = useMemo(() => {
    const c = {};
    portfolio.forEach(p => { c[p.health] = (c[p.health] || 0) + 1; });
    return c;
  }, [portfolio]);

  const addManual = () => {
    // Deliberately NOT uppercased. A tracked identifier is matched against the row's
    // Project field, which is a display name like "CS00451 - Crypto Currencies";
    // upper-casing it would stop it matching anything and the project would show as
    // tracked but empty.
    const key = manualKey.trim();
    if (!key) return;
    onTrack(key);
    setManualKey('');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Briefcase className="w-5 h-5 text-blue-500" />
          <div>
            <h3 className="text-lg font-bold text-slate-900">Project Manager</h3>
            <p className="text-xs text-slate-500">
              {portfolio.length} tracked · forecast from delivery rate over the last {T.velocityWindow} completed sprints
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={checkJira} disabled={checking}
            className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50 text-sm font-medium">
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Check Jira for new projects
          </button>
          <button onClick={() => setShowReport(true)} disabled={!portfolio.length}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 text-sm font-medium">
            <FileText className="w-4 h-4" /> Weekly report
          </button>
        </div>
      </div>

      {/* Health spread */}
      {portfolio.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {HEALTH_ORDER.filter(h => counts[h]).map(h => {
            const s = HEALTH_STYLE[h];
            return (
              <div key={h} className="rounded-lg px-3 py-1.5" style={{ background: `${s.color}14`, border: `1px solid ${s.color}44` }}>
                <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: s.color }}>{HEALTH_LABEL[h]}</span>
                <span className="text-sm font-bold text-slate-800 ml-2 tabular-nums">{counts[h]}</span>
              </div>
            );
          })}
        </div>
      )}

      {checkError && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 flex-none mt-0.5" />
          <span>Could not check Jira for new projects — {checkError} Nothing below is wrong, but this list may be missing projects added recently.</span>
        </div>
      )}

      {/* New in Jira — a prompt, never an automatic decision */}
      {newProjects.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="text-xs font-bold uppercase tracking-wide text-blue-800 mb-2">
            New in Jira ({newProjects.length}) — not yet tracked
          </div>
          <div className="space-y-1.5">
            {newProjects.map(p => (
              <div key={p.key} className="flex flex-wrap items-center justify-between gap-2 bg-white rounded-lg border border-blue-200 px-3 py-2">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-semibold text-blue-700">{p.key}</span>
                  <span className="text-sm text-slate-700 ml-2 truncate">{p.name}</span>
                </div>
                <div className="flex gap-2 flex-none">
                  <button onClick={() => onTrack(p.key)} className="text-xs font-medium px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-500">Track</button>
                  <button onClick={() => onIgnore(p.key)} className="text-xs font-medium px-2.5 py-1 bg-white border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50">Ignore</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {jiraProjects && newProjects.length === 0 && !checkError && (
        <p className="text-xs text-slate-500">
          Nothing new in Jira — all {jiraProjects.length} projects are already tracked, ignored, or in the fetch config.
        </p>
      )}

      {/* Add by key, for a project that exists in the data but not in Jira's list */}
      <div className="flex items-center gap-2">
        <input
          value={manualKey}
          onChange={e => setManualKey(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addManual(); }}
          placeholder="Track by key or name, e.g. CS00470"
          className="px-3 py-2 border border-slate-300 rounded-lg text-sm w-full max-w-xs focus:ring-2 focus:ring-blue-400 outline-none"
        />
        <button onClick={addManual} disabled={!manualKey.trim()}
          className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 disabled:opacity-40 text-sm font-medium">
          <Plus className="w-4 h-4" /> Track
        </button>
      </div>

      {/* Projects, worst news first, grouped by what you would do about them */}
      {portfolio.length === 0 ? (
        <div className="text-center py-10 bg-white rounded-xl border border-slate-200">
          <Briefcase className="w-10 h-10 mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-600 font-medium">No projects tracked yet.</p>
          <p className="text-xs text-slate-500 mt-1">Track one from the list above, or add a key directly.</p>
        </div>
      ) : (
        SECTIONS.map(({ key, title }) => {
          const list = portfolio.filter(p => p.health === key);
          if (!list.length) return null;
          const s = HEALTH_STYLE[key];
          return (
            <div key={key} className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wide pb-1 border-b-2" style={{ color: s.color, borderColor: s.border }}>
                {title} <span className="text-slate-400 font-medium">({list.length})</span>
              </div>
              {list.map(p => (
                <ProjectRow
                  key={p.project}
                  p={p}
                  onTargetChange={onTargetChange}
                  onOwnerChange={onOwnerChange}
                  onNoteChange={onNoteChange}
                  onUntrack={onUntrack}
                />
              ))}
            </div>
          );
        })
      )}

      {/* Everything not tracked, and the way back. Collapsed by default so it stays out
          of the way, but present so untracking is reversible without retyping a name. */}
      {ignoredList.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200">
          <button
            onClick={() => setShowIgnored(o => !o)}
            className="w-full flex items-center justify-between gap-2 px-4 py-2.5 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              {showIgnored ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
              Not tracked
              <span className="text-slate-400 font-medium">({ignoredList.length})</span>
            </span>
            <span className="text-xs text-slate-500">{showIgnored ? 'Hide' : 'Show — you can track any of these again'}</span>
          </button>

          {showIgnored && (
            <div className="px-4 pb-4 space-y-1.5 border-t border-slate-100 pt-3">
              {ignoredList.map(item => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 rounded-lg border border-slate-200 px-3 py-2">
                  <span className="text-sm text-slate-700 min-w-0 truncate">{item.label}</span>
                  <button
                    onClick={() => onTrack(item.id)}
                    className="flex-none flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-500"
                  >
                    <Eye className="w-3.5 h-3.5" /> Track
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showReport && (
        <ProjectStatusReportModal
          portfolio={portfolio}
          snapshots={snapshots}
          scopeLabel={`${portfolio.length} tracked project${portfolio.length === 1 ? '' : 's'}`}
          now={now}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}
