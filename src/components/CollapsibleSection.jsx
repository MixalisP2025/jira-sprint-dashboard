import React, { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

// A section that folds away, so a long tab can be navigated by collapsing what you are
// not reading rather than scrolling past it.
//
// Two decisions that matter:
//  · The open/closed choice is remembered per section. Re-collapsing the same four
//    panels on every visit is precisely the work this is meant to remove.
//  · A collapsed header still carries a summary. A fold that hides whether anything
//    needs attention just moves the scrolling to a guessing game about what is inside.

const key = id => `section.open.${id}`;

function readStored(id, fallback) {
  try {
    const v = localStorage.getItem(key(id));
    return v === null ? fallback : v === '1';
  } catch {
    // Private windows and blocked site data throw; a remembered fold is a convenience.
    return fallback;
  }
}

export default function CollapsibleSection({
  id,
  title,
  icon = null,
  subtitle = null,
  summary = null,      // shown in the header only while collapsed
  defaultOpen = true,
  right = null,        // controls that belong to the section, not the fold
  children,
  className = 'bg-gradient-to-br from-slate-800/90 to-slate-900/90 rounded-2xl shadow-2xl border border-slate-700 backdrop-blur-sm',
}) {
  const [open, setOpen] = useState(() => readStored(id, defaultOpen));

  const toggle = useCallback(() => {
    setOpen(o => {
      const next = !o;
      try { localStorage.setItem(key(id), next ? '1' : '0'); } catch { /* storage unavailable */ }
      return next;
    });
  }, [id]);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex items-center gap-3 min-w-0 flex-1 text-left group"
        >
          {open
            ? <ChevronDown className="w-5 h-5 text-slate-400 flex-none group-hover:text-slate-200" />
            : <ChevronRight className="w-5 h-5 text-slate-400 flex-none group-hover:text-slate-200" />}
          {icon && <span className="text-xl flex-none" aria-hidden>{icon}</span>}
          <span className="min-w-0">
            <span className="block text-xl font-bold text-white truncate">{title}</span>
            {/* While open the subtitle explains the section; while closed the summary
                says what is in it, so the header is never a blank door. */}
            {(open ? subtitle : (summary || subtitle)) && (
              <span className="block text-xs text-slate-400 truncate">
                {open ? subtitle : (summary || subtitle)}
              </span>
            )}
          </span>
        </button>
        {/* Stops a click on the section's own controls from folding it shut. */}
        {right && <div onClick={e => e.stopPropagation()} className="flex-none">{right}</div>}
      </div>

      {open && <div className="px-6 pb-6">{children}</div>}
    </div>
  );
}
