// Weekly project status report.
//
// Mirrors teamReport.js: a plain-language synopsis first, then the evidence, rendered
// as email-client-safe HTML with a plain-text twin. Tables and inline styles rather
// than flexbox and classes, because Outlook.
//
// The rule this file follows throughout: never state a status without the number that
// produced it. "At risk" on its own invites an argument nobody can settle; "at risk —
// forecast 29 May against a 08 May target, 8.4 SP/wk measured, 11.3 needed" can be
// checked, and disagreed with on the merits.

import { HEALTH, HEALTH_LABEL, T, weekOverWeek } from './projectPortfolio';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const HEALTH_STYLE = {
  [HEALTH.OFF_TRACK]: { color: '#b91c1c', bg: '#fef2f2', border: '#fca5a5', dot: '●' },
  [HEALTH.AT_RISK]:   { color: '#b45309', bg: '#fffbeb', border: '#fcd34d', dot: '●' },
  [HEALTH.ON_TRACK]:  { color: '#15803d', bg: '#f0fdf4', border: '#86efac', dot: '●' },
  [HEALTH.DONE]:      { color: '#1d4ed8', bg: '#eff6ff', border: '#93c5fd', dot: '✓' },
  [HEALTH.NO_TARGET]: { color: '#475569', bg: '#f8fafc', border: '#cbd5e1', dot: '○' },
  [HEALTH.NO_DATA]:   { color: '#475569', bg: '#f8fafc', border: '#cbd5e1', dot: '○' },
};

// Report order: what needs a decision, then what is fine, then what we cannot say.
export const SECTIONS = [
  { key: HEALTH.OFF_TRACK, title: 'Off track — needs a decision' },
  { key: HEALTH.AT_RISK,   title: 'At risk — watch this week' },
  { key: HEALTH.ON_TRACK,  title: 'On track' },
  { key: HEALTH.DONE,      title: 'Complete' },
  { key: HEALTH.NO_TARGET, title: 'No target date set' },
  { key: HEALTH.NO_DATA,   title: 'Cannot forecast yet' },
];

const UK = { day: '2-digit', month: 'short', year: 'numeric' };
export const fmtDate = d => {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  return isNaN(date) ? '—' : date.toLocaleDateString('en-GB', UK);
};

// Weeks read better as plain English than as a signed decimal in a status meeting.
export function describeVariance(weeks) {
  if (weeks == null) return '';
  const w = Math.abs(weeks);
  const unit = w < 1.5 ? `${Math.round(w * 7)} days` : `${Math.round(w)} weeks`;
  if (w < 0.5) return 'on the target date';
  return weeks > 0 ? `${unit} later than target` : `${unit} ahead of target`;
}

// One sentence per project, carrying its own evidence.
export function describeProject(p) {
  const pct = `${p.percentComplete}% complete`;
  const sp  = p.totalSP > 0 ? `${p.completedSP}/${p.totalSP} SP` : `${p.doneItems}/${p.items} items`;

  if (p.health === HEALTH.DONE) return `${pct} · ${sp}.`;

  if (p.health === HEALTH.NO_DATA) {
    return `${pct} · ${sp}. ${p.forecastNote || p.note || 'No forecast available.'}`;
  }

  if (p.spPerWeek === 0) {
    return `${pct} · ${sp}. Stalled — no story points completed in the last ${p.sprintsUsed} sprints.`;
  }

  // Past the horizon the date is false precision; the rate is the real finding.
  const forecastPhrase = p.beyondHorizon
    ? `at ${p.spPerWeek} SP/wk this does not finish within ${Math.round(T.horizonWeeks / 52)} years`
    : `forecast ${fmtDate(p.forecastDate)}`;

  if (p.health === HEALTH.NO_TARGET) {
    return `${pct} · ${sp} · ${p.spPerWeek} SP/wk · ${forecastPhrase}. No target date set — add one to track it.`;
  }

  const needed = p.requiredSpPerWeek != null && !p.beyondHorizon
    ? ` Needs ${p.requiredSpPerWeek} SP/wk to hit target.`
    : p.requiredSpPerWeek != null ? ` Needs ${p.requiredSpPerWeek} SP/wk.` : '';

  return `${pct} · ${sp} · ${p.spPerWeek} SP/wk measured · target ${fmtDate(p.targetDate)}, ${forecastPhrase}` +
         ` (${describeVariance(p.varianceWeeks)}).${needed}`;
}

