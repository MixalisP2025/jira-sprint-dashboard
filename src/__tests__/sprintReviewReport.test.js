import { describe, it, expect } from 'vitest';
import { buildManagementSynopsis, buildManagementHtml, buildManagementText } from '../utils/sprintReviewReport';

const ledger = {
  sprint: 'Sprint 34 28-09-26 to 09-10-26', start: new Date('2026-09-28T00:00:00Z'), end: new Date('2026-10-09T23:59:59Z'),
  sp: 107.5, items: 163, doneSP: 14.8, doneItems: 22, deliveredPct: 13.8, awaitingSP: 34.3, awaitingItems: 61,
};
const comparison = { sprints: [
  { sprint: 'Sprint 31 17-08-26 to 28-08-26', committedSP: 115.7, doneSP: 58, deliveredPct: 50, carryInPct: 52, addedAfterStart: 73, medianCycle: 4.5 },
  { sprint: 'Sprint 32 31-08-26 to 11-09-27', committedSP: 133.4, doneSP: 82.1, deliveredPct: 62, carryInPct: 33, addedAfterStart: 119, medianCycle: 4 },
  { sprint: 'Sprint 33 14-09-26 to 25-09-26', committedSP: 138.1, doneSP: 100.9, deliveredPct: 73, carryInPct: 37, addedAfterStart: 129, medianCycle: 4 },
  { sprint: 'Sprint 34 28-09-26 to 09-10-26', committedSP: 107.5, doneSP: 14.8, deliveredPct: 13.8, carryInPct: 37, addedAfterStart: 50, medianCycle: 0 },
] };
const behind = [{ project: 'CS00451 - Crypto Currencies', owner: 'Nikoletta Kopana', health: 'off-track', forecastDate: '2027-02-07', varianceWeeks: 29, percentComplete: 69, completedSP: 89.1, totalSP: 129.3, spPerWeek: 2.3, sprintsUsed: 4, targetDate: '2026-07-21' }];
const stale = [{ key: 'TRFCSPRM-714', summary: 'Detail Addition', status: 'Awaiting Testing', assignee: 'Nikoletta Kopana', days: 171 }];
const carried = [{ key: 'TRFCSPRM-712', summary: 'WEB UI - Phase 4', status: 'Awaiting Testing', sprintsBefore: 18 }];
const pace = { verdict: 'behind', elapsed: 60 };
const input = { ledger, pace, comparison, behind, stale, carried, tips: [{ severity: 'adverse', title: 'Work is queuing for testing', detail: '31% of open SP is waiting.' }] };

describe('management synopsis', () => {
  const s = buildManagementSynopsis(input);
  it('leads with where the sprint stands and the verdict', () => {
    expect(s[0]).toMatch(/^S34 is 60% of the way through its working days and 14% of the 107.5 SP committed is done/);
    expect(s[0]).toMatch(/will not complete its commitment/);
  });
  it('reads the trend from completed sprints only, leaving out the running one', () => {
    expect(s[1]).toMatch(/last 3 completed sprints, delivery of committed work has improved from 50% in S31 to 73% in S33/);
  });
  it('names projects past target with their forecast', () => {
    expect(s[2]).toMatch(/CS00451 - Crypto Currencies \(off track, forecast 07 Feb 2027, 29 weeks late\)/);
  });
  it('asks for decisions on stuck and long-slipping work', () => {
    expect(s[3]).toMatch(/1 open item has sat in the same status/);
    expect(s[3]).toMatch(/1 item has been carried through 3 or more sprints/);
  });
});

describe('management html / text', () => {
  const synopsis = buildManagementSynopsis(input);
  const meta = { scopeLabel: 'All projects', generatedAt: '06 Oct 2026, 14:40' };
  const html = buildManagementHtml({ ...input, synopsis, meta });
  const text = buildManagementText({ ...input, synopsis, meta });
  it('carries the figures and marks the running sprint', () => {
    expect(html).toContain('Sprint Summary · S34');
    expect(html).toContain('S34 <span style="color:#64748b">(in progress)</span>');
    expect(text).toContain('S33: 138.1 / 100.9 / 73% / 37% / 129 / 4');
  });
  it('names the project owner but no one attached to a ticket', () => {
    // the owner appears with their project; the stuck ticket's assignee must not appear in the ticket table
    const ticketTable = html.slice(html.indexOf('Stuck 10+'));
    expect(ticketTable).toContain('TRFCSPRM-714');
    expect(ticketTable).not.toContain('Nikoletta');
    expect(text.slice(text.indexOf('STUCK'))).not.toContain('Nikoletta');
  });
  it('escapes ticket text', () => {
    const h = buildManagementHtml({ ...input, stale: [{ ...stale[0], summary: '<script>x</script>' }], synopsis, meta });
    expect(h).not.toContain('<script>');
  });
});
