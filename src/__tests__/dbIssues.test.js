import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const routes = require('../../server/db/routes.js');
const { ISSUE_MERGE, ISSUE_PRUNE, LATEST_ISSUES } = routes.SQL;
const squash = s => s.replace(/\s+/g, ' ');

// SAD_ISSUES holds one row per issue. It used to be keyed on (issue, sprint), so a
// ticket that changed sprint left its old row behind and every database load counted
// it twice. The SQL itself was checked against Oracle with a rolled-back dry run; these
// pin the shape so the sprint cannot creep back into the key.
describe('SAD_ISSUES is one row per issue', () => {
  it('merges on the issue key alone and moves the sprint with the ticket', () => {
    expect(squash(ISSUE_MERGE)).toContain('ON (tgt.ISSUE_KEY = src.ISSUE_KEY)');
    expect(squash(ISSUE_MERGE)).toContain('SPRINT_NAME = src.SPRINT_NAME');
    // a sprint change alone must count as a change, or the row is never moved
    expect(squash(ISSUE_MERGE)).toContain('DECODE(tgt.SPRINT_NAME, src.SPRINT_NAME, 0, 1) = 1');
  });

  it('prunes all but the newest row for an issue before merging', () => {
    expect(squash(ISSUE_PRUNE)).toMatch(/DELETE FROM SAD_ISSUES WHERE ISSUE_KEY = :key AND ID <> \(SELECT MAX\(ID\) KEEP \(DENSE_RANK LAST ORDER BY FETCHED_AT\)/);
  });

  it('reads the newest row per issue', () => {
    expect(squash(LATEST_ISSUES)).toContain('PARTITION BY ISSUE_KEY ORDER BY FETCHED_AT DESC, ID DESC');
    expect(squash(LATEST_ISSUES)).toContain('WHERE RN_ = 1');
  });

  it('sends one bind row per issue, the last one given', () => {
    const rows = routes.toIssueBinds([
      { Key: 'A-1', Sprint: 'Sprint 33', Status: 'To Do' },
      { Key: 'A-1', Sprint: 'Sprint 34', Status: 'In Progress' },
      { Key: 'A-2', Sprint: '', Status: 'Done' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.key === 'A-1')).toMatchObject({ sprint: 'Sprint 34', status: 'In Progress' });
  });
});
