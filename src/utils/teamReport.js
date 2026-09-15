// Narrative + email-report builder for the Team Contribution tab.
// Takes the metrics object produced by computeTeam() and turns it into
//  · a plain-language synopsis (who is performing, who needs to add value)
//  · a per-contributor standing with the evidence behind it
//  · an email-client-safe HTML body and a plain-text mirror.

const f1 = n => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const f2 = n => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
const pctI = n => (Number.isFinite(n) ? Math.round(n) : null);
const pc = v => (Number.isFinite(v) ? Math.round(v * 100) + '%' : '—');
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Bands. "clear" = the 95% CI separates them from the team median; "tentative" = it does not.
export const BANDS = {
  ahead:      { key: 'ahead',      label: 'Performing above the team pace', color: '#15803d', bg: '#f0fdf4', border: '#86efac' },
  onPace:     { key: 'onPace',     label: 'Performing at the team pace',    color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
  behind:     { key: 'behind',     label: 'Below the team pace — needs to add more',  color: '#b45309', bg: '#fffbeb', border: '#fcd34d' },
  unassessed: { key: 'unassessed', label: 'Not assessable this window',     color: '#475569', bg: '#f8fafc', border: '#cbd5e1' },
};
const BAND_ORDER = ['ahead', 'onPace', 'behind', 'unassessed'];

const listNames = arr => {
  if (!arr.length) return '';
  if (arr.length === 1) return arr[0];
  return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
};

// ─── Per-person standing ──────────────────────────────────────────────────────
export function classifyContributors(M, { sprintCount = 0 } = {}) {
  const median = M.team.spPerDayMedian;
  const cycleMedian = M.team.cyclePerSPMedian;
  const teamMedianSize = (() => {
    const sizes = M.rows.map(r => r.medianSize).filter(Number.isFinite);
    if (!sizes.length) return null;
    const s = [...sizes].sort((a, b) => a - b); const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  })();

  return M.rows.map(r => {
    const lo = r.spPerDayCI?.[0], hi = r.spPerDayCI?.[1];
    const gap = (r.shareCap != null) ? r.shareSP - r.shareCap : null;
    const ratio = (median > 0 && r.spPerDay != null) ? r.spPerDay / median : null;

    let band = 'unassessed', confidence = 'none', headline = r.suppressReason || 'insufficient data';
    if (r.suppressed || r.spPerDay == null || median == null) {
      band = 'unassessed';
      headline = r.allocUnknown
        ? `Available time could not be established (${r.basisLabel || 'assumed full-time'}), so no rate is shown — and they are excluded from the team denominator rather than counted at full time`
        : `Only ${r.tickets} completed pointed ticket(s) — below the 10-ticket threshold for a reliable rate`;
    } else {
      const ciAbove = Number.isFinite(lo) && lo > median;
      const ciBelow = Number.isFinite(hi) && hi < median;
      if (ciAbove)      { band = 'ahead';  confidence = 'clear'; }
      else if (ciBelow) { band = 'behind'; confidence = 'clear'; }
      else if (ratio != null && ratio >= 1.15) { band = 'ahead';  confidence = 'tentative'; }
      else if (ratio != null && ratio <= 0.85) { band = 'behind'; confidence = 'tentative'; }
      else { band = 'onPace'; confidence = ratio != null && Number.isFinite(lo) ? 'clear' : 'tentative'; }

      const vs = (ratio != null && Math.abs(ratio - 1) >= 0.02)
        ? `${Math.round(Math.abs(ratio - 1) * 100)}% ${ratio > 1 ? 'above' : 'below'} the team median`
        : 'level with the team median';
      headline = `${f2(r.spPerDay)} SP per available day — ${vs} of ${f2(median)}`;
    }

    // Evidence that supports the standing
    const strengths = [], concerns = [], context = [];

    if (gap != null && Math.abs(gap) >= 0.03) {
      const line = `Delivered ${pc(r.shareSP)} of the team's story points while holding ${pc(r.shareCap)} of its capacity (${gap > 0 ? '+' : ''}${Math.round(gap * 100)} pts).`;
      (gap > 0 ? strengths : concerns).push(line);
    }
    if (r.reopenRate === 0 && r.tickets >= 5) strengths.push('No completed ticket was reopened after being marked done.');
    if (teamMedianSize != null && r.medianSize != null && r.medianSize > teamMedianSize * 1.25)
      strengths.push(`Median ticket size ${f1(r.medianSize)} SP against a team median of ${f1(teamMedianSize)} SP — carrying larger pieces of work.`);
    if (r.sprintsActive >= sprintCount && sprintCount > 0) strengths.push(`Delivered in all ${sprintCount} sprints of the window.`);

    if (r.reopenRate != null && r.reopenRate >= 0.10)
      concerns.push(`${pc(r.reopenRate)} of completed tickets came back from Done — rework that the point totals still count as delivered.`);
    if (r.completeness != null && r.completeness < 0.5)
      concerns.push(`Logged ${pc(r.completeness)} of available hours in Jira — a logging-discipline gap, not evidence about effort.`);

    if (cycleMedian != null && r.cyclePerSP != null && r.cyclePerSP > cycleMedian * 1.3)
      context.push(`Their tickets took ${f1(r.cyclePerSP)} working days per point against a team median of ${f1(cycleMedian)} — the work was heavier than its points suggest.`);
    if (r.blockedShare != null && r.blockedShare >= 0.20)
      context.push(`${pc(r.blockedShare)} of their tickets sat in a blocked / waiting status at some point.`);
    if (r.sharedShare != null && r.sharedShare >= 0.40)
      context.push(`${pc(r.sharedShare)} of the points credited here came from tickets several people worked on.`);
    if (r.carryoverRate != null && r.carryoverRate >= 0.40)
      context.push(`${pc(r.carryoverRate)} of their tickets carried across a sprint boundary.`);
    if (r.unpointedShare != null && r.unpointedShare >= 0.4)
      context.push(`${pc(r.unpointedShare)} of their logged hours went to work other than their own completed pointed tickets — support, reviews and unpointed tasks that story-point throughput cannot see.`);
    if (r.presentCount != null && r.absentCount > 0)
      context.push(`Counted as present in ${r.presentCount} of ${r.sprintCount ?? sprintCount} sprints, so their available days are scaled to that${r.presenceBasis === 'completion' ? ' — though presence here rests on completed tickets alone, which cannot tell "away" from "here but finished nothing"' : ''}.`);
    if (r.allocPct != null && r.allocPct < 0.99)
      context.push(`Allocated ${pc(r.allocPct)} of their time to this project (${r.allocBasisShort || 'basis unstated'}); the rate is per available day, not per calendar day.`);
    if (sprintCount > 0 && r.sprintsActive > 0 && r.sprintsActive < sprintCount && r.absentCount === 0)
      context.push(`Completed work in only ${r.sprintsActive} of the ${sprintCount} sprints in the window, though they were present throughout.`);
    if (confidence === 'tentative' && band !== 'unassessed')
      context.push('The 95% confidence interval overlaps the team median, so this position is indicative rather than established.');

    return { ...r, band, confidence, headline, gap, ratio, strengths, concerns, context };
  });
}

export function groupByBand(standings) {
  const g = Object.fromEntries(BAND_ORDER.map(k => [k, []]));
  standings.forEach(s => g[s.band].push(s));
  BAND_ORDER.forEach(k => g[k].sort((a, b) => (b.spPerDay ?? -1) - (a.spPerDay ?? -1) || a.name.localeCompare(b.name)));
  return g;
}

// ─── Synopsis ─────────────────────────────────────────────────────────────────
export function buildSynopsis(M, standings, { scopeLabel, windowN, sprintCount, projectLabel }) {
  const g = groupByBand(standings);
  const p = [];

  p.push(
    `This is a throughput read of the ${projectLabel} team over the ${sprintCount || windowN} completed sprint(s) in the window (${scopeLabel}). ` +
    `Everyone is measured on the same basis: story points on tickets they owned when the ticket was completed, divided by the working days they were actually available on this project. ` +
    `That makes the comparison fair between people with different allocations — but it is a measure of delivered volume, not of capability or effort.`
  );

  if (M.team.spPerDay != null) {
    p.push(
      `Across the window the team delivered ${f1(M.team.assessableSP ?? M.team.totalSP)} story points on ${M.team.assessableTickets ?? M.team.totalTickets} tickets, using ${f1(M.team.totalAllocDays)} available person-days — a team pace of ${f2(M.team.spPerDay)} SP per person-day, with an individual median of ${f2(M.team.spPerDayMedian)} SP/day. ` +
      `Available days count only the sprints each person was actually on the team, scaled by their allocation to this project${M.team.excludedSP > 0 ? `; a further ${f1(M.team.excludedSP)} points were delivered by people whose available time could not be established, and they are left out of both sides of that ratio rather than counted at full time` : ''}.`
    );
  }
  if (M.team.cycleDaysMedian != null) {
    p.push(
      `Before reading anything into individual differences, note the process finding underneath them: a typical completed ticket is ${f1(M.team.medianTicketSize)} points and takes ${f1(M.team.cycleDaysMedian)} working days from first activity to Done${M.team.openWipMedian != null ? `, while each person has about ${f1(M.team.openWipMedian)} tickets sitting in an in-progress status` : ''}${M.queue?.stale ? `, and ${M.queue.stale} of the ${M.queue.open} open tickets have been open more than ${M.queue.staleThreshold} working days` : ''}. ` +
      `${M.littlesLaw?.breached ? 'Cycle time only ever measures tickets that finished, so it is a best case — the stalled items never enter it. ' : ''}` +
      `${M.flow?.verdict === 'flow' ? 'That combination points at too much started and left open — a flow problem the team shares, not an individual one.' : M.flow?.verdict === 'blocking' ? 'Little is open at once, so the delay is work waiting on something outside the team rather than congestion — again a shared problem, not an individual one.' : ''}`.trim()
    );
  }

  if (g.ahead.length) {
    const clear = g.ahead.filter(s => s.confidence === 'clear').map(s => s.name);
    const tent = g.ahead.filter(s => s.confidence !== 'clear').map(s => s.name);
    let s = `Carrying more than their share: ${listNames(g.ahead.map(x => x.name))}. `;
    if (clear.length) s += `${listNames(clear)} ${clear.length > 1 ? 'are' : 'is'} above the team median by a margin wider than the statistical noise. `;
    if (tent.length) s += `${listNames(tent)} ${tent.length > 1 ? 'are' : 'is'} ahead on the numbers but within the margin of error. `;
    const topGap = g.ahead.filter(x => x.gap != null).sort((a, b) => b.gap - a.gap)[0];
    if (topGap && topGap.gap >= 0.05) s += `${topGap.name} in particular delivered ${pc(topGap.shareSP)} of the team's points on ${pc(topGap.shareCap)} of its capacity.`;
    p.push(s.trim());
  } else {
    p.push('No contributor sits clearly above the team pace this window — delivery is evenly spread across those who can be assessed.');
  }

  if (g.onPace.length) {
    p.push(`Delivering at the expected rate: ${listNames(g.onPace.map(x => x.name))}. Their differences from the team median are inside the margin of error, so they should be read as equivalent to one another.`);
  }

  if (g.behind.length) {
    const names = listNames(g.behind.map(x => x.name));
    let s = `Below the pace the rest of the team is holding, and where more output is needed: ${names}. `;
    const explained = g.behind.filter(x => x.context.length);
    const unexplained = g.behind.filter(x => !x.context.length);
    if (explained.length) {
      s += `For ${listNames(explained.map(x => x.name))} the shortfall is at least partly explained by the work itself — ${explained[0].context[0].charAt(0).toLowerCase() + explained[0].context[0].slice(1)} `;
      s += `Those factors should be checked before the gap is treated as a performance issue. `;
    }
    if (unexplained.length) {
      s += `For ${listNames(unexplained.map(x => x.name))} the data shows no offsetting factor — no unusual cycle time, blocking, or shared-ticket load — so the gap is the conversation to have.`;
    }
    p.push(s.trim());
  } else {
    p.push('No contributor falls clearly below the team pace this window.');
  }

  if (g.unassessed.length) {
    p.push(`Not assessable: ${listNames(g.unassessed.map(x => x.name))}. Too few completed pointed tickets, or an unknown allocation to this project, so a rate would be misleading — their raw volume is still in the table.`);
  }

  p.push(
    `Two things this report cannot see: approved leave inside a sprint, and work that never carried story points (support, reviews, incidents, meetings)${M.unpointedMedian != null ? ` — half the team logs ${pctI(M.unpointedMedian * 100)}% or more of their hours on exactly that kind of work` : ''}. Both understate whoever did more of them. ` +
    `Sample sizes are small, so treat the confidence intervals seriously — where two people's intervals overlap, the difference between them is not real. Use this to open a conversation, not to close one.`
  );

  return p;
}

// ─── HTML email body ──────────────────────────────────────────────────────────
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function kpiCells(M, workingDaysInWindow) {
  const items = [
    ['Contributors', M.rows.length, 'active in the window'],
    ['SP delivered', f1(M.team.totalSP), `${M.team.totalTickets} completed tickets`],
    ['Person-days available', f1(M.team.totalAllocDays), `${workingDaysInWindow} working days × allocation`],
    ['Team SP / day', M.team.spPerDay != null ? f2(M.team.spPerDay) : '—', `individual median ${M.team.spPerDayMedian != null ? f2(M.team.spPerDayMedian) : '—'}`],
  ];
  return items.map(([l, v, s]) => `
    <td width="25%" style="padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;vertical-align:top">
      <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:.04em">${esc(l)}</div>
      <div style="font-size:22px;font-weight:700;color:#0f172a;padding:4px 0 2px">${esc(v)}</div>
      <div style="font-size:11px;color:#94a3b8">${esc(s)}</div>
    </td>`).join('<td width="8">&nbsp;</td>');
}

function personBlock(s) {
  const b = BANDS[s.band];
  const bullets = [
    ...s.strengths.map(x => ['#15803d', '▲', x]),
    ...s.concerns.map(x => ['#b45309', '▼', x]),
    ...s.context.map(x => ['#475569', '•', x]),
  ];
  const stats = s.band === 'unassessed'
    ? `${s.tickets} tickets · ${f1(s.sp)} SP${s.hours != null ? ` · ${f1(s.hours)}h logged` : ''} · ${s.sprintsActive} sprint(s)`
    : `${f2(s.spPerDay)} SP/day${Number.isFinite(s.spPerDayCI?.[0]) ? ` [95% CI ${f2(s.spPerDayCI[0])}–${f2(s.spPerDayCI[1])}]` : ''} · ${s.tickets} tickets · ${f1(s.sp)} SP · ${pc(s.shareSP)} of team points on ${s.shareCap != null ? pc(s.shareCap) : '—'} of capacity`;
  return `
  <tr><td style="padding:0 0 10px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:${b.bg};border:1px solid ${b.border};border-left:4px solid ${b.color};border-radius:8px">
      <tr><td style="padding:12px 14px">
        <div style="font-size:14px;font-weight:700;color:#0f172a">${esc(s.name)}
          <span style="font-size:11px;font-weight:600;color:${b.color};padding-left:8px">${esc(b.label)}${s.confidence === 'tentative' ? ' (indicative)' : ''}</span>
        </div>
        <div style="font-size:12.5px;color:#334155;padding:4px 0 2px">${esc(s.headline)}</div>
        <div style="font-size:11.5px;color:#64748b;padding-bottom:${bullets.length ? '8px' : '0'}">${esc(stats)}</div>
        ${bullets.length ? `<div>${bullets.map(([c, m, t]) => `<div style="font-size:12px;color:#334155;padding:2px 0"><span style="color:${c};font-weight:700">${m}</span> ${esc(t)}</div>`).join('')}</div>` : ''}
      </td></tr>
    </table>
  </td></tr>`;
}

function contributorTable(standings) {
  const th = (t, a = 'right') => `<th style="text-align:${a};padding:7px 8px;font-size:10.5px;color:#475569;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #cbd5e1;white-space:nowrap">${t}</th>`;
  const td = (t, a = 'right', extra = '') => `<td style="text-align:${a};padding:7px 8px;font-size:12px;color:#0f172a;border-bottom:1px solid #eef2f7;${extra}">${t}</td>`;
  const rows = [...standings].sort((a, b) => a.name.localeCompare(b.name)).map(s => {
    const b = BANDS[s.band];
    return `<tr>
      ${td(esc(s.name), 'left', 'font-weight:600;white-space:nowrap')}
      ${td(`<span style="font-size:10.5px;font-weight:600;color:${b.color}">${s.band === 'ahead' ? 'Above pace' : s.band === 'behind' ? 'Below pace' : s.band === 'onPace' ? 'At pace' : 'Not assessable'}</span>`, 'left')}
      ${td(s.tickets)}
      ${td(f1(s.sp))}
      ${td(s.hours != null ? f1(s.hours) + 'h' : '—')}
      ${td(s.spPerDay != null ? f2(s.spPerDay) : '—', 'right', 'font-weight:600')}
      ${td(Number.isFinite(s.spPerDayCI?.[0]) ? `${f2(s.spPerDayCI[0])}–${f2(s.spPerDayCI[1])}` : '—', 'right', 'color:#64748b;font-size:11px')}
      ${td(s.medianSize != null ? f1(s.medianSize) : '—')}
      ${td(`${pc(s.shareSP)} / ${s.shareCap != null ? pc(s.shareCap) : '—'}`)}
      ${td(s.cyclePerSP != null ? f1(s.cyclePerSP) : '—')}
      ${td(s.reopenRate != null ? pc(s.reopenRate) : '—', 'right', s.reopenRate > 0 ? 'color:#b91c1c' : '')}
      ${td(s.blockedShare != null ? pc(s.blockedShare) : '—')}
      ${td(s.completeness != null ? (s.completeness > 1.2 ? '>100%' : pc(s.completeness)) : '—', 'right', 'color:#64748b')}
    </tr>`;
  }).join('');
  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-family:${FONT}">
    <thead><tr>
      ${th('Contributor', 'left')}${th('Standing', 'left')}${th('Tickets')}${th('SP')}${th('Hours')}${th('SP/day')}${th('95% CI')}${th('Med size')}${th('SP% / cap%')}${th('Cycle d/SP')}${th('Reopen%')}${th('Blocked%')}${th('Log%')}
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

export function buildEmailHtml({ M, standings, synopsis, meta }) {
  const g = groupByBand(standings);
  const { subject, projectLabel, windowN, sprintCount, workingDaysInWindow, generatedAt, sprintNames = [] } = meta;

  const section = key => {
    const list = g[key]; if (!list.length) return '';
    const b = BANDS[key];
    return `
    <tr><td style="padding:16px 0 6px">
      <div style="font-size:13px;font-weight:700;color:${b.color};border-bottom:2px solid ${b.border};padding-bottom:5px">${esc(b.label)} <span style="color:#94a3b8;font-weight:500">(${list.length})</span></div>
    </td></tr>
    <tr><td style="padding-top:10px"><table width="100%" cellpadding="0" cellspacing="0">${list.map(personBlock).join('')}</table></td></tr>`;
  };

  return `
<div style="font-family:${FONT};max-width:920px;margin:0 auto;color:#0f172a;background:#ffffff;padding:4px">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:0 0 14px;border-bottom:3px solid #0f172a">
    <div style="font-size:21px;font-weight:800;letter-spacing:-.01em">Team Contribution Report</div>
    <div style="font-size:12.5px;color:#475569;padding-top:4px">${esc(projectLabel)} · last ${sprintCount || windowN} completed sprint(s) · ${workingDaysInWindow} working days · generated ${esc(generatedAt)}</div>
    ${sprintNames.length ? `<div style="font-size:11px;color:#94a3b8;padding-top:3px">Sprints: ${esc(sprintNames.join(' · '))}</div>` : ''}
    ${meta.allocBasisSummary ? `<div style="font-size:11px;color:#94a3b8;padding-top:2px">Allocation basis: ${esc(meta.allocBasisSummary)}</div>` : ''}
  </td></tr></table>

  <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:16px 0 0">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:10px">
      <tr><td style="padding:16px 18px">
        <div style="font-size:12px;font-weight:700;color:#0f172a;text-transform:uppercase;letter-spacing:.06em;padding-bottom:8px">Synopsis — read this first</div>
        ${synopsis.map(t => `<p style="margin:0 0 9px;font-size:13px;line-height:1.62;color:#1e293b">${esc(t)}</p>`).join('')}
      </td></tr>
    </table>
  </td></tr></table>

  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px"><tr>${kpiCells(M, workingDaysInWindow)}</tr></table>

  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:20px 0 0"><div style="font-size:15px;font-weight:800;color:#0f172a">Where each person stands</div>
      <div style="font-size:11.5px;color:#64748b;padding:3px 0 0">▲ supports the standing · ▼ works against it · • context that explains the number. "Indicative" means the confidence interval overlaps the team median.</div></td></tr>
    ${BAND_ORDER.map(section).join('')}
  </table>

  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td style="padding:22px 0 8px"><div style="font-size:15px;font-weight:800;color:#0f172a">Full numbers</div>
      <div style="font-size:11.5px;color:#64748b;padding-top:3px">Alphabetical. SP/day is size-adjusted and immune to time-logging habits; Log% describes logging discipline only.</div></td></tr>
    <tr><td>${contributorTable(standings)}</td></tr>
  </table>

  <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:20px 0 0">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#fffbeb;border:1px solid #fcd34d;border-radius:10px">
      <tr><td style="padding:14px 16px;font-size:12px;line-height:1.65;color:#78350f">
        <strong>How these numbers were produced, and what they cannot tell you.</strong><br>
        Story points are credited whole to whoever owned the ticket at the moment it was completed, taken from Jira change history — not split, and not affected by how diligently anyone logs time.
        Available days are the working days of the sprints each person was actually on the team (weekends and Greek public holidays excluded), multiplied by their allocation to this project. Presence is detected from work logged inside a sprint or a ticket completed in it.
        A rate is only shown for someone with at least 10 completed pointed tickets and an establishable allocation; anyone else is left out of the team totals on both sides, rather than counted as full-time.
        Allocation basis for this report: ${esc(meta.allocBasisSummary || 'not stated')}.<br><br>
        <strong>Approved leave is not in this data</strong>, so a week off inside a sprint reads as slower delivery. Unpointed work — support, reviews, incidents, mentoring — is invisible to a points-based rate.
        Story points measure agreed size, not difficulty, and what each person was assigned was largely not their choice. Where two confidence intervals overlap, the difference between those two people is noise.
      </td></tr>
    </table>
  </td></tr></table>

  <div style="font-size:11px;color:#94a3b8;padding:16px 0 4px;border-top:1px solid #e2e8f0;margin-top:18px">${esc(subject)} · generated from Jira by the Sprint Dashboard on ${esc(generatedAt)}.</div>
</div>`.trim();
}

// ─── Plain-text mirror ────────────────────────────────────────────────────────
export function buildEmailText({ M, standings, synopsis, meta }) {
  const g = groupByBand(standings);
  const { subject, projectLabel, windowN, sprintCount, workingDaysInWindow, generatedAt } = meta;
  const L = [];
  const rule = c => L.push(c.repeat(72));
  const wrap = (t, w = 72) => {
    const out = []; let line = '';
    for (const word of String(t).split(/\s+/)) {
      if ((line + ' ' + word).trim().length > w) { out.push(line.trim()); line = word; } else line += ' ' + word;
    }
    if (line.trim()) out.push(line.trim());
    return out;
  };

  L.push('TEAM CONTRIBUTION REPORT');
  L.push(`${projectLabel} · last ${sprintCount || windowN} completed sprint(s) · ${workingDaysInWindow} working days`);
  L.push(`Generated ${generatedAt}`);
  if (meta.allocBasisSummary) L.push(`Allocation basis: ${meta.allocBasisSummary}`);
  rule('=');
  L.push('SYNOPSIS');
  L.push('');
  synopsis.forEach(pa => { L.push(...wrap(pa)); L.push(''); });
  rule('-');
  L.push(`Team: ${f1(M.team.assessableSP ?? M.team.totalSP)} SP on ${M.team.assessableTickets ?? M.team.totalTickets} tickets · ${f1(M.team.totalAllocDays)} person-days · ${M.team.spPerDay != null ? f2(M.team.spPerDay) : '—'} SP/day (individual median ${M.team.spPerDayMedian != null ? f2(M.team.spPerDayMedian) : '—'})`);
  if (M.team.cycleDaysMedian != null) L.push(`Flow: typical ticket ${f1(M.team.medianTicketSize)} SP, ${f1(M.team.cycleDaysMedian)} working days to Done${M.team.openWipMedian != null ? `, ${f1(M.team.openWipMedian)} open in-progress per person` : ''}${M.queue?.stale ? `, ${M.queue.stale} of ${M.queue.open} open >${M.queue.staleThreshold}d` : ''}`);
  rule('-');

  BAND_ORDER.forEach(k => {
    if (!g[k].length) return;
    L.push('');
    L.push(`${BANDS[k].label.toUpperCase()} (${g[k].length})`);
    g[k].forEach(s => {
      L.push('');
      L.push(`  ${s.name}${s.confidence === 'tentative' ? ' (indicative)' : ''}`);
      wrap(s.headline, 66).forEach(x => L.push('    ' + x));
      L.push(`    ${s.tickets} tickets · ${f1(s.sp)} SP · ${pc(s.shareSP)} of points on ${s.shareCap != null ? pc(s.shareCap) : '—'} of capacity`);
      s.strengths.forEach(x => wrap(x, 64).forEach((y, i) => L.push((i ? '      ' : '    + ') + y)));
      s.concerns.forEach(x => wrap(x, 64).forEach((y, i) => L.push((i ? '      ' : '    - ') + y)));
      s.context.forEach(x => wrap(x, 64).forEach((y, i) => L.push((i ? '      ' : '    . ') + y)));
    });
  });

  L.push('');
  rule('-');
  L.push('FULL NUMBERS');
  const pad = (s, n) => String(s ?? '—').padEnd(n).slice(0, n);
  const padS = (s, n) => String(s ?? '—').padStart(n);
  L.push(pad('Contributor', 22) + padS('Tkts', 5) + padS('SP', 7) + padS('SP/day', 8) + padS('SP%', 6) + padS('Cap%', 6) + padS('Reopen', 7));
  L.push('-'.repeat(61));
  [...standings].sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
    L.push(pad(s.name, 22) + padS(s.tickets, 5) + padS(f1(s.sp), 7) + padS(s.spPerDay != null ? f2(s.spPerDay) : '—', 8) + padS(pc(s.shareSP), 6) + padS(s.shareCap != null ? pc(s.shareCap) : '—', 6) + padS(s.reopenRate != null ? pc(s.reopenRate) : '—', 7));
  });

  L.push('');
  rule('-');
  L.push('HOW TO READ THIS');
  wrap('Story points are credited whole to whoever owned the ticket when it was completed (from Jira change history) and are unaffected by time-logging habits. Available days are working days in the window (weekends and Greek public holidays excluded) times each person\'s allocation to this project. Rates are shown only for people with 10+ completed pointed tickets and a known allocation.').forEach(x => L.push(x));
  L.push('');
  wrap('Approved leave is not in this data, so time off reads as slowness. Unpointed work — support, reviews, incidents, mentoring — is invisible. Story points measure agreed size, not difficulty, and assignment was largely not the individual\'s choice. Where two confidence intervals overlap, the difference is noise.').forEach(x => L.push(x));
  L.push('');
  L.push(`${subject} · Sprint Dashboard · ${generatedAt}`);
  return L.join('\r\n');
}

// ─── Clipboard helpers ────────────────────────────────────────────────────────
export async function copyRich(html, text) {
  try {
    if (navigator.clipboard && typeof window.ClipboardItem === 'function') {
      await navigator.clipboard.write([new window.ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return true;
    }
  } catch { /* fall through to execCommand */ }
  const host = document.createElement('div');
  host.setAttribute('contenteditable', 'true');
  host.innerHTML = html;
  host.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:normal';
  document.body.appendChild(host);
  const range = document.createRange(); range.selectNodeContents(host);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  sel.removeAllRanges(); document.body.removeChild(host);
  return ok;
}

export async function copyPlain(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-99999px;top:0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    document.body.removeChild(ta); return ok;
  }
}

export function standaloneDocument(html, title) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{margin:0;padding:26px;background:#fff}@media print{body{padding:0}@page{size:A4 portrait;margin:12mm}}</style>
</head><body>${html}</body></html>`;
}
