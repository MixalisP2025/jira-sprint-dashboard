// Turns the metrics engine's output into the plain findings the Overview renders.
// Kept out of the component so the judgement calls — what counts as "standing out",
// what counts as "worth a conversation" — can be unit-tested and argued with directly.
//
// Every signal below is a statement about WORK, phrased so it points at a cause a
// manager can act on. None of them is a statement about a person's ability, and none
// fires on delivery rate alone: rate depends on allocation (partly inferred), on
// ticket size, and on how much of someone's work carries a story point at all.

import { f1, f2, pctI, median } from './teamEngine';

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

// ─── Per-person direction of travel across the window ─────────────────────────
// Deliberately NOT a significance test: with 6 sprints there is no power for one,
// and the honest framing is "this moved" not "this is trending".
export function trendOf(trendData, name) {
  const vals = trendData.map(d => d[name]).filter(v => Number.isFinite(v));
  if (vals.length < 4) return null;
  const half = Math.floor(vals.length / 2);
  const early = mean(vals.slice(0, half));
  const late = mean(vals.slice(-half));
  if (!(early > 0) || !Number.isFinite(late)) return null;
  const ratio = late / early;
  return { early, late, ratio, n: vals.length, dir: ratio >= 1.25 ? 1 : ratio <= 0.8 ? -1 : 0 };
}

// ─── Thresholds ───────────────────────────────────────────────────────────────
// Each is a round number chosen to be explicable, not tuned. They are exported so
// the Overview can state them on screen rather than applying them invisibly.
export const T = {
  fastCycle: 0.75,      // ≤ this × team norm working-days-per-point reads as fast
  slowCycle: 1.3,       // ≥ this × team norm reads as work sitting
  reopen: 0.2,          // ≥ 20% of tickets coming back
  blocked: 0.3,         // ≥ 30% passing through a blocked status
  invisible: 0.5,       // ≥ 50% of logged hours on unpointed work
  staleCount: 2,        // ≥ 2 tickets past the stale threshold
  wipMultiple: 1.75,    // ≥ this × team norm open at once
  wipFloor: 3,          // …and at least this many, so small numbers don't trip it
  largeShare: 0.5,      // ≥ half their tickets in the largest size band
  // Any signal that is a PERCENTAGE OF THEIR TICKETS needs a denominator worth
  // quoting. "100% of their tickets were blocked" off six tickets is not a finding,
  // and putting it in front of a manager as one is how these panels lose trust.
  minTicketsForRate: 8,
};

// How much each concern should pull someone up the list. Work that has stopped
// moving outranks work that is merely slow.
const WEIGHT = { stalled: 3, declining: 3, rework: 2, slow: 2, blocked: 2, wip: 1 };

