// Management summary of one sprint, built from the Sprint Review's own figures: a
// plain-language synopsis, then the numbers behind it. HTML for printing and pasting into
// Outlook (inline styles, tables), plus a plain-text mirror for clients that strip styling.
//
// No person is named. The tab shows assignees so the team knows who to ask; a printed
// list of names next to stuck tickets reads as blame once it leaves the room.
import { HEALTH_LABEL } from './projectPortfolio';
import { HEALTH_STYLE, describeProject } from './projectReport';
import { shortSprint } from './teamEngine';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const pct = v => (Number.isFinite(v) ? `${Math.round(v)}%` : '–');
const fmtDate = d => (d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–');
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const STUCK_DAYS = 10;      // two working weeks in one status
const LONG_SLIP = 3;        // carried through this many earlier sprints

/** The synopsis paragraphs, most important first. */
export function buildManagementSynopsis({ ledger, pace, comparison, behind = [], stale = [], carried = [], hasHistory = true }) {
  const out = [];
  const name = shortSprint(ledger.sprint);

  // 1. Where the sprint stands
  const running = pace?.elapsed != null && pace.elapsed < 100;
  const doneLine = `${pct(ledger.deliveredPct)} of the ${r1(ledger.sp)} SP committed is done`;
  const awaitLine = ledger.awaitingSP > 0 ? `; a further ${r1(ledger.awaitingSP)} SP is built and waiting on testing, versioning or review` : '';
  if (running) {
    const verdict = pace.verdict === 'behind'
      ? 'At this rate the sprint will not complete its commitment, and the remainder will carry into the next sprint.'
      : 'Delivery is keeping pace with the sprint so far.';
    out.push(`${name} is ${pct(pace.elapsed)} of the way through its working days and ${doneLine}${awaitLine}. ${verdict}`);
  } else {
    out.push(`${name} has ended: ${doneLine}${awaitLine}.`);
  }

  // 2. The trend across completed sprints (a running sprint is not comparable yet)
  const closed = (comparison?.sprints || []).filter(s => !(running && s.sprint === ledger.sprint) && Number.isFinite(s.deliveredPct));
  if (closed.length >= 2) {
    const first = closed[0]; const last = closed[closed.length - 1];
    const delta = last.deliveredPct - first.deliveredPct;
    const direction = Math.abs(delta) < 5 ? 'held steady at around' : delta > 0 ? 'improved from' : 'fallen from';
    const span = Math.abs(delta) < 5
      ? `${pct(last.deliveredPct)}`
      : `${pct(first.deliveredPct)} in ${shortSprint(first.sprint)} to ${pct(last.deliveredPct)} in ${shortSprint(last.sprint)}`;
    let line = `Across the last ${closed.length} completed sprints, delivery of committed work has ${direction} ${span}.`;
    if (hasHistory) {
      const carry = closed.map(s => s.carryInPct).filter(Number.isFinite);
      if (carry.length) line += ` Typically ${pct(carry.reduce((a, b) => a + b, 0) / carry.length)} of each sprint is work carried over from an earlier one.`;
    }
    out.push(line);
  }

  // 3. Projects against their target dates
  if (behind.length) {
    const parts = behind.map(p => {
      const late = Number.isFinite(p.varianceWeeks) ? `, ${plural(Math.round(p.varianceWeeks), 'week')} late` : '';
      return `${p.project} (${HEALTH_LABEL[p.health].toLowerCase()}${p.forecastDate ? `, forecast ${fmtDate(new Date(p.forecastDate))}` : ''}${late})`;
    });
    out.push(`${plural(behind.length, 'tracked project is', 'tracked projects are')} forecast past target: ${parts.join('; ')}.`);
  } else {
    out.push('No tracked project is forecast past its target date.');
  }

  // 4. What needs a decision
  const stuck = stale.filter(s => s.days >= STUCK_DAYS).length;
  const slipping = carried.filter(c => c.sprintsBefore >= LONG_SLIP).length;
  const asks = [];
  if (stuck) asks.push(`${plural(stuck, 'open item has', 'open items have')} sat in the same status for ${STUCK_DAYS}+ working days`);
  if (hasHistory && slipping) asks.push(`${plural(slipping, 'item has', 'items have')} been carried through ${LONG_SLIP} or more sprints`);
  if (asks.length) out.push(`Needing a decision: ${asks.join(', and ')}. These should be unblocked, re-planned or dropped rather than carried again.`);

  return out;
}

const tile = (label, value, sub, color = '#0f172a') => `
  <td width="25%" style="padding:0 6px 0 0;vertical-align:top">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:8px"><tr><td style="padding:10px 12px">
      <div style="font-size:10.5px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.05em">${esc(label)}</div>
      <div style="font-size:20px;font-weight:800;color:${color};padding-top:3px">${esc(value)}</div>
      <div style="font-size:11px;color:#64748b;padding-top:2px">${esc(sub)}</div>
    </td></tr></table>
  </td>`;

const heading = t => `<div style="font-size:13px;font-weight:700;color:#0f172a;border-bottom:2px solid #cbd5e1;padding:18px 0 5px;margin-bottom:8px">${esc(t)}</div>`;
const th = (t, right) => `<th style="text-align:${right ? 'right' : 'left'};font-size:11px;color:#64748b;font-weight:600;padding:5px 8px;border-bottom:1px solid #cbd5e1">${esc(t)}</th>`;
const td = (t, right, extra = '') => `<td style="text-align:${right ? 'right' : 'left'};font-size:12px;color:#1e293b;padding:5px 8px;border-bottom:1px solid #f1f5f9;${extra}">${t}</td>`;

/** Printable / pasteable HTML. `meta`: { generatedAt, scopeLabel }. */
export function buildManagementHtml({ ledger, pace, comparison, behind = [], stale = [], carried = [], tips = [], synopsis, hasHistory = true, meta }) {
  const running = pace?.elapsed != null && pace.elapsed < 100;
  const paceText = pace?.verdict === 'behind' ? 'Behind' : pace?.verdict === 'on-pace' ? 'On pace' : '–';
  const paceColor = pace?.verdict === 'behind' ? '#b91c1c' : pace?.verdict === 'on-pace' ? '#15803d' : '#0f172a';

  const trendRows = (comparison?.sprints || []).map(s => {
    const cur = running && s.sprint === ledger.sprint;
    return `<tr>${[
      td(`${esc(shortSprint(s.sprint))}${cur ? ' <span style="color:#64748b">(in progress)</span>' : ''}`),
      td(esc(r1(s.committedSP)), true), td(esc(r1(s.doneSP)), true), td(esc(pct(s.deliveredPct)), true),
      td(esc(hasHistory ? pct(s.carryInPct) : '–'), true), td(esc(hasHistory ? s.addedAfterStart : '–'), true),
      td(esc(s.medianCycle != null ? r1(s.medianCycle) : '–'), true),
    ].join('')}</tr>`;
  }).join('');

  const projectRows = behind.map(p => {
    const st = HEALTH_STYLE[p.health] || {};
    return `<tr>${td(`<span style="color:${st.color};font-weight:700">${esc(HEALTH_LABEL[p.health])}</span>`, false, 'white-space:nowrap;vertical-align:top')}${td(`<b>${esc(p.project)}</b>${p.owner ? ` <span style="color:#64748b">· ${esc(p.owner)}</span>` : ''}<br><span style="color:#475569">${esc(describeProject(p))}</span>`)}</tr>`;
  }).join('');

  const itemRows = (list, extra) => list.map(x => `<tr>${td(esc(x.key), false, 'white-space:nowrap')}${td(esc(x.summary))}${td(esc(x.status), false, 'white-space:nowrap')}${td(esc(extra(x)), true, 'white-space:nowrap')}</tr>`).join('');
  const stuck = stale.filter(s => s.days >= STUCK_DAYS).slice(0, 8);
  const slipping = carried.filter(c => c.sprintsBefore >= LONG_SLIP).slice(0, 8);
  const adverse = tips.filter(t => t.severity !== 'reassuring');

  return `
<div style="font-family:${FONT};max-width:920px;margin:0 auto;color:#0f172a;background:#ffffff;padding:4px">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:0 0 14px;border-bottom:3px solid #0f172a">
    <div style="font-size:21px;font-weight:800">Sprint Summary · ${esc(shortSprint(ledger.sprint))}</div>
    <div style="font-size:12.5px;color:#475569;padding-top:4px">${esc(fmtDate(ledger.start))} – ${esc(fmtDate(ledger.end))} · ${esc(meta.scopeLabel)} · generated ${esc(meta.generatedAt)}</div>
  </td></tr></table>

  <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:16px 0 0">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:10px"><tr><td style="padding:16px 18px">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding-bottom:8px">Synopsis</div>
      ${synopsis.map(t => `<p style="margin:0 0 9px;font-size:13px;line-height:1.62;color:#1e293b">${esc(t)}</p>`).join('')}
    </td></tr></table>
  </td></tr></table>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px"><tr>
    ${tile('Committed', `${r1(ledger.sp)} SP`, `${ledger.items} items`)}
    ${tile('Done', `${r1(ledger.doneSP)} SP`, `${ledger.doneItems} items · ${pct(ledger.deliveredPct)}`, '#15803d')}
    ${tile('Awaiting test / version', `${r1(ledger.awaitingSP)} SP`, `${ledger.awaitingItems} items`)}
    ${tile('Pace', paceText, pace?.elapsed != null ? `${pct(pace.elapsed)} of working days gone` : 'No sprint dates', paceColor)}
  </tr></table>

  ${trendRows ? `${heading('Sprint over sprint')}
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr>${th('Sprint')}${th('Committed SP', 1)}${th('Done SP', 1)}${th('Delivered', 1)}${th('Carried over', 1)}${th('Added after start', 1)}${th('Median cycle (days)', 1)}</tr>
    ${trendRows}
  </table>` : ''}

  ${heading('Projects forecast past target')}
  ${projectRows ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${projectRows}</table>`
    : '<p style="font-size:12px;color:#475569;margin:0">None. Projects without a target date are not judged.</p>'}

  ${adverse.length ? `${heading('What to look at')}
  ${adverse.map(t => `<p style="margin:0 0 7px;font-size:12px;line-height:1.55;color:#1e293b"><b>${esc(t.title)}.</b> ${esc(t.detail)}</p>`).join('')}` : ''}

  ${stuck.length ? `${heading(`Stuck ${STUCK_DAYS}+ working days in one status`)}
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr>${th('Ticket')}${th('Summary')}${th('Status')}${th('In status', 1)}</tr>${itemRows(stuck, x => `${x.days} days`)}
  </table>` : ''}

  ${hasHistory && slipping.length ? `${heading(`Carried through ${LONG_SLIP}+ sprints`)}
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
    <tr>${th('Ticket')}${th('Summary')}${th('Status')}${th('Earlier sprints', 1)}</tr>${itemRows(slipping, x => String(x.sprintsBefore))}
  </table>` : ''}

  <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:18px 0 0;border-top:1px solid #e2e8f0">
    <div style="font-size:10.5px;color:#94a3b8;line-height:1.6">
      Committed = every ticket in the sprint while it ran. Done = Done, Closed, Resolved or Completed. Delivered = done SP ÷ committed SP.
      Carried over = share of a sprint's items already in an earlier sprint. Added after start = moved in or created after the sprint's first day.
      Cycle time = working days from leaving To Do to Done. Project forecasts come from the Project Manager view on the Timeline tab.
    </div>
  </td></tr></table>
</div>`.trim();
}

/** Plain-text mirror of the HTML. */
export function buildManagementText({ ledger, pace, comparison, behind = [], stale = [], carried = [], tips = [], synopsis, hasHistory = true, meta }) {
  const running = pace?.elapsed != null && pace.elapsed < 100;
  const L = [];
  L.push(`SPRINT SUMMARY · ${shortSprint(ledger.sprint)}`);
  L.push(`${fmtDate(ledger.start)} – ${fmtDate(ledger.end)} · ${meta.scopeLabel} · generated ${meta.generatedAt}`);
  L.push('');
  L.push('SYNOPSIS');
  synopsis.forEach(s => { L.push(s); L.push(''); });
  L.push(`Committed ${r1(ledger.sp)} SP (${ledger.items} items) · Done ${r1(ledger.doneSP)} SP (${pct(ledger.deliveredPct)}) · Awaiting ${r1(ledger.awaitingSP)} SP · Pace: ${pace?.verdict === 'behind' ? 'behind' : pace?.verdict === 'on-pace' ? 'on pace' : 'unknown'}`);
  L.push('');
  if (comparison?.sprints?.length) {
    L.push('SPRINT OVER SPRINT  (committed SP / done SP / delivered / carried over / added after start / median cycle days)');
    comparison.sprints.forEach(s => L.push(`  ${shortSprint(s.sprint)}${running && s.sprint === ledger.sprint ? ' (in progress)' : ''}: ${r1(s.committedSP)} / ${r1(s.doneSP)} / ${pct(s.deliveredPct)} / ${hasHistory ? pct(s.carryInPct) : '–'} / ${hasHistory ? s.addedAfterStart : '–'} / ${s.medianCycle != null ? r1(s.medianCycle) : '–'}`));
    L.push('');
  }
  L.push('PROJECTS FORECAST PAST TARGET');
  if (behind.length) behind.forEach(p => { L.push(`  ${HEALTH_LABEL[p.health]}: ${p.project}${p.owner ? ` — ${p.owner}` : ''}`); L.push(`    ${describeProject(p)}`); });
  else L.push('  None.');
  L.push('');
  const adverse = tips.filter(t => t.severity !== 'reassuring');
  if (adverse.length) { L.push('WHAT TO LOOK AT'); adverse.forEach(t => L.push(`  - ${t.title}. ${t.detail}`)); L.push(''); }
  const stuck = stale.filter(s => s.days >= STUCK_DAYS).slice(0, 8);
  if (stuck.length) { L.push(`STUCK ${STUCK_DAYS}+ WORKING DAYS`); stuck.forEach(x => L.push(`  ${x.key}  ${x.status}  ${x.days} days  ${x.summary}`)); L.push(''); }
  const slipping = carried.filter(c => c.sprintsBefore >= LONG_SLIP).slice(0, 8);
  if (hasHistory && slipping.length) { L.push(`CARRIED THROUGH ${LONG_SLIP}+ SPRINTS`); slipping.forEach(x => L.push(`  ${x.key}  ${x.status}  ${x.sprintsBefore} earlier sprints  ${x.summary}`)); }
  return L.join('\n').trim();
}

