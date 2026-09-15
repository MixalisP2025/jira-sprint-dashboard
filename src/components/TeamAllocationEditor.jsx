import React, { useState, useMemo } from 'react';
import { X, SlidersHorizontal, Bot, RotateCcw } from 'lucide-react';
import { ALLOC_BASIS } from '../utils/teamAllocation';

const f1 = n => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const pctI = n => (Number.isFinite(n) ? Math.round(n) : null);

const btn = (bg, fg = '#fff') => ({ display: 'inline-flex', alignItems: 'center', gap: 6, background: bg, color: fg, border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' });
const btnGhost = { ...btn('rgba(255,255,255,0.06)', '#cbd5e1'), border: '1px solid rgba(255,255,255,0.15)' };
const th = { textAlign: 'right', padding: '7px 9px', fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' };
const thL = { ...th, textAlign: 'left' };
const td = { textAlign: 'right', padding: '7px 9px', fontSize: 12, color: '#e2e8f0' };
const tdL = { ...td, textAlign: 'left' };

/**
 * Explicit per-person allocation to the project in scope, plus the service-account list.
 * An explicit value takes precedence over every inferred basis and lifts the person out of
 * the "assumed full-time" suppression.
 */
export default function TeamAllocationEditor({
  rows = [], allNames = [], windowSprints = [], overrides = {}, serviceAccounts = [],
  onSaveOverrides, onSaveServiceAccounts, onClose,
}) {
  const [draft, setDraft] = useState(() => {
    const d = {};
    for (const n of allNames) {
      const v = overrides?.[n];
      d[n] = Number.isFinite(v) ? String(Math.round(v * 100)) : '';
    }
    return d;
  });
  const [excluded, setExcluded] = useState(() => new Set(serviceAccounts));

  const byName = useMemo(() => Object.fromEntries(rows.map(r => [r.name, r])), [rows]);
  const sorted = useMemo(() => [...allNames].sort((a, b) => a.localeCompare(b)), [allNames]);

  const setPct = (name, value) => setDraft(d => ({ ...d, [name]: value }));
  const toggleExcluded = name => setExcluded(s => { const n = new Set(s); n.has(name) ? n.delete(name) : n.add(name); return n; });

  const apply = () => {
    const out = {};
    for (const [name, raw] of Object.entries(draft)) {
      const n = parseFloat(raw);
      if (Number.isFinite(n) && n > 0) out[name] = Math.min(n, 100) / 100;
    }
    onSaveOverrides(out);
    onSaveServiceAccounts([...excluded]);
    onClose();
  };

  const clearAll = () => setDraft(Object.fromEntries(sorted.map(n => [n, ''])));

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0b1220', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, width: '100%', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}><SlidersHorizontal size={17} /> Allocation &amp; accounts</div>
            <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>The denominator behind every normalised figure in this panel. {windowSprints.length} sprint(s) in the window.</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}><X size={20} /></button>
        </div>

        <div style={{ padding: '14px 20px', overflowY: 'auto', flex: 1 }}>
          <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.65, background: 'rgba(96,165,250,0.07)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 10, padding: '11px 14px', marginBottom: 14 }}>
            Set the share of each person's working time that goes to this project. An explicit value here overrides every inferred basis and is the only one labelled <strong style={{ color: '#cbd5e1' }}>configured allocation</strong>.
            Leave a cell blank to keep the inferred value. Anyone with neither a configured nor an inferable allocation is treated as <strong style={{ color: '#fdba74' }}>assumed full-time</strong>: their normalised metrics are suppressed <em>and</em> they are left out of the team capacity denominator.
            <div style={{ marginTop: 6, color: '#6b7280' }}>Presence per sprint is detected separately from logged work and completed tickets — it is not something you set here.</div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                <th style={thL}>Contributor</th>
                <th style={thL}>Current basis</th>
                <th style={th}>Present</th>
                <th style={th}>Tickets</th>
                <th style={th}>SP</th>
                <th style={th}>Hours</th>
                <th style={th}>Avail-days</th>
                <th style={th}>Allocation %</th>
                <th style={th}>Service acct</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(name => {
                const r = byName[name];
                const isExcluded = excluded.has(name);
                const basis = r ? ALLOC_BASIS[r.allocBasis]?.short : '—';
                const untrusted = r && r.allocUnknown;
                return (
                  <tr key={name} style={{ borderTop: '1px solid rgba(255,255,255,0.05)', opacity: isExcluded ? 0.45 : 1 }}>
                    <td style={{ ...tdL, fontWeight: 500, whiteSpace: 'nowrap' }}>{name}</td>
                    <td style={{ ...tdL, fontSize: 11, color: untrusted ? '#fdba74' : '#64748b' }} title={r?.basisLabel || ''}>{basis}</td>
                    <td style={{ ...td, color: r && r.absentCount > 0 ? '#fbbf24' : '#64748b' }}>{r?.presentCount != null ? `${r.presentCount}/${windowSprints.length}` : '—'}</td>
                    <td style={td}>{r?.tickets ?? 0}</td>
                    <td style={td}>{r ? f1(r.sp) : 0}</td>
                    <td style={{ ...td, color: '#86efac' }}>{r?.hours != null ? f1(r.hours) + 'h' : '—'}</td>
                    <td style={{ ...td, color: '#cbd5e1' }}>{r?._allocDays != null ? f1(r._allocDays) : '—'}</td>
                    <td style={{ ...td, width: 108 }}>
                      <input
                        type="number" min="1" max="100" step="5"
                        value={draft[name] ?? ''}
                        onChange={e => setPct(name, e.target.value)}
                        placeholder={r?.allocPct != null ? String(pctI(r.allocPct * 100)) : '—'}
                        disabled={isExcluded}
                        style={{ width: 72, background: '#0f172a', border: `1px solid ${draft[name] ? 'rgba(96,165,250,0.55)' : 'rgba(255,255,255,0.15)'}`, borderRadius: 6, color: '#e2e8f0', padding: '4px 7px', fontSize: 12, textAlign: 'right' }}
                      />
                    </td>
                    <td style={td}>
                      <input type="checkbox" checked={isExcluded} onChange={() => toggleExcluded(name)} title="Exclude from the contributor list, the contributor count and the capacity denominator" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {excluded.size > 0 && (
            <div style={{ marginTop: 12, fontSize: 12, color: '#c4b5fd', display: 'flex', alignItems: 'flex-start', gap: 7, background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.25)', borderRadius: 9, padding: '10px 13px' }}>
              <Bot size={15} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>Excluded as service accounts: <strong>{[...excluded].join(', ')}</strong>. Their tickets, points, hours and person-days are removed from every figure in the panel.</div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '13px 20px', borderTop: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
          <button onClick={clearAll} style={{ ...btnGhost, fontSize: 12 }}><RotateCcw size={13} /> Clear all overrides</button>
          <div style={{ display: 'flex', gap: 9 }}>
            <button onClick={onClose} style={btnGhost}>Cancel</button>
            <button onClick={apply} style={btn('#2563eb')}>Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}