// ─── One person's read ────────────────────────────────────────────────────────
export function assessPerson(r, ctx) {
  const strengths = [];
  const concerns = [];
  // Signals that say "this view cannot see their work" are kept apart from signals
  // about the work itself. Mixing them buries real coaching signals under data gaps,
  // and implies a data problem is the person's problem.
  const visibility = [];
  const tr = ctx.trendOf ? ctx.trendOf(r.name) : null;
  const sizeTotal = r.sizeMix ? r.sizeMix.Small + r.sizeMix.Medium + r.sizeMix.Large : 0;
  const enoughForRate = r.tickets >= T.minTicketsForRate;

  // ── Strengths ──
  if (!r.suppressed && Number.isFinite(r.spPerDayCI?.[0]) && ctx.rateMedian > 0 && r.spPerDayCI[0] > ctx.rateMedian) {
    strengths.push({
      tag: 'delivery',
      text: `Delivers ${f2(r.spPerDay)} points per available day against a team typical of ${f2(ctx.rateMedian)} — and stays above it even at the pessimistic end of the uncertainty range, which most people here do not.`,
    });
  }
  if (r.cyclePerSP != null && ctx.cycleNorm > 0 && r.cyclePerSP <= ctx.cycleNorm * T.fastCycle) {
    strengths.push({
      tag: 'flow',
      text: `Work moves quickly once started — about ${f1(r.cyclePerSP)} working days per point against a team norm of ${f1(ctx.cycleNorm)}. Their tickets do not sit.`,
    });
  }
  if (r.sprintsActive === r.sprintCount && r.sprintCount >= 3 && r.staleNow === 0 && (r.reopenRate === 0 || r.reopenRate == null) && r.tickets >= 10) {
    strengths.push({
      tag: 'consistency',
      text: `Landed completed work in all ${r.sprintCount} sprints, with nothing reopened and nothing stale. Consistency at this level is rarer than a high peak.`,
    });
  }
  if (tr && tr.dir > 0) {
    strengths.push({
      tag: 'improving',
      text: `Output has risen across the window — from about ${f2(tr.early)} to ${f2(tr.late)} points per available day. Whatever changed is worth naming out loud.`,
    });
  }
  if (sizeTotal > 0 && r.sizeMix.Large / sizeTotal >= T.largeShare && r.tickets >= 10) {
    strengths.push({
      tag: 'hard-work',
      text: `${pctI((r.sizeMix.Large / sizeTotal) * 100)}% of their completed tickets were in the largest size band — they are absorbing the chunky work, which depresses ticket counts and flatters nobody's dashboard.`,
    });
  }

  // ── Concerns ──
  if (r.staleNow >= T.staleCount) {
    concerns.push({
      tag: 'stalled',
      ask: 'What is actually blocking these — and can we close or drop any of them?',
      text: `${r.staleNow} of their ${r.openNow} open tickets have sat longer than ${ctx.staleThreshold} working days. This is a flow problem, not an output problem — the work was started and then parked.`,
    });
  }
  if (enoughForRate && r.reopenRate != null && r.reopenRate >= T.reopen) {
    concerns.push({
      tag: 'rework',
      ask: 'What does "done" mean on their tickets, and who checks it?',
      text: `${pctI(r.reopenRate * 100)}% of their ${r.tickets} tickets came back after being marked done. That usually points at acceptance criteria or review depth rather than at care.`,
    });
  }
  if (enoughForRate && r.cyclePerSP != null && ctx.cycleNorm > 0 && r.cyclePerSP >= ctx.cycleNorm * T.slowCycle) {
    concerns.push({
      tag: 'slow',
      ask: 'Are they carrying too many threads, or waiting on someone?',
      text: `Their work takes about ${f1(r.cyclePerSP)} working days per point against a team norm of ${f1(ctx.cycleNorm)}. Tickets are sitting rather than failing — the elapsed time is going somewhere other than the work.`,
    });
  }
  if (enoughForRate && r.blockedShare != null && r.blockedShare >= T.blocked) {
    concerns.push({
      tag: 'blocked',
      ask: 'Who or what are they waiting on, and can that dependency be removed?',
      text: `${pctI(r.blockedShare * 100)}% of their ${r.tickets} tickets passed through a blocked status — materially more than most. They are waiting on other people, and that is usually fixable by someone other than them.`,
    });
  }
  if (r.unpointedShare != null && r.unpointedShare >= T.invisible && r.hours > 0) {
    visibility.push({
      tag: 'invisible',
      ask: 'Should this work be ticketed and pointed, or recognised openly as unplanned load?',
      text: `${pctI(r.unpointedShare * 100)}% of their logged hours went to work carrying no story points. Most of what they do is invisible here — do not read their delivery rate as low output.`,
      countersRate: true,
    });
  }
  // Only meaningful when every sprint in the window could actually be measured. If
  // half the window was dropped for poor pointing coverage, "completed nothing in
  // sprint 4" is a fact about the sprint, not about the person.
  if (r.presentButQuiet && ctx.allSprintsRated) {
    visibility.push({
      tag: 'quiet',
      ask: 'What have they actually been working on?',
      text: `Present for the whole window, but completed pointed work in only ${r.sprintsActive} of ${r.sprintCount} sprints. Either the work is not being captured as tickets, or it is going somewhere this view cannot see.`,
      countersRate: true,
    });
  }
  if (tr && tr.dir < 0) {
    concerns.push({
      tag: 'declining',
      ask: 'What changed for them partway through the window?',
      text: `Output has fallen across the window — from about ${f2(tr.early)} to ${f2(tr.late)} points per available day. A drop this size usually has a cause worth asking about directly.`,
    });
  }
  if (r.openWip != null && ctx.wipNorm > 0 && r.openWip >= ctx.wipNorm * T.wipMultiple && r.openWip >= T.wipFloor) {
    concerns.push({
      tag: 'wip',
      ask: 'Can they finish something before starting the next thing?',
      text: `Typically has ${f1(r.openWip)} tickets open at once against a team norm of ${f1(ctx.wipNorm)}. Too much in flight is the most common cause of slow cycle time, and it is the easiest to fix.`,
    });
  }

  const severity = concerns.reduce((a, c) => a + (WEIGHT[c.tag] || 1), 0);
  const group = concerns.length
    ? 'attention'
    : visibility.length ? 'invisible'
      : strengths.length ? 'standout' : 'steady';
  return { name: r.name, row: r, strengths, concerns, visibility, trend: tr, group, severity };
}

