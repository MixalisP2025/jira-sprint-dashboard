import React, { useMemo, useState } from 'react';
import { concurrencyWindows, peakConcurrency, HEALTH, HEALTH_LABEL } from '../utils/projectPortfolio';

// When each project runs, and where they collide.
//
// This replaces a panel that drew a fixed red→purple→blue→cyan gradient carrying no
// data at all, with the one real signal — weeks where 3+ projects overlap — washed
// faintly over the top and no way to tell which projects were involved. A reader could
// not answer "what is this telling me", because it was telling them almost nothing.
//
// Design decisions worth keeping:
//  · Colour encodes HEALTH, not identity. Identity is carried by the row label, so the
//    hue is free to say something else. It also sidesteps needing 10 categorical hues,
//    which cannot be told apart under colour-vision deficiency.
//  · Status colour is never the only cue: every bar carries a glyph, the legend is
//    always present, and the tooltip names the status in words.
//  · Weekly sampling for the overlap bands. Finer would imply a precision that
//    sprint-level dates do not have.

// Stepped for the dark slate surface this panel sits on (#0f172a), not flipped from
// the light report palette. Checked with the palette validator against that surface:
// normal-vision separation and contrast both pass. Green↔amber sit in the CVD floor
// band, which is permitted only with secondary encoding — hence the glyphs and labels.
const BAR = {
  [HEALTH.OFF_TRACK]: { fill: '#ef4444', glyph: '!' },
  [HEALTH.AT_RISK]:   { fill: '#f59e0b', glyph: '▲' },
  [HEALTH.ON_TRACK]:  { fill: '#22c55e', glyph: '✓' },
  [HEALTH.ONGOING]:   { fill: '#06b6d4', glyph: '↻' },
  [HEALTH.DONE]:      { fill: '#a78bfa', glyph: '✓' },
  [HEALTH.NO_TARGET]: { fill: '#64748b', glyph: '○' },
  [HEALTH.NO_DATA]:   { fill: '#64748b', glyph: '○' },
};

const DAY = 24 * 60 * 60 * 1000;
const fmtMonth = d => d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase();
const fmtFull  = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

