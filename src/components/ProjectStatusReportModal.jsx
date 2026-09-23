import React, { useMemo, useState, useEffect } from 'react';
import { X, Copy, Check, Printer, Download, Mail } from 'lucide-react';
import { copyRich, copyPlain, standaloneDocument } from '../utils/teamReport';
import { buildSynopsis, buildReportHtml, buildReportText, weekCommencing, HEALTH_STYLE, SECTIONS } from '../utils/projectReport';
import { HEALTH_LABEL } from '../utils/projectPortfolio';

// Weekly project status, delivered the same way the team report already is: an editable
// synopsis, a live preview, and copy-rich for pasting straight into Outlook. Deliberately
// reuses teamReport's clipboard/print/download helpers rather than growing a second set
// with its own quirks.

const LS_TO = 'pm_report_to';
const LS_CC = 'pm_report_cc';

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

export default function ProjectStatusReportModal({ portfolio, snapshots = {}, scopeLabel = 'All tracked projects', now = new Date(), onClose }) {
  const generated = useMemo(() => buildSynopsis(portfolio, { snapshots, now }), [portfolio, snapshots, now]);

  const [to, setTo] = useState(() => { try { return localStorage.getItem(LS_TO) || ''; } catch { return ''; } });
  const [cc, setCc] = useState(() => { try { return localStorage.getItem(LS_CC) || ''; } catch { return ''; } });
  const [subject, setSubject] = useState(`Weekly Project Status — ${weekCommencing(now)}`);
  const [synopsisText, setSynopsisText] = useState(() => generated.join('\n\n'));
  const [copied, setCopied] = useState(null);

  useEffect(() => { setSynopsisText(generated.join('\n\n')); }, [generated]);
  // Private-window and blocked-storage browsers throw on write; a remembered address
  // is a convenience, never a reason to break the report.
  useEffect(() => { try { localStorage.setItem(LS_TO, to); } catch { /* storage unavailable */ } }, [to]);
  useEffect(() => { try { localStorage.setItem(LS_CC, cc); } catch { /* storage unavailable */ } }, [cc]);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const synopsis = useMemo(() => synopsisText.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean), [synopsisText]);
  const meta = useMemo(() => ({
    generatedAt: now.toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
    weekLabel: weekCommencing(now),
    scopeLabel, now,
  }), [now, scopeLabel]);

  const payload = useMemo(() => ({ portfolio, synopsis, snapshots, meta }), [portfolio, synopsis, snapshots, meta]);
  const html = useMemo(() => buildReportHtml(payload), [payload]);
  const text = useMemo(() => buildReportText(payload), [payload]);

  const flash = k => { setCopied(k); setTimeout(() => setCopied(c => (c === k ? null : c)), 2500); };
  const onCopyRich = async () => { if (await copyRich(html, text)) flash('rich'); };
  const onCopyText = async () => { if (await copyPlain(text)) flash('text'); };

  const onOpenMail = () => {
    // mailto bodies are length-limited, so send the synopsis and let the user paste the
    // formatted report over it — same compromise the team report makes.
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

  const counts = SECTIONS
    .map(s => ({ ...s, n: portfolio.filter(p => p.health === s.key).length }))
    .filter(s => s.n > 0);

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(2,6,23,0.72)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, overflowY: 'auto' }}
    >
      <div style={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, width: '100%', maxWidth: 1000, margin: 'auto', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f1f5f9' }}>Weekly Project Status</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{meta.weekLabel} · {scopeLabel} · {portfolio.length} project{portfolio.length === 1 ? '' : 's'}</div>
          </div>
          <button onClick={onClose} style={{ ...btnGhost, padding: 8 }} title="Close"><X size={16} /></button>
        </div>

        <div style={{ padding: 20, display: 'grid', gap: 16 }}>
          {/* At-a-glance spread, so you can see what the report will say before reading it */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {counts.map(s => {
              const st = HEALTH_STYLE[s.key];
              return (
                <div key={s.key} style={{ background: `${st.color}18`, border: `1px solid ${st.color}55`, borderRadius: 8, padding: '7px 11px' }}>
                  <span style={{ fontSize: 11, color: st.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {HEALTH_LABEL[s.key]}
                  </span>
                  <span style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 700, marginLeft: 7 }}>{s.n}</span>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }}>
            <div><label style={label}>To</label><input style={field} value={to} onChange={e => setTo(e.target.value)} placeholder="team@example.com" /></div>
            <div><label style={label}>Cc</label><input style={field} value={cc} onChange={e => setCc(e.target.value)} placeholder="optional" /></div>
            <div><label style={label}>Subject</label><input style={field} value={subject} onChange={e => setSubject(e.target.value)} /></div>
          </div>

          <div>
            <label style={label}>Synopsis — edit freely</label>
            <textarea
              style={{ ...field, minHeight: 130, lineHeight: 1.6, resize: 'vertical' }}
              value={synopsisText}
              onChange={e => setSynopsisText(e.target.value)}
            />
            <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 5, lineHeight: 1.5 }}>
              Blank line = new paragraph. The preview and both copy actions follow what is written here.
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button onClick={onCopyRich} style={btn('#2563eb')}>
              {copied === 'rich' ? <Check size={14} /> : <Copy size={14} />} Copy formatted report
            </button>
            <button onClick={onCopyText} style={btnGhost}>
              {copied === 'text' ? <Check size={14} /> : <Copy size={14} />} Copy plain text
            </button>
            <button onClick={onOpenMail} style={btnGhost}><Mail size={14} /> Email</button>
            <button onClick={onPrint} style={btnGhost}><Printer size={14} /> Print</button>
            <button onClick={onDownload} style={btnGhost}><Download size={14} /> Save HTML</button>
          </div>

          <div>
            <label style={label}>Preview</label>
            <div
              style={{ background: '#fff', borderRadius: 10, padding: 16, maxHeight: 460, overflowY: 'auto' }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