// ─── Whole-team read ──────────────────────────────────────────────────────────
export function buildOverview(M) {
  const team = M.team;
  const rows = M.rows || [];
  const assessable = rows.filter(r => !r.suppressed);
  const trendData = M.trend?.data || [];

  const cycleNorm = team.cyclePerSPMedian;
  const rateMedian = team.spPerDayMedian;
  const wipNorm = team.openWipMedian;

  const allSprints = M.bySprint || [];
  const ctx = {
    rateMedian, cycleNorm, wipNorm,
    staleThreshold: M.queue?.staleThreshold ?? 20,
    allSprintsRated: allSprints.length > 0 && allSprints.every(s => s.rated),
    trendOf: name => trendOf(trendData, name),
  };

  const people = rows.map(r => assessPerson(r, ctx));
  const byName = new Map(people.map(p => [p.name, p]));

  // Ranking covers assessable people only — everyone else has no rate to rank.
  const ranked = assessable
    .filter(r => Number.isFinite(r.spPerDay))
    .sort((a, b) => b.spPerDay - a.spPerDay)
    .map(r => {
      const lo = r.spPerDayCI?.[0], hi = r.spPerDayCI?.[1];
      const separation = (Number.isFinite(lo) && Number.isFinite(hi) && rateMedian > 0)
        ? (lo > rateMedian ? 'above' : hi < rateMedian ? 'below' : 'typical')
        : 'unknown';
      const p = byName.get(r.name);
      return {
        name: r.name, rate: r.spPerDay, lo, hi, separation,
        tickets: r.tickets, sp: r.sp,
        // a rate that the person's own signals say is not measuring their output
        // countersRate is set on visibility notes (unpointed work, quiet sprints), not concerns
        rateMisleading: !!p && [...p.concerns, ...p.visibility].some(c => c.countersRate),
      };
    });
  const distinguishable = ranked.filter(r => r.separation === 'above' || r.separation === 'below').length;

  // Sprint-by-sprint behaviour. The comparison is against the previous MEASURED
  // sprint — comparing against a sprint that was dropped for poor pointing coverage
  // produces a "-100%" that describes the measurement, not the delivery.
  const sprints = allSprints.map((s, i, arr) => {
    const prev = s.rated ? arr.slice(0, i).reverse().find(p => p.rated) : null;
    const deltaSP = prev && prev.sp > 0 ? (s.sp - prev.sp) / prev.sp : null;
    return {
      label: s.label, name: s.name, rated: s.rated,
      sp: s.sp, tickets: s.tickets, medianCycle: s.medianCycle,
      stale: s.stale, present: s.present, of: s.of,
      pointingCoverage: s.pointingCoverage,
      spPerDay: s.spPerDay, deltaSP,
    };
  });
  const ratedSprints = sprints.filter(s => s.rated);
  const typicalSP = ratedSprints.length ? median(ratedSprints.map(s => s.sp)) : null;
  const swing = ratedSprints.length >= 2
    ? { lo: Math.min(...ratedSprints.map(s => s.sp)), hi: Math.max(...ratedSprints.map(s => s.sp)) }
    : null;

  return {
    ctx, people, ranked, distinguishable,
    groups: {
      // most-serious first, so a long list is still readable top-down
      attention: people.filter(p => p.group === 'attention').sort((a, b) => b.severity - a.severity),
      standout: people.filter(p => p.group === 'standout' && !p.row.suppressed),
      invisible: people.filter(p => p.group === 'invisible'),
      steady: people.filter(p => p.group === 'steady' && !p.row.suppressed),
      // everyone left without an establishable rate — including anyone whose only
      // strengths came from a sample too small to stand behind
      unknown: people.filter(p => p.row.suppressed && p.group !== 'attention' && p.group !== 'invisible'),
    },
    sprints, ratedSprints, typicalSP, swing,
    measuredCount: ratedSprints.length, sprintCount: sprints.length,
    assessableCount: assessable.length,
  };
}