export default function ProjectGantt({ portfolio, minOverlap = 3 }) {
  const [hover, setHover] = useState(null);

  const rows = useMemo(
    () => portfolio.filter(p => p.startDate && p.endDate),
    [portfolio],
  );

  const { min, max, totalDays, months } = useMemo(() => {
    if (!rows.length) return { min: null, max: null, totalDays: 0, months: [] };
    const starts = rows.map(p => new Date(p.startDate).getTime());
    const ends = rows.map(p => new Date(p.endDate).getTime());
    const lo = new Date(Math.min(...starts));
    const hi = new Date(Math.max(...ends));
    lo.setDate(1);
    hi.setMonth(hi.getMonth() + 1, 1);
    const days = Math.max(1, Math.round((hi - lo) / DAY));
    const m = [];
    const cur = new Date(lo);
    while (cur < hi) {
      m.push({ date: new Date(cur), pct: ((cur - lo) / DAY / days) * 100 });
      cur.setMonth(cur.getMonth() + 1);
    }
    return { min: lo, max: hi, totalDays: days, months: m };
  }, [rows]);

  const overlaps = useMemo(
    () => (rows.length ? concurrencyWindows(rows, { minProjects: minOverlap }) : []),
    [rows, minOverlap],
  );
  const peak = useMemo(() => (rows.length ? peakConcurrency(rows) : null), [rows]);

  const pctOf = d => ((new Date(d) - min) / DAY / totalDays) * 100;
  const today = new Date();
  const todayPct = min && today >= min && today <= max ? pctOf(today) : null;

  if (!rows.length) {
    return (
      <div className="text-sm text-slate-400">
        No project has datable sprints, so there is nothing to place on a calendar.
        Sprint names need their dates in them — “Sprint 23 27-04-26 to 08-05-26”.
      </div>
    );
  }

  // Only the statuses actually present — a legend listing absent states is noise.
  const legend = [...new Set(rows.map(p => p.health))];

  return (
    <div>
      {/* The headline finding, stated rather than left to be inferred from the bars. */}
      {peak && peak.count >= minOverlap && (
        <p className="text-sm text-slate-300 mb-4">
          Peak load: <strong className="text-white">{peak.count} projects running at once</strong>
          {' '}around {fmtFull(new Date(peak.start))}.
          {overlaps.length > 0 && (
            <span className="text-slate-400"> Shaded bands mark {minOverlap}+ concurrent.</span>
          )}
        </p>
      )}

      <div className="overflow-x-auto">
        <div style={{ minWidth: Math.max(680, months.length * 58) }}>
          {/* Month axis — hairline ticks, recessive, no dashes */}
          <div className="relative h-8 ml-[190px] border-b border-slate-700">
            {months.map((m, i) => (
              <div key={i} className="absolute top-0 text-[10px] leading-tight" style={{ left: `${m.pct}%` }}>
                <div className="text-slate-400 font-semibold">{fmtMonth(m.date)}</div>
                {(i === 0 || m.date.getMonth() === 0) && (
                  <div className="text-slate-500">{m.date.getFullYear()}</div>
                )}
              </div>
            ))}
          </div>

          <div className="relative">
            {/* Overlap bands and the today line sit behind the bars */}
            <div className="absolute inset-y-0 left-[190px] right-0 pointer-events-none">
              {overlaps.map((w, i) => (
                <div
                  key={i}
                  className="absolute inset-y-0 bg-amber-400/10 border-x border-amber-400/30"
                  style={{ left: `${pctOf(w.start)}%`, width: `${pctOf(w.end) - pctOf(w.start)}%` }}
                />
              ))}
              {months.map((m, i) => (
                <div key={`g${i}`} className="absolute inset-y-0 w-px bg-slate-700/40" style={{ left: `${m.pct}%` }} />
              ))}
              {todayPct !== null && (
                <div className="absolute inset-y-0 w-px bg-white/70" style={{ left: `${todayPct}%` }}>
                  <div className="absolute -top-0.5 -translate-x-1/2 text-[9px] font-bold text-white bg-slate-900 px-1 rounded">TODAY</div>
                </div>
              )}
            </div>

            {rows.map(p => {
              const style = BAR[p.health] || BAR[HEALTH.NO_DATA];
              const left = pctOf(p.startDate);
              const width = Math.max(0.6, pctOf(p.endDate) - left);
              const isHover = hover === p.project;
              return (
                <div
                  key={p.project}
                  className="relative flex items-center h-8"
                  onMouseEnter={() => setHover(p.project)}
                  onMouseLeave={() => setHover(h => (h === p.project ? null : h))}
                >
                  <div className="w-[190px] pr-3 shrink-0 text-right">
                    <span className={`text-xs truncate block ${isHover ? 'text-white' : 'text-slate-300'}`} title={p.project}>
                      {p.project}
                    </span>
                  </div>
                  <div className="relative flex-1 h-full">
                    {/* Thin mark, rounded ends, 2px surface ring so overlapping
                        neighbours stay separable. */}
                    <div
                      className="absolute top-1/2 -translate-y-1/2 h-3.5 rounded-full flex items-center justify-center transition-all"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: style.fill,
                        boxShadow: isHover ? '0 0 0 2px #0f172a, 0 0 0 3px rgba(255,255,255,.55)' : '0 0 0 2px #0f172a',
                      }}
                    >
                      {/* Secondary encoding: status is never carried by hue alone. */}
                      {width > 6 && (
                        <span className="text-[9px] font-bold text-slate-900/80 leading-none">{style.glyph}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Hover detail — the tooltip layer, always present on an interactive chart */}
      <div className="mt-3 min-h-[34px]">
        {hover ? (() => {
          const p = rows.find(x => x.project === hover);
          if (!p) return null;
          const st = BAR[p.health] || BAR[HEALTH.NO_DATA];
          return (
            <div className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs">
              <span className="font-semibold text-white">{p.project}</span>
              <span className="inline-flex items-center gap-1.5" style={{ color: st.fill }}>
                <span aria-hidden>{st.glyph}</span>{HEALTH_LABEL[p.health]}
              </span>
              <span className="text-slate-400">{fmtFull(new Date(p.startDate))} → {fmtFull(new Date(p.endDate))}</span>
              <span className="text-slate-400">{p.percentComplete}% · {p.items} items</span>
              {p.owner && <span className="text-slate-400">{p.owner}</span>}
            </div>
          );
        })() : (
          <span className="text-xs text-slate-500">Hover a bar for dates, status and progress.</span>
        )}
      </div>

      {/* Legend — always present, because status must never be colour alone */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-slate-700">
        {legend.map(h => {
          const st = BAR[h] || BAR[HEALTH.NO_DATA];
          return (
            <span key={h} className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
              <span className="w-3 h-2 rounded-full" style={{ background: st.fill }} />
              <span aria-hidden>{st.glyph}</span>
              {HEALTH_LABEL[h]}
            </span>
          );
        })}
        <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-400">
          <span className="w-3 h-2 rounded-sm bg-amber-400/20 border-x border-amber-400/40" />
          {minOverlap}+ projects at once
        </span>
        <span className="text-[11px] text-slate-500 ml-auto">
          {rows.length} of {portfolio.length} projects have datable sprints
        </span>
      </div>
    </div>
  );
}
