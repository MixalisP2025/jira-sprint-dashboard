import { describe, it, expect } from 'vitest';
import {
  describeVariance, describeProject, describeMovement,
  buildSynopsis, buildReportHtml, buildReportText, weekCommencing, SECTIONS,
} from '../utils/projectReport';
import { HEALTH, T } from '../utils/projectPortfolio';

// The report's job is to be arguable: every status must arrive with the numbers that
// produced it, and anything it could not assess must be said out loud rather than
// quietly dropped (which would make the portfolio read healthier than it is).

const NOW = new Date('2026-02-20T00:00:00Z');

const proj = (over = {}) => ({
  project: 'ALPHA', owner: '', note: null, forecastNote: null,
  totalSP: 100, completedSP: 50, remainingSP: 50, items: 20, doneItems: 10,
  unpointedItems: 0, percentComplete: 50, sprintCount: 6, sprintsUsed: 6,
  spPerWeek: 10, velocityReason: null, targetDate: '2026-03-20',
  forecastDate: '2026-03-13', varianceWeeks: -1, requiredSpPerWeek: 12.5,
  beyondHorizon: false, weeksRemaining: 5, health: HEALTH.ON_TRACK, ...over,
});

const meta = { generatedAt: '20/02/2026', weekLabel: 'w/c 16 Feb 2026', scopeLabel: 'All projects', now: NOW };

describe('describeVariance', () => {
  it('reads as English, not a signed decimal', () => {
    expect(describeVariance(3)).toBe('3 weeks later than target');
    expect(describeVariance(-2)).toBe('2 weeks ahead of target');
    expect(describeVariance(1)).toMatch(/7 days later/);
    expect(describeVariance(0.2)).toBe('on the target date');
  });
  it('says nothing when there is no variance to describe', () => {
    expect(describeVariance(null)).toBe('');
  });
});

describe('describeProject', () => {
  it('carries the evidence behind the status', () => {
    const s = describeProject(proj({ health: HEALTH.AT_RISK, varianceWeeks: 3, forecastDate: '2026-05-29' }));
    expect(s).toContain('50% complete');
    expect(s).toContain('50/100 SP');
    expect(s).toContain('10 SP/wk measured');
    expect(s).toContain('12.5 SP/wk');          // the rate that would be needed
    expect(s).toContain('3 weeks later than target');
  });

  // A date 12 years out is arithmetically right and practically useless.
  it('quotes the rate instead of a date when the forecast is past the horizon', () => {
    const s = describeProject(proj({ beyondHorizon: true, spPerWeek: 0.1, health: HEALTH.OFF_TRACK }));
    expect(s).toMatch(/does not finish within \d+ years/);
    expect(s).not.toContain('forecast 2038');
  });

  it('calls a stalled project stalled', () => {
    const s = describeProject(proj({ spPerWeek: 0, health: HEALTH.OFF_TRACK, sprintsUsed: 4 }));
    expect(s).toMatch(/Stalled/i);
    expect(s).toContain('last 4 sprints');
  });

  it('asks for a target date instead of implying one', () => {
    const s = describeProject(proj({ health: HEALTH.NO_TARGET, targetDate: null, varianceWeeks: null }));
    expect(s).toMatch(/No target date set/i);
  });

  it('gives the reason a forecast is missing', () => {
    const s = describeProject(proj({
      health: HEALTH.NO_DATA, spPerWeek: null, forecastDate: null,
      forecastNote: 'Needs 2 completed sprints with dated names to forecast; has 0.',
    }));
    expect(s).toContain('Needs 2 completed sprints');
  });

  it('falls back to item counts when nothing is pointed', () => {
    const s = describeProject(proj({ totalSP: 0, completedSP: 0, items: 20, doneItems: 10, health: HEALTH.NO_TARGET }));
    expect(s).toContain('10/20 items');
  });
});

describe('describeMovement', () => {
  const history = { ALPHA: [{ week: '2026-W07', date: '2026-02-09', totalSP: 96, completedSP: 42, percentComplete: 44, health: HEALTH.AT_RISK }] };

  it('reports scope and delivery movement with the date it compares to', () => {
    const m = describeMovement(proj(), history, NOW);
    expect(m).toContain('scope up 4 SP');
    expect(m).toContain('8 SP delivered');
    expect(m).toMatch(/Since 09 Feb 2026/);
  });

  it('names a health change in words', () => {
    expect(describeMovement(proj(), history, NOW)).toMatch(/from At risk to On track/);
  });

  // The first run has no story; "+0 SP" would read as a finding.
  it('stays silent with no prior week', () => {
    expect(describeMovement(proj(), {}, NOW)).toBeNull();
  });

  it('stays silent when nothing actually moved', () => {
    const same = { ALPHA: [{ week: '2026-W07', date: '2026-02-09', totalSP: 100, completedSP: 50, percentComplete: 50, health: HEALTH.ON_TRACK }] };
    expect(describeMovement(proj(), same, NOW)).toBeNull();
  });
});

