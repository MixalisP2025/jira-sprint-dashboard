import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Search, X, CornerDownLeft, MapPin } from 'lucide-react';
import { buildSearchIndex, searchDashboard, flatten, MIN_QUERY } from '../utils/globalSearch';

// One search box for the whole dashboard. Every result answers two questions: what
// matched, and which tabs will show it to you. Hitting Enter sets the filters and
// takes you to the most useful of those tabs.
//
// The CSR tabs keep their own in-grid search bars — those filter a table in place,
// which is a different job from finding your way around.

const KIND_STYLE = {
  view:    { dot: 'bg-slate-400',   tint: 'text-slate-300'   },
  person:  { dot: 'bg-blue-400',    tint: 'text-blue-300'    },
  sprint:  { dot: 'bg-purple-400',  tint: 'text-purple-300'  },
  project: { dot: 'bg-emerald-400', tint: 'text-emerald-300' },
  status:  { dot: 'bg-amber-400',   tint: 'text-amber-300'   },
  ticket:  { dot: 'bg-cyan-400',    tint: 'text-cyan-300'    },
};

// Tabs with no dataset rows behind them, so the index cannot infer them.
const EXTRA_VIEWS = [
  { tab: 'csr',           label: 'CSR Tickets'   },
  { tab: 'csr-analytics', label: 'CSR Analytics' },
  { tab: 'csr-snapshot',  label: 'CSR Snapshot'  },
];

export default function GlobalSearch({ data, onNavigate }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const index = useMemo(() => buildSearchIndex(data, EXTRA_VIEWS), [data]);
  const results = useMemo(() => searchDashboard(index, query), [index, query]);
  const flat = useMemo(() => flatten(results.groups), [results]);

  // The cursor is reset where the query changes (the onChange below), not in an
  // effect — an effect here would render once with a stale cursor and again to fix it.
  // Clamped on read because the result list shrinks as you type.
  const active = cursor < flat.length ? cursor : 0;

  // Ctrl/Cmd+K from anywhere; "/" only when you are not already typing somewhere,
  // so it never eats a slash meant for a filter box.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Click-away closes the panel but keeps the query, so you can reopen where you were.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!listRef.current?.contains(e.target) && !inputRef.current?.contains(e.target)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const go = useCallback((item, tabOverride) => {
    if (!item) return;
    // A ticket jump carries the whole match set, so Raw Data can show the tickets that
    // matched rather than whatever else shares the landing filters. Nothing else does:
    // jumping to a person or a sprint is a request for that view in full, and passing
    // no match is what clears a previous one.
    const match = item.kind === 'ticket'
      ? { query: query.trim(), keys: results.matchedKeys }
      : null;
    onNavigate({ ...item.target, ...(tabOverride ? { tab: tabOverride } : {}), match });
    setOpen(false);
    inputRef.current?.blur();
  }, [onNavigate, query, results.matchedKeys]);

  const onInputKey = (e) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur(); return; }
    if (!flat.length) return;
    if (e.key === 'ArrowDown')      { e.preventDefault(); setCursor((active + 1) % flat.length); }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setCursor((active - 1 + flat.length) % flat.length); }
    else if (e.key === 'Enter')     { e.preventDefault(); go(flat[active]); }
  };

  const tooShort = query.trim().length > 0 && query.trim().length < MIN_QUERY;

  // Each result's position in the flattened list, so a grouped row knows which index
  // the arrow keys would put the cursor on. Derived rather than counted during render,
  // because a counter mutated inside map() is not safe across re-renders.
  const flatIndexById = useMemo(
    () => new Map(flat.map((item, i) => [item.id, i])),
    [flat],
  );

  return (
    <div className="relative w-full max-w-xl">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={e => { setQuery(e.target.value); setCursor(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onInputKey}
        placeholder="Search tickets, people, sprints, projects, tabs…"
        className="w-full pl-10 pr-20 py-2 bg-slate-800 border border-slate-600 rounded-lg text-sm text-white placeholder-slate-500 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
      />
      {query ? (
        <button
          onClick={() => { setQuery(''); setCursor(0); inputRef.current?.focus(); }}
          title="Clear"
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
        >
          <X className="w-4 h-4" />
        </button>
      ) : (
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 border border-slate-600 rounded px-1.5 py-0.5 font-sans">
          Ctrl K
        </kbd>
      )}

      {open && query.trim() && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 mt-2 max-h-[70vh] overflow-y-auto bg-slate-800 border border-slate-600 rounded-xl shadow-2xl z-[70]"
        >
          {tooShort && (
            <div className="px-4 py-3 text-sm text-slate-400">Keep typing — at least {MIN_QUERY} characters.</div>
          )}

          {!tooShort && results.total === 0 && (
            <div className="px-4 py-3 text-sm text-slate-400">
              Nothing matches “{query.trim()}” in the loaded dataset.
            </div>
          )}

          {results.groups.map(group => (
            <div key={group.kind} className="border-b border-slate-700 last:border-b-0">
              <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {group.title}
              </div>
              {group.items.map(item => {
                const i = flatIndexById.get(item.id);
                const style = KIND_STYLE[item.kind] || KIND_STYLE.view;
                return (
                  <div
                    key={item.id}
                    onMouseEnter={() => setCursor(i)}
                    onClick={() => go(item)}
                    className={`px-4 py-2.5 cursor-pointer ${active === i ? 'bg-slate-700/70' : 'hover:bg-slate-700/40'}`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-none ${style.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className={`font-medium text-sm truncate ${style.tint}`}>{item.title}</span>
                          {active === i && (
                            <CornerDownLeft className="w-3 h-3 text-slate-500 flex-none" />
                          )}
                        </div>
                        <div className="text-xs text-slate-400 truncate">{item.subtitle}</div>

                        {/* Where it sits — the coordinates that place a ticket. */}
                        {item.coords && (
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500">
                            <MapPin className="w-3 h-3 flex-none" />
                            <span className="truncate">{item.coords.join('  ·  ')}</span>
                          </div>
                        )}

                        {/* Which tabs will show it. Each chip is its own jump. */}
                        {item.kind !== 'view' && item.locations.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap items-center gap-1">
                            <span className="text-[10px] uppercase tracking-wide text-slate-600 mr-0.5">Found in</span>
                            {item.locations.map(loc => (
                              <button
                                key={loc.tab}
                                onClick={e => { e.stopPropagation(); go(item, loc.tab); }}
                                title={`Open the ${loc.label} tab with these filters applied`}
                                className="text-[10px] px-1.5 py-0.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-600 hover:text-white transition-colors"
                              >
                                {loc.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}

          {results.total > 0 && (
            <div className="px-4 py-2 text-[11px] text-slate-500 bg-slate-800/80 sticky bottom-0 border-t border-slate-700">
              ↑↓ to move · Enter to jump · Esc to close
              {results.ticketMatches > 6 && ` · showing 6 of ${results.ticketMatches} matching tickets`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