// What moved since last week, or null when there is no prior week to compare against.
export function describeMovement(p, snapshots, now) {
  const wow = weekOverWeek(p, (snapshots || {})[p.project], { now });
  if (!wow) return null;
  const bits = [];
  if (wow.scopeDeltaSP > 0) bits.push(`scope up ${wow.scopeDeltaSP} SP`);
  if (wow.scopeDeltaSP < 0) bits.push(`scope down ${Math.abs(wow.scopeDeltaSP)} SP`);
  if (wow.completedDeltaSP > 0) bits.push(`${wow.completedDeltaSP} SP delivered`);
  if (wow.healthChanged) {
    bits.push(`moved from ${HEALTH_LABEL[wow.healthChanged.from]} to ${HEALTH_LABEL[wow.healthChanged.to]}`);
  }
  if (!bits.length) return null;
  return `Since ${fmtDate(wow.since)}: ${bits.join(', ')}.`;
}

// ─── Synopsis ─────────────────────────────────────────────────────────────────
// Read-this-first paragraphs. Deliberately counts rather than adjectives, and it says
// out loud how many projects it could not assess — a report that quietly drops them
// reads as healthier than the portfolio is.
export function buildSynopsis(portfolio, { snapshots = {}, now = new Date() } = {}) {
  const by = key => portfolio.filter(p => p.health === key);
  const off = by(HEALTH.OFF_TRACK), risk = by(HEALTH.AT_RISK);
  const ok = by(HEALTH.ON_TRACK), done = by(HEALTH.DONE);
  const noTarget = by(HEALTH.NO_TARGET), noData = by(HEALTH.NO_DATA);
  const out = [];

  const attention = off.length + risk.length;
  out.push(attention === 0
    ? `No tracked project is forecast to miss its target date. ${portfolio.length} project${portfolio.length === 1 ? '' : 's'} tracked.`
    : `${attention} of ${portfolio.length} tracked project${portfolio.length === 1 ? '' : 's'} ${attention === 1 ? 'needs' : 'need'} attention this week` +
      `${off.length ? `: ${off.length} off track` : ''}${off.length && risk.length ? ', ' : ''}${risk.length ? `${off.length ? '' : ': '}${risk.length} at risk` : ''}.`);

  if (off.length) {
    out.push(`Off track: ${off.map(p => `${p.project} (${describeVariance(p.varianceWeeks) || 'no forecast'})`).join('; ')}.`);
  }

  const movers = portfolio.map(p => ({ p, m: describeMovement(p, snapshots, now) })).filter(x => x.m);
  if (movers.length) {
    out.push(`Movement since last week — ${movers.slice(0, 5).map(x => `${x.p.project}: ${x.m.replace(/^Since [^:]+: /, '')}`).join(' ')}`);
  }

  if (ok.length || done.length) {
    out.push(`${ok.length} on track${done.length ? `, ${done.length} complete` : ''}.`);
  }

  // The honest caveat, always stated when it applies.
  if (noTarget.length || noData.length) {
    const parts = [];
    if (noTarget.length) parts.push(`${noTarget.length} ${noTarget.length === 1 ? 'has' : 'have'} no target date set`);
    if (noData.length) parts.push(`${noData.length} cannot be forecast yet (too few dated sprints to measure a delivery rate)`);
    out.push(`Not assessed: ${parts.join('; ')}. These are excluded from the counts above, not judged as healthy.`);
  }

  return out;
}

// ─── HTML ─────────────────────────────────────────────────────────────────────
function projectRow(p, movement) {
  const s = HEALTH_STYLE[p.health] || HEALTH_STYLE[HEALTH.NO_DATA];
  const bar = Math.max(0, Math.min(100, p.percentComplete));
  return `
  <tr><td style="padding:0 0 9px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${s.bg};border:1px solid ${s.border};border-radius:8px">
      <tr><td style="padding:11px 13px">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="font-size:13.5px;font-weight:700;color:#0f172a">${esc(p.project)}${p.owner ? `<span style="font-weight:500;color:#64748b"> · ${esc(p.owner)}</span>` : ''}</td>
          <td align="right" style="font-size:11.5px;font-weight:700;color:${s.color};white-space:nowrap">${s.dot} ${esc(HEALTH_LABEL[p.health])}</td>
        </tr></table>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:7px"><tr>
          <td style="background:#e2e8f0;border-radius:3px;height:5px;line-height:5px;font-size:0">
            <table width="${bar}%" cellpadding="0" cellspacing="0"><tr><td style="background:${s.color};border-radius:3px;height:5px;line-height:5px;font-size:0">&nbsp;</td></tr></table>
          </td>
        </tr></table>
        <div style="font-size:12px;color:#334155;line-height:1.55;padding-top:7px">${esc(describeProject(p))}</div>
        ${movement ? `<div style="font-size:11.5px;color:#475569;padding-top:4px">↳ ${esc(movement)}</div>` : ''}
        ${p.note ? `<div style="font-size:11.5px;color:#0f172a;padding-top:4px;font-style:italic">Note: ${esc(p.note)}</div>` : ''}
      </td></tr>
    </table>
  </td></tr>`;
}

