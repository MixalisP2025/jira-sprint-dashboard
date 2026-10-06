import React, { useEffect, useMemo, useState } from 'react';
import { X, Copy, Check, Printer, RotateCcw } from 'lucide-react';
import { copyRich, copyPlain, standaloneDocument } from '../utils/teamReport';
import { buildManagementHtml, buildManagementText, DEFAULT_SECTIONS } from '../utils/sprintReviewReport';

// What goes to management, seen before it goes. Same shape as the weekly project status
// report: an editable synopsis, a live preview, then print or copy, so the two reports
// behave alike. The preview is the printed page itself, in an iframe so the dashboard's
// dark-theme styles cannot change how it looks.

const field = {
  width: '100%', background: '#0f172a', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8,
  color: '#e2e8f0', padding: '8px 10px', fontSize: 12.5, fontFamily: 'inherit',
};
const label = { fontSize: 11, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 5, display: 'block' };
const btn = (bg, fg = '#fff') => ({
  display: 'inline-flex', alignItems: 'center', gap: 6, background: bg, color: fg, border: 'none',
  borderRadius: 8, padding: '8px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
});
const btnGhost = { ...btn('rgba(255,255,255,0.06)', '#cbd5e1'), border: '1px solid rgba(255,255,255,0.15)' };

const SECTION_LABELS = [
  ['tips', 'What to look at'],
  ['stuck', 'Stuck tickets'],
  ['slipping', 'Long-slipping tickets'],
];

/**
 * `input`: the report figures (ledger, pace, comparison, behind, stale, carried, tips, hasHistory).
 * `generatedSynopsis`: the synopsis paragraphs as computed; the user edits a copy.
 */
export default function SprintSummaryModal({ input, generatedSynopsis, title, scopeLabel, onClose }) {
  const [synopsisText, setSynopsisText] = useState(() => generatedSynopsis.join('\n\n'));
  const [sections, setSections] = useState(DEFAULT_SECTIONS);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const generatedAt = useMemo(() => new Date().toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }), []);
  const synopsis = useMemo(() => synopsisText.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean), [synopsisText]);
  const payload = useMemo(() => ({ ...input, synopsis, sections, meta: { scopeLabel, generatedAt } }), [input, synopsis, sections, scopeLabel, generatedAt]);
  const html = useMemo(() => buildManagementHtml(payload), [payload]);
  const text = useMemo(() => buildManagementText(payload), [payload]);
  const doc = useMemo(() => standaloneDocument(html, title), [html, title]);
  const edited = synopsisText !== generatedSynopsis.join('\n\n');

  const flash = k => { setCopied(k); setTimeout(() => setCopied(c => (c === k ? null : c)), 2500); };
  const onCopyRich = async () => { if (await copyRich(html, text)) flash('rich'); };
  const onCopyText = async () => { if (await copyPlain(text)) flash('text'); };
  const onPrint = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(doc);
    w.document.close(); w.focus();
    setTimeout(() => w.print(), 450);
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }}
    >
      <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, width: '100%', maxWidth: 1000, margin: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>{title}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{scopeLabel} · check it, edit the synopsis if needed, then print or copy</div>
          </div>
          <button onClick={onClose} style={{ ...btnGhost, padding: 8 }} title="Close (Esc)"><X size={16} /></button>
        </div>

        <div style={{ padding: 20, display: 'grid', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={label}>Synopsis — edit freely</label>
              {edited && (
                <button onClick={() => setSynopsisText(generatedSynopsis.join('\n\n'))} style={{ ...btnGhost, padding: '4px 9px', fontSize: 11.5 }} title="Put back the generated synopsis">
                  <RotateCcw size={12} /> Reset
                </button>
              )}
            </div>
            <textarea
              style={{ ...field, minHeight: 150, lineHeight: 1.6, resize: 'vertical' }}
              value={synopsisText}
              onChange={e => setSynopsisText(e.target.value)}
            />
            <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 5 }}>Blank line = new paragraph. The preview, print and copy all follow what is written here.</div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
            <span style={{ ...label, marginBottom: 0 }}>Include</span>
            {SECTION_LABELS.map(([k, l]) => (
              <label key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: '#e2e8f0', cursor: 'pointer' }}>
                <input type="checkbox" checked={sections[k]} onChange={e => setSections(s => ({ ...s, [k]: e.target.checked }))} />
                {l}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button onClick={onPrint} style={btn('#2563eb')}><Printer size={14} /> Print</button>
            <button onClick={onCopyRich} style={btnGhost}>
              {copied === 'rich' ? <Check size={14} /> : <Copy size={14} />} Copy for email
            </button>
            <button onClick={onCopyText} style={btnGhost}>
              {copied === 'text' ? <Check size={14} /> : <Copy size={14} />} Copy plain text
            </button>
          </div>

          <div>
            <label style={label}>Preview — exactly what prints</label>
            <iframe
              title="Sprint summary preview"
              srcDoc={doc}
              style={{ width: '100%', height: '70vh', border: 'none', borderRadius: 10, background: '#fff' }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