describe('buildSynopsis', () => {
  it('leads with how many projects need attention', () => {
    const s = buildSynopsis([
      proj({ project: 'A', health: HEALTH.OFF_TRACK, varianceWeeks: 6 }),
      proj({ project: 'B', health: HEALTH.AT_RISK, varianceWeeks: 2 }),
      proj({ project: 'C', health: HEALTH.ON_TRACK }),
    ], { now: NOW });
    expect(s[0]).toMatch(/2 of 3 tracked projects need attention/);
    expect(s.join(' ')).toMatch(/Off track: A/);
  });

  it('says so plainly when nothing needs attention', () => {
    const s = buildSynopsis([proj({ health: HEALTH.ON_TRACK })], { now: NOW });
    expect(s[0]).toMatch(/No tracked project is forecast to miss/);
  });

  // A report that drops unassessable projects reads healthier than the portfolio is.
  it('states what it could not assess, and that this is not a clean bill of health', () => {
    const s = buildSynopsis([
      proj({ project: 'A', health: HEALTH.ON_TRACK }),
      proj({ project: 'B', health: HEALTH.NO_TARGET }),
      proj({ project: 'C', health: HEALTH.NO_DATA }),
      proj({ project: 'D', health: HEALTH.NO_DATA }),
    ], { now: NOW });
    const all = s.join(' ');
    expect(all).toMatch(/1 has no target date set/);
    expect(all).toMatch(/2 cannot be forecast yet/);
    expect(all).toMatch(/not judged as healthy/i);
  });
});

describe('report rendering', () => {
  const portfolio = [
    proj({ project: 'ALPHA', health: HEALTH.OFF_TRACK, varianceWeeks: 7, owner: 'N. Kopana' }),
    proj({ project: 'BETA', health: HEALTH.ON_TRACK }),
    proj({ project: 'GAMMA', health: HEALTH.NO_DATA, spPerWeek: null, forecastNote: 'Too few dated sprints.' }),
  ];
  const synopsis = buildSynopsis(portfolio, { now: NOW });

  it('renders every project into the HTML under its section', () => {
    const html = buildReportHtml({ portfolio, synopsis, meta });
    expect(html).toContain('ALPHA');
    expect(html).toContain('BETA');
    expect(html).toContain('GAMMA');
    expect(html).toContain('Off track — needs a decision');
    expect(html).toContain('Cannot forecast yet');
    expect(html).toContain('N. Kopana');
  });

  it('states the method so the numbers can be checked', () => {
    const html = buildReportHtml({ portfolio, synopsis, meta });
    expect(html).toMatch(new RegExp(`last\\s+${T.velocityWindow} completed sprints`));
    expect(html).toMatch(/carry no completion dates/);
  });

  it('escapes project names rather than letting them inject markup', () => {
    const nasty = [proj({ project: '<script>alert(1)</script>', health: HEALTH.ON_TRACK })];
    const html = buildReportHtml({ portfolio: nasty, synopsis: ['x'], meta });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('mirrors the HTML in plain text', () => {
    const text = buildReportText({ portfolio, synopsis, meta });
    expect(text).toContain('WEEKLY PROJECT STATUS');
    expect(text).toContain('ALPHA');
    expect(text).toContain('GAMMA');
    expect(text).toContain('OFF TRACK — NEEDS A DECISION (1)');
  });

  it('omits sections that have no projects', () => {
    const html = buildReportHtml({ portfolio: [proj({ health: HEALTH.ON_TRACK })], synopsis: ['x'], meta });
    expect(html).not.toContain('Off track — needs a decision');
    expect(html).toContain('On track');
  });

  it('covers every health state with a section, so nothing can render into nowhere', () => {
    const covered = new Set(SECTIONS.map(s => s.key));
    Object.values(HEALTH).forEach(h => expect(covered.has(h)).toBe(true));
  });
});

describe('weekCommencing', () => {
  it('names the Monday of the week', () => {
    expect(weekCommencing(new Date('2026-02-20T00:00:00Z'))).toBe('w/c 16 Feb 2026');  // Fri → Mon
    expect(weekCommencing(new Date('2026-02-16T00:00:00Z'))).toBe('w/c 16 Feb 2026');  // Mon → itself
  });
});

describe('ongoing projects in the report', () => {
  const bau = proj({
    project: 'BAU', health: HEALTH.ONGOING, ongoing: true,
    targetDate: null, forecastDate: null, varianceWeeks: null,
    items: 120, doneItems: 84, remainingSP: 40, spPerWeek: 6.2, sprintsUsed: 6,
  });

  // A refilling backlog makes "% complete" drift downwards; quoting it would read as
  // the project going backwards week on week.
  it('reports throughput, never a percentage or a forecast', () => {
    const s = describeProject(bau);
    expect(s).toMatch(/^Ongoing/);
    expect(s).toContain('84/120 items done');
    expect(s).toContain('6.2 SP/wk');
    expect(s).not.toMatch(/% complete/);
    expect(s).not.toMatch(/forecast/i);
    expect(s).not.toMatch(/target/i);
  });

  it('says plainly when throughput cannot be measured', () => {
    expect(describeProject({ ...bau, spPerWeek: null }))
      .toContain('no delivery rate measurable yet');
  });

  it('gets its own section rather than being mixed into On track', () => {
    const html = buildReportHtml({ portfolio: [bau], synopsis: ['x'], meta });
    expect(html).toContain('Ongoing — continuous, no end date');
    expect(html).not.toContain('>On track<');
  });

  // Folding ongoing work into "on track" would overstate how much is under control.
  it('is counted separately in the synopsis and excluded from attention', () => {
    const s = buildSynopsis([
      proj({ project: 'A', health: HEALTH.ON_TRACK }),
      bau,
    ], { now: NOW }).join(' ');
    expect(s).toMatch(/No tracked project is forecast to miss/);
    expect(s).toMatch(/1 ongoing \(continuous, not judged against a date\)/);
  });

  it('states the exemption in the method footnote', () => {
    const html = buildReportHtml({ portfolio: [bau], synopsis: ['x'], meta });
    expect(html).toMatch(/marked ongoing are continuous work/i);
    expect(buildReportText({ portfolio: [bau], synopsis: ['x'], meta }))
      .toMatch(/marked ongoing are continuous work/i);
  });
});
