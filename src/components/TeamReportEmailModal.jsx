import React, { useMemo, useState, useEffect } from 'react';
import { Mail, X, Copy, Check, Printer, Download, RefreshCw } from 'lucide-react';
import {
  classifyContributors, groupByBand, buildSynopsis, buildEmailHtml, buildEmailText,
  copyRich, copyPlain, standaloneDocument, BANDS,
} from '../utils/teamReport';

const LS_TO = 'tt_email_to';
const LS_CC = 'tt_email_cc';

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

export default function TeamReportEmailModal({ M, meta, onClose }) {
  const standings = useMemo(() => classifyContributors(M, { sprintCount: meta.sprintCount }), [M, meta.sprintCount]);
  const generated = useMemo(() => buildSynopsis(M, standings, meta), [M, standings, meta]);

  const [to, setTo] = useState(() => localStorage.getItem(LS_TO) || '');
  const [cc, setCc] = useState(() => localStorage.getItem(LS_CC) || '');
  const [subject, setSubject] = useState(meta.subject);
  const [synopsisText, setSynopsisText] = useState(() => generated.join('\n\n'));
  const [copied, setCopied] = useState(null);

  useEffect(() => { setSynopsisText(generated.join('\n\n')); }, [generated]);
  useEffect(() => { localStorage.setItem(LS_TO, to); }, [to]);
  useEffect(() => { localStorage.setItem(LS_CC, cc); }, [cc]);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const synopsis = useMemo(() => synopsisText.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean), [synopsisText]);
  const payload = useMemo(() => ({ M, standings, synopsis, meta: { ...meta, subject } }), [M, standings, synopsis, meta, subject]);
  const html = useMemo(() => buildEmailHtml(payload), [payload]);
  const text = useMemo(() => buildEmailText(payload), [payload]);
  const groups = useMemo(() => groupByBand(standings), [standings]);

  const flash = k => { setCopied(k); setTimeout(() => setCopied(c => (c === k ? null : c)), 2500); };

  const onCopyRich = async () => { if (await copyRich(html, text)) flash('rich'); };
  const onCopyText = async () => { if (await copyPlain(text)) flash('text'); };

  const onOpenMail = () => {
    // mailto bodies are length-limited, so send the synopsis and let the user paste the formatted report over it.
    const body = synopsis.join('\r\n\r\n').slice(0, 1600);
    const q = [`subject=${encodeURIComponent(subject)}`];
    if (cc.trim()) q.push(`cc=${encodeURIComponent(cc.trim())}`);
    q.push(`body=${encodeURIComponent(body + '\r\n\r\n[Paste the formatted report here — use "Copy formatted report" in the dashboard.]')}`);
    window.location.href = `mailto:${encodeURIComponent(to.trim())}?${q.join('&')}`.replace(/%2C/g, ',');
  };

  const onPrint = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(standaloneDocument(html, subject));
    w.document.close(); w.focus();
    setTimeout(() => w.print(), 450);
  };

  const onDownload = () => {
    const blob = new Blob([standaloneDocument(html, subject)], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${subject.replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').toLowerCase()}.html`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const chip = key => {
    const list = groups[key]; if (!list.length) return null;
    const b = BANDS[key];
    return (
      <div key={key} style={{ background: `${b.color}18`, border: `1px solid ${b.color}55`, borderRadius: 8, padding: '7px 11px', minWidth: 150, flex: '1 1 160px' }}>
        <div style={{ fontSize: 10.5, color: b.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{b.label}</div>
        <div style={{ fontSize: 12, color: '#e2e8f0', marginTop: 3, lineHeight: 1.5 }}>{list.map(x => x.name).join(', ')}</div>
      </div>
    );
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(3px)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#0b1220', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 16, width: '100%', maxWidth: 1180, maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.6)' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '15px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.03)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: 8 }}><Mail size={17} /> Email the team contribution report</div>
            <div style={{ fontSize: 11.5, color: '#6b7280', marginTop: 2 }}>{meta.projectLabel} · last {meta.sprintCount || meta.windowN} completed sprint(s) · synopsis generated from the current numbers and editable below</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={{ display: 'flex', gap: 0, flex: 1, minHeight: 0 }}>

          {/* Compose column */}
          <div style={{ width: 400, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.08)', padding: '16px 18px', overflowY: 'auto' }}>
            <div style={{ marginBottom: 13 }}>
              <label style={label}>To</label>
              <input value={to} onChange={e => setTo(e.target.value)} placeholder="name@company.com, name2@company.com" style={field} />
            </div>
            <div style={{ marginBottom: 13 }}>
              <label style={label}>Cc</label>
              <input value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" style={field} />
            </div>
            <div style={{ marginBottom: 13 }}>
              <label style={label}>Subject</label>
              <input value={subject} onChange={e => setSubject(e.target.value)} style={field} />
            </div>

            <div style={{ marginBottom: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ ...label, marginBottom: 5 }}>Synopsis (top of the email)</label>
                <button onClick={() => setSynopsisText(generated.join('\n\n'))} title="Rebuild from the current numbers" style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, padding: 0, marginBottom: 5 }}><RefreshCw size={11} /> Regenerate</button>
              </div>
              <textarea value={synopsisText} onChange={e => setSynopsisText(e.target.value)} rows={16} style={{ ...field, resize: 'vertical', lineHeight: 1.6, fontSize: 12 }} />
              <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 5, lineHeight: 1.5 }}>Blank line = new paragraph. Edit freely — the preview and both copy actions follow what is written here.</div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={label}>Standing at a glance</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>{['ahead', 'onPace', 'behind', 'unassessed'].map(chip)}</div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button onClick={onCopyRich} style={btn('#2563eb')}>{copied === 'rich' ? <Check size={14} /> : <Copy size={14} />} {copied === 'rich' ? 'Copied — paste into your email' : 'Copy formatted report'}</button>
              <button onClick={onOpenMail} style={btn('#334155', '#e2e8f0')}><Mail size={14} /> Open mail client</button>
              <button onClick={onCopyText} style={btnGhost}>{copied === 'text' ? <Check size={14} /> : <Copy size={14} />} {copied === 'text' ? 'Copied' : 'Copy plain text'}</button>
              <button onClick={onPrint} style={btnGhost}><Printer size={14} /> Print / PDF</button>
              <button onClick={onDownload} style={btnGhost}><Download size={14} /> Save .html</button>
            </div>
            <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 10, lineHeight: 1.55 }}>
              Outlook and Gmail keep the formatting when you paste after <strong style={{ color: '#94a3b8' }}>Copy formatted report</strong>. <em>Open mail client</em> pre-fills the recipients, subject and synopsis; paste the formatted report over the placeholder line.
            </div>
          </div>

          {/* Preview column */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#0f172a' }}>
            <div style={{ padding: '8px 16px', fontSize: 10.5, color: '#6b7280', borderBottom: '1px solid rgba(255,255,255,0.07)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>Preview — exactly what the recipient sees</div>
            <iframe title="Email preview" srcDoc={standaloneDocument(html, subject)} style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }} />
          </div>
        </div>
      </div>
    </div>
  );
}