export function buildReportHtml({ portfolio, synopsis, snapshots = {}, meta }) {
  const { generatedAt, weekLabel, scopeLabel } = meta;

  const section = ({ key, title }) => {
    const list = portfolio.filter(p => p.health === key);
    if (!list.length) return '';
    const s = HEALTH_STYLE[key];
    return `
    <tr><td style="padding:16px 0 7px">
      <div style="font-size:13px;font-weight:700;color:${s.color};border-bottom:2px solid ${s.border};padding-bottom:5px">${esc(title)} <span style="color:#94a3b8;font-weight:500">(${list.length})</span></div>
    </td></tr>
    <tr><td style="padding-top:9px"><table width="100%" cellpadding="0" cellspacing="0">${
      list.map(p => projectRow(p, describeMovement(p, snapshots, meta.now))).join('')
    }</table></td></tr>`;
  };

  return `
<div style="font-family:${FONT};max-width:920px;margin:0 auto;color:#0f172a;background:#ffffff;padding:4px">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:0 0 14px;border-bottom:3px solid #0f172a">
    <div style="font-size:21px;font-weight:800;letter-spacing:-.01em">Weekly Project Status</div>
    <div style="font-size:12.5px;color:#475569;padding-top:4px">${esc(weekLabel)} · ${esc(scopeLabel)} · generated ${esc(generatedAt)}</div>
  </td></tr></table>

  <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:16px 0 0">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:10px">
      <tr><td style="padding:16px 18px">
        <div style="font-size:12px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.06em;padding-bottom:8px">Synopsis — read this first</div>
        ${synopsis.map(t => `<p style="margin:0 0 9px;font-size:13px;line-height:1.62;color:#1e293b">${esc(t)}</p>`).join('')}
      </td></tr>
    </table>
  </td></tr></table>

  <table width="100%" cellpadding="0" cellspacing="0">${SECTIONS.map(section).join('')}</table>

  <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:18px 0 0;border-top:1px solid #e2e8f0">
    <div style="font-size:10.5px;color:#94a3b8;line-height:1.6">
      Forecast = remaining story points ÷ story points completed per week, measured over the last
      ${T.velocityWindow} completed sprints. At risk = forecast more than ${T.atRiskWeeks} week past target;
      off track = more than ${T.offTrackWeeks} weeks past. Delivery rate is measured per sprint, because the
      stored issue rows carry no completion dates — a project whose sprints are undated cannot be forecast.
    </div>
  </td></tr></table>
</div>`.trim();
}

// ─── Plain text ───────────────────────────────────────────────────────────────
// A real mirror of the HTML, not a fallback nobody checked: this is what lands when
// someone's client strips styling, and what gets pasted into a chat thread.
export function buildReportText({ portfolio, synopsis, snapshots = {}, meta }) {
  const lines = [];
  lines.push('WEEKLY PROJECT STATUS');
  lines.push(`${meta.weekLabel} · ${meta.scopeLabel} · generated ${meta.generatedAt}`);
  lines.push('');
  lines.push('SYNOPSIS');
  synopsis.forEach(s => { lines.push(s); lines.push(''); });

  SECTIONS.forEach(({ key, title }) => {
    const list = portfolio.filter(p => p.health === key);
    if (!list.length) return;
    lines.push(`${title.toUpperCase()} (${list.length})`);
    lines.push('-'.repeat(Math.min(60, title.length + 6)));
    list.forEach(p => {
      lines.push(`  ${p.project}${p.owner ? ` — ${p.owner}` : ''}`);
      lines.push(`    ${describeProject(p)}`);
      const m = describeMovement(p, snapshots, meta.now);
      if (m) lines.push(`    ${m}`);
      if (p.note) lines.push(`    Note: ${p.note}`);
      lines.push('');
    });
  });

  lines.push('—');
  lines.push(`Forecast = remaining SP / SP completed per week over the last ${T.velocityWindow} completed sprints.`);
  lines.push(`At risk = forecast >${T.atRiskWeeks}wk past target; off track = >${T.offTrackWeeks}wk past.`);
  return lines.join('\n');
}

// Week commencing the Monday of the given date — how the team refers to a week.
export function weekCommencing(now = new Date()) {
  const d = new Date(now);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - (day - 1));
  return `w/c ${d.toLocaleDateString('en-GB', UK)}`;
}
