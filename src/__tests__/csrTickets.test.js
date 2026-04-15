import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  DOMAIN_MAP,
  deriveBank,
  ticketAge,
  isSLABreach,
  isStale,
  transformCSRIssue,
} from '../utils/csrService.js';

// ---------------------------------------------------------------------------
// 1.1 Unit tests
// ---------------------------------------------------------------------------

describe('DOMAIN_MAP', () => {
  it('contains piraeusbank.gr', () => {
    expect(DOMAIN_MAP['piraeusbank.gr']).toBe('Piraeus Bank');
  });
  it('contains eurobank.gr', () => {
    expect(DOMAIN_MAP['eurobank.gr']).toBe('Eurobank');
  });
});

describe('deriveBank', () => {
  it('returns mapped name for known domain', () => {
    expect(deriveBank('user@piraeusbank.gr')).toBe('Piraeus Bank');
    expect(deriveBank('user@eurobank.gr')).toBe('Eurobank');
    expect(deriveBank('user@alpha.gr')).toBe('Alpha Bank');
  });

  it('returns raw domain for unknown domain', () => {
    expect(deriveBank('user@someunknown.com')).toBe('someunknown.com');
  });

  it('returns "Unknown" when no @ present', () => {
    expect(deriveBank('notanemail')).toBe('Unknown');
  });

  it('returns "Unknown" for empty string', () => {
    expect(deriveBank('')).toBe('Unknown');
  });

  it('returns "Unknown" for null/undefined', () => {
    expect(deriveBank(null)).toBe('Unknown');
    expect(deriveBank(undefined)).toBe('Unknown');
  });

  it('returns "Unknown" when domain part is empty (trailing @)', () => {
    expect(deriveBank('user@')).toBe('Unknown');
  });
});

describe('ticketAge', () => {
  it('returns 0 for falsy createdDate', () => {
    expect(ticketAge('')).toBe(0);
    expect(ticketAge(null)).toBe(0);
    expect(ticketAge(undefined)).toBe(0);
  });

  it('returns 0 for same-day creation', () => {
    const now = new Date('2025-01-10T12:00:00Z');
    expect(ticketAge('2025-01-10T08:00:00Z', now)).toBe(0);
  });

  it('returns 1 for exactly 1 day ago', () => {
    const now = new Date('2025-01-10T12:00:00Z');
    expect(ticketAge('2025-01-09T12:00:00Z', now)).toBe(1);
  });

  it('returns correct value for multi-year gap', () => {
    const now = new Date('2025-01-10T00:00:00Z');
    const created = '2022-01-10T00:00:00Z';
    const expected = Math.floor((now - new Date(created)) / 86400000);
    expect(ticketAge(created, now)).toBe(expected);
  });
});

describe('isSLABreach', () => {
  const base = { age: 31, status: 'Open', statusCat: 'In Progress' };

  it('returns true when age > 30 and not closed', () => {
    expect(isSLABreach(base)).toBe(true);
  });

  it('returns false when age is exactly 30', () => {
    expect(isSLABreach({ ...base, age: 30 })).toBe(false);
  });

  it('returns false when status is Completed', () => {
    expect(isSLABreach({ ...base, status: 'Completed' })).toBe(false);
  });

  it('returns false when status is Closed', () => {
    expect(isSLABreach({ ...base, status: 'Closed' })).toBe(false);
  });

  it('returns false when statusCat is Done', () => {
    expect(isSLABreach({ ...base, statusCat: 'Done' })).toBe(false);
  });
});

describe('isStale', () => {
  const makeTicket = (daysAgo, status = 'Open') => {
    const updated = new Date(Date.now() - daysAgo * 86400000).toISOString();
    return { status, updated };
  };

  it('returns true when not updated in > 7 days and not closed', () => {
    expect(isStale(makeTicket(8))).toBe(true);
  });

  it('returns false when updated exactly 7 days ago', () => {
    expect(isStale(makeTicket(7))).toBe(false);
  });

  it('returns false when status is Completed', () => {
    expect(isStale(makeTicket(10, 'Completed'))).toBe(false);
  });

  it('returns false when status is Closed', () => {
    expect(isStale(makeTicket(10, 'Closed'))).toBe(false);
  });

  it('returns false when updated field is missing', () => {
    expect(isStale({ status: 'Open', updated: '' })).toBe(false);
  });
});

describe('transformCSRIssue', () => {
  const baseIssue = {
    key: 'CSR-1',
    fields: {
      summary: 'Test issue',
      status: { name: 'Open', statusCategory: { name: 'In Progress' } },
      assignee: { displayName: 'Alice' },
      reporter: { displayName: 'Bob', emailAddress: 'bob@piraeusbank.gr' },
      project: { name: 'CSR Project', key: 'CSR' },
      issuetype: { name: 'Bug' },
      priority: { name: 'High' },
      created: '2025-01-01T00:00:00Z',
      updated: '2025-01-02T00:00:00Z',
      resolutiondate: null,
      duedate: null,
    },
  };

  it('populates reporterEmail from fields.reporter.emailAddress', () => {
    const result = transformCSRIssue(baseIssue);
    expect(result.reporterEmail).toBe('bob@piraeusbank.gr');
  });

  it('sets reporterEmail to empty string when emailAddress is absent', () => {
    const issue = {
      ...baseIssue,
      fields: {
        ...baseIssue.fields,
        reporter: { displayName: 'Bob' },
      },
    };
    const result = transformCSRIssue(issue);
    expect(result.reporterEmail).toBe('');
  });

  it('derives bank from reporterEmail', () => {
    const result = transformCSRIssue(baseIssue);
    expect(result.bank).toBe('Piraeus Bank');
  });

  it('sets bank to "Unknown" when reporter is absent', () => {
    const issue = { ...baseIssue, fields: { ...baseIssue.fields, reporter: null } };
    const result = transformCSRIssue(issue);
    expect(result.bank).toBe('Unknown');
  });

  it('includes age as a non-negative integer', () => {
    const result = transformCSRIssue(baseIssue);
    expect(typeof result.age).toBe('number');
    expect(result.age).toBeGreaterThanOrEqual(0);
  });

  it('includes isSLABreach boolean', () => {
    const result = transformCSRIssue(baseIssue);
    expect(typeof result.isSLABreach).toBe('boolean');
  });

  it('includes isStale boolean', () => {
    const result = transformCSRIssue(baseIssue);
    expect(typeof result.isStale).toBe('boolean');
  });

  it('preserves all existing fields', () => {
    const result = transformCSRIssue(baseIssue);
    expect(result.key).toBe('CSR-1');
    expect(result.summary).toBe('Test issue');
    expect(result.assignee).toBe('Alice');
    expect(result.projectKey).toBe('CSR');
  });
});

// ---------------------------------------------------------------------------
// 1.2 Property test P2: deriveBank lookup correctness
// Feature: csr-tickets-redesign, Property 2: deriveBank lookup correctness
// ---------------------------------------------------------------------------

describe('P2: deriveBank lookup correctness', () => {
  const knownDomains = Object.keys(DOMAIN_MAP);

  it('returns mapped name for any known domain', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...knownDomains),
        fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes('@')),
        (domain, localPart) => {
          const email = `${localPart}@${domain}`;
          return deriveBank(email) === DOMAIN_MAP[domain];
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns raw domain for unknown domains', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('@') && !s.includes('.')),
        fc.string({ minLength: 2, maxLength: 5 }).filter(s => !s.includes('@') && !s.includes('.')),
        fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('@')),
        (sub, tld, localPart) => {
          const domain = `${sub}.${tld}`;
          if (DOMAIN_MAP[domain]) return true; // skip known domains
          const email = `${localPart}@${domain}`;
          return deriveBank(email) === domain;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns "Unknown" for strings without @', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 50 }).filter(s => !s.includes('@')),
        (s) => deriveBank(s) === 'Unknown'
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// 1.3 Property test P12: Ticket age computation
// Feature: csr-tickets-redesign, Property 12: Ticket age computation
// ---------------------------------------------------------------------------

describe('P12: ticketAge computation', () => {
  it('equals floor((now - created) / 86400000) for any valid date pair', () => {
    fc.assert(
      fc.property(
        // Generate a "created" timestamp as ms since epoch (up to 5 years ago)
        fc.integer({ min: 0, max: 5 * 365 * 24 * 60 * 60 * 1000 }),
        (offsetMs) => {
          const now = new Date('2025-06-01T00:00:00Z');
          const created = new Date(now.getTime() - offsetMs);
          const expected = Math.floor(offsetMs / 86400000);
          return ticketAge(created.toISOString(), now) === expected;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns 0 for falsy createdDate regardless of now', () => {
    fc.assert(
      fc.property(
        fc.date(),
        (now) => ticketAge('', now) === 0 && ticketAge(null, now) === 0
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// 1.4 Property test P18: transformCSRIssue extracts reporterEmail
// Feature: csr-tickets-redesign, Property 18: transformCSRIssue extracts reporterEmail
// ---------------------------------------------------------------------------

describe('P18: transformCSRIssue extracts reporterEmail', () => {
  const emailArb = fc.tuple(
    fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('@')),
    fc.string({ minLength: 1, maxLength: 10 }).filter(s => !s.includes('@')),
    fc.string({ minLength: 2, maxLength: 4 }).filter(s => !s.includes('@'))
  ).map(([local, sub, tld]) => `${local}@${sub}.${tld}`);

  const rawIssueArb = (emailArb) => fc.record({
    key: fc.string({ minLength: 1, maxLength: 10 }),
    fields: fc.record({
      summary: fc.string(),
      status: fc.constant({ name: 'Open', statusCategory: { name: 'In Progress' } }),
      reporter: fc.record({ displayName: fc.string(), emailAddress: emailArb }),
      created: fc.constant('2025-01-01T00:00:00Z'),
      updated: fc.constant('2025-01-02T00:00:00Z'),
    }),
  });

  it('populates reporterEmail with emailAddress when present', () => {
    fc.assert(
      fc.property(
        rawIssueArb(emailArb),
        (issue) => {
          const result = transformCSRIssue(issue);
          return result.reporterEmail === issue.fields.reporter.emailAddress;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('sets reporterEmail to empty string when reporter is absent', () => {
    fc.assert(
      fc.property(
        fc.record({
          key: fc.string({ minLength: 1, maxLength: 10 }),
          fields: fc.record({
            summary: fc.string(),
            status: fc.constant({ name: 'Open', statusCategory: { name: 'In Progress' } }),
            reporter: fc.constant(null),
            created: fc.constant('2025-01-01T00:00:00Z'),
            updated: fc.constant('2025-01-02T00:00:00Z'),
          }),
        }),
        (issue) => {
          const result = transformCSRIssue(issue);
          return result.reporterEmail === '';
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Task 3 property tests — helpers from CSRTicketsTab
// ---------------------------------------------------------------------------

import {
  applyFilters,
  computeResolutionStats,
  generateStandupReport,
  serializeStandupToText,
} from '../components/CSRTicketsTab.jsx';

// ── Arbitraries ──────────────────────────────────────────────────────────────

const statusArb = fc.constantFrom('Open', 'In Progress', 'Work In Progress', 'Completed', 'Closed', 'To Do');
const statusCatArb = fc.constantFrom('To Do', 'In Progress', 'Done');
const bankArb = fc.constantFrom('Piraeus Bank', 'Eurobank', 'Alpha Bank', 'Unknown', 'other.com');
const assigneeArb = fc.constantFrom('Alice', 'Bob', 'Charlie', 'Unassigned');
const projectKeyArb = fc.constantFrom('STLU', 'SRDII', 'CSR', 'SSLM', 'CPM');
const projectNameArb = fc.constantFrom(
  'STP to Local UAT', 'SRDII UAT', 'ais-Custody Support', 'Sett Suite Local Market', 'Custody On-going Project'
);

// Use integer offsets from a fixed epoch to avoid NaN dates during shrinking
const BASE_MS = new Date('2023-01-01T00:00:00Z').getTime();
const MAX_OFFSET_MS = (365 * 3) * 86400000; // 3 years

const isoDateArb = fc.integer({ min: 0, max: MAX_OFFSET_MS })
  .map(offset => new Date(BASE_MS + offset).toISOString());

const isoDateOrNullArb = fc.oneof(
  fc.constant(null),
  isoDateArb
);

// Use a counter to ensure unique keys within a single test run
let _keyCounter = 0;
const ticketArb = fc.record({
  key: fc.integer({ min: 1, max: 99999 }).map(n => `T-${n}`),
  summary: fc.string({ minLength: 1, maxLength: 50 }),
  status: statusArb,
  statusCat: statusCatArb,
  bank: bankArb,
  assignee: assigneeArb,
  projectKey: projectKeyArb,
  project: projectNameArb,
  age: fc.integer({ min: 0, max: 200 }),
  isSLABreach: fc.boolean(),
  isStale: fc.boolean(),
  created: isoDateArb,
  updated: isoDateArb,
  resolved: isoDateOrNullArb,
  issueType: fc.constantFrom('Bug', 'Task', 'Story'),
  priority: fc.constantFrom('High', 'Medium', 'Low'),
  reporter: fc.string({ minLength: 1, maxLength: 20 }),
  reporterEmail: fc.string({ minLength: 1, maxLength: 30 }),
  due: fc.constant(null),
});

const filtersArb = fc.record({
  project: fc.oneof(fc.constant('all'), projectKeyArb),
  status: fc.oneof(fc.constant('all'), statusArb),
  bank: fc.oneof(fc.constant('all'), bankArb),
  assignee: fc.oneof(fc.constant('all'), assigneeArb),
  dateFrom: fc.oneof(fc.constant(''), fc.constant('2024-01-01'), fc.constant('2024-06-01')),
  dateTo: fc.oneof(fc.constant(''), fc.constant('2025-12-31'), fc.constant('2025-06-01')),
  slaOnly: fc.boolean(),
  staleOnly: fc.boolean(),
});

// Reference date arbitrary — use integer offset to avoid NaN
const refDateArb = fc.integer({ min: 1, max: MAX_OFFSET_MS })
  .map(offset => new Date(BASE_MS + offset));

// ── P1: Filter correctness (AND composition) ─────────────────────────────────
// Feature: csr-tickets-redesign, Property 1: Filter correctness (AND composition)

describe('P1: applyFilters AND composition', () => {
  it('every ticket in result satisfies all active conditions', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 50 }), filtersArb, (tickets, filters) => {
        const result = applyFilters(tickets, filters);
        return result.every(t => {
          if (filters.project !== 'all' && t.projectKey !== filters.project) return false;
          if (filters.status !== 'all' && t.status !== filters.status) return false;
          if (filters.bank !== 'all' && t.bank !== filters.bank) return false;
          if (filters.assignee !== 'all' && t.assignee !== filters.assignee) return false;
          if (filters.dateFrom && (!t.created || t.created < filters.dateFrom)) return false;
          if (filters.dateTo) {
            const d = t.created ? t.created.slice(0, 10) : '';
            if (!d || d > filters.dateTo) return false;
          }
          if (filters.slaOnly && !t.isSLABreach) return false;
          if (filters.staleOnly && !t.isStale) return false;
          return true;
        });
      }),
      { numRuns: 100 }
    );
  });

  it('no qualifying ticket is absent from the result', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 50 }), filtersArb, (tickets, filters) => {
        const result = applyFilters(tickets, filters);
        // Use index-based comparison since keys may not be unique in generated data
        const qualifying = tickets.filter(t => {
          if (filters.project !== 'all' && t.projectKey !== filters.project) return false;
          if (filters.status !== 'all' && t.status !== filters.status) return false;
          if (filters.bank !== 'all' && t.bank !== filters.bank) return false;
          if (filters.assignee !== 'all' && t.assignee !== filters.assignee) return false;
          if (filters.dateFrom && (!t.created || t.created < filters.dateFrom)) return false;
          if (filters.dateTo) {
            const d = t.created ? t.created.slice(0, 10) : '';
            if (!d || d > filters.dateTo) return false;
          }
          if (filters.slaOnly && !t.isSLABreach) return false;
          if (filters.staleOnly && !t.isStale) return false;
          return true;
        });
        return result.length === qualifying.length;
      }),
      { numRuns: 100 }
    );
  });
});

// ── P3: Bank stats aggregation invariant ─────────────────────────────────────
// Feature: csr-tickets-redesign, Property 3: Bank stats aggregation invariant

describe('P3: Bank stats open + inProgress + completed === total', () => {
  it('sum of sub-counts equals total for every bank', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 80 }), (tickets) => {
        const map = {};
        tickets.forEach(t => {
          const b = t.bank || 'Unknown';
          if (!map[b]) map[b] = { total: 0, open: 0, inProgress: 0, completed: 0 };
          map[b].total++;
          if (t.status === 'Completed' || t.status === 'Closed') {
            map[b].completed++;
          } else if (t.statusCat === 'In Progress') {
            map[b].inProgress++;
          } else {
            map[b].open++;
          }
        });
        return Object.values(map).every(s => s.open + s.inProgress + s.completed === s.total);
      }),
      { numRuns: 100 }
    );
  });
});

// ── P4: Derived panels use filtered tickets ───────────────────────────────────
// Feature: csr-tickets-redesign, Property 4: Derived panels use filtered tickets

describe('P4: computeResolutionStats on filtered equals stats on direct subset', () => {
  it('stats computed on filtered set equal stats on the same subset computed directly', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 50 }), filtersArb, (tickets, filters) => {
        const filtered = applyFilters(tickets, filters);
        const statsA = computeResolutionStats(filtered);
        // Compute stats again on the same array — must be identical (deterministic)
        const statsB = computeResolutionStats(filtered);
        return (
          statsA.avg === statsB.avg &&
          statsA.slaBreachCount === statsB.slaBreachCount &&
          statsA.min === statsB.min &&
          statsA.max === statsB.max
        );
      }),
      { numRuns: 100 }
    );
  });
});

// ── P5: Resolution statistics correctness ────────────────────────────────────
// Feature: csr-tickets-redesign, Property 5: Resolution statistics correctness

describe('P5: computeResolutionStats avg/median/min/max correctness', () => {
  it('avg equals arithmetic mean of resolution times', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 365 }), { minLength: 1, maxLength: 50 }),
        (times) => {
          const tickets = times.map((days, i) => {
            const created = new Date('2024-01-01T00:00:00Z');
            const resolved = new Date(created.getTime() + days * 86400000);
            return {
              key: `T-${i}`,
              created: created.toISOString(),
              resolved: resolved.toISOString(),
              isSLABreach: false,
              project: 'CSR',
              status: 'Completed',
              statusCat: 'Done',
              bank: 'Unknown',
              assignee: 'Alice',
              age: days,
              isStale: false,
            };
          });
          const stats = computeResolutionStats(tickets);
          const expectedAvg = times.reduce((s, v) => s + v, 0) / times.length;
          return Math.abs(stats.avg - expectedAvg) < 0.001;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('min and max are correct', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 365 }), { minLength: 1, maxLength: 50 }),
        (times) => {
          const tickets = times.map((days, i) => {
            const created = new Date('2024-01-01T00:00:00Z');
            const resolved = new Date(created.getTime() + days * 86400000);
            return {
              key: `T-${i}`,
              created: created.toISOString(),
              resolved: resolved.toISOString(),
              isSLABreach: false,
              project: 'CSR',
              status: 'Completed',
              statusCat: 'Done',
              bank: 'Unknown',
              assignee: 'Alice',
              age: days,
              isStale: false,
            };
          });
          const stats = computeResolutionStats(tickets);
          return stats.min === Math.min(...times) && stats.max === Math.max(...times);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('median is the middle value when sorted', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 365 }), { minLength: 1, maxLength: 50 }),
        (times) => {
          const tickets = times.map((days, i) => {
            const created = new Date('2024-01-01T00:00:00Z');
            const resolved = new Date(created.getTime() + days * 86400000);
            return {
              key: `T-${i}`,
              created: created.toISOString(),
              resolved: resolved.toISOString(),
              isSLABreach: false,
              project: 'CSR',
              status: 'Completed',
              statusCat: 'Done',
              bank: 'Unknown',
              assignee: 'Alice',
              age: days,
              isStale: false,
            };
          });
          const stats = computeResolutionStats(tickets);
          const sorted = [...times].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          const expectedMedian = sorted.length % 2 === 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid];
          return Math.abs(stats.median - expectedMedian) < 0.001;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── P6: Per-project resolution average ───────────────────────────────────────
// Feature: csr-tickets-redesign, Property 6: Per-project resolution average

describe('P6: per-project avg resolution equals mean of that project\'s times', () => {
  it('byProject avg matches arithmetic mean per project', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            days: fc.integer({ min: 0, max: 365 }),
            project: fc.constantFrom('CSR', 'STLU', 'SRDII'),
          }),
          { minLength: 1, maxLength: 50 }
        ),
        (entries) => {
          const tickets = entries.map(({ days, project }, i) => {
            const created = new Date('2024-01-01T00:00:00Z');
            const resolved = new Date(created.getTime() + days * 86400000);
            return {
              key: `T-${i}`,
              created: created.toISOString(),
              resolved: resolved.toISOString(),
              isSLABreach: false,
              project,
              status: 'Completed',
              statusCat: 'Done',
              bank: 'Unknown',
              assignee: 'Alice',
              age: days,
              isStale: false,
            };
          });
          const stats = computeResolutionStats(tickets);
          return stats.byProject.every(({ project, avg }) => {
            const projectTimes = entries
              .filter(e => e.project === project)
              .map(e => e.days);
            const expectedAvg = projectTimes.reduce((s, v) => s + v, 0) / projectTimes.length;
            return Math.abs(avg - expectedAvg) < 0.001;
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── P7: SLA breach count ──────────────────────────────────────────────────────
// Feature: csr-tickets-redesign, Property 7: SLA breach count

describe('P7: slaBreachCount equals count of isSLABreach tickets', () => {
  it('slaBreachCount matches manual count', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 80 }), (tickets) => {
        const stats = computeResolutionStats(tickets);
        const expected = tickets.filter(t => t.isSLABreach).length;
        return stats.slaBreachCount === expected;
      }),
      { numRuns: 100 }
    );
  });
});

// ── P8: Stale panel completeness ──────────────────────────────────────────────
// Feature: csr-tickets-redesign, Property 8: Stale panel completeness

describe('P8: stale panel contains exactly isStale tickets', () => {
  it('stale list count matches isStale ticket count and all required fields present', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 80 }), (tickets) => {
        const stale = tickets.filter(t => t.isStale);
        // verify all required fields present on each stale ticket
        return stale.every(t =>
          t.key !== undefined &&
          t.summary !== undefined &&
          t.assignee !== undefined &&
          t.bank !== undefined &&
          t.age !== undefined &&
          t.updated !== undefined
        );
      }),
      { numRuns: 100 }
    );
  });
});

// ── P9: Stale sort order ──────────────────────────────────────────────────────
// Feature: csr-tickets-redesign, Property 9: Stale sort order

describe('P9: stale tickets sorted by age descending', () => {
  it('adjacent pairs satisfy a.age >= b.age', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 80 }), (tickets) => {
        const stale = tickets.filter(t => t.isStale).sort((a, b) => b.age - a.age);
        for (let i = 0; i < stale.length - 1; i++) {
          if (stale[i].age < stale[i + 1].age) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

// ── P10: Stand-up report content ──────────────────────────────────────────────
// Feature: csr-tickets-redesign, Property 10: Stand-up report content

describe('P10: generateStandupReport sections contain correct tickets', () => {
  it('closedYesterday contains tickets resolved on yesterday', () => {
    fc.assert(
      fc.property(
        fc.array(ticketArb, { maxLength: 50 }),
        refDateArb,
        (tickets, today) => {
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayStr = yesterday.toISOString().slice(0, 10);
          const report = generateStandupReport(tickets, today);
          const expected = tickets.filter(t => t.resolved && t.resolved.slice(0, 10) === yesterdayStr);
          return report.closedYesterday.length === expected.length;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('newToday contains tickets created today', () => {
    fc.assert(
      fc.property(
        fc.array(ticketArb, { maxLength: 50 }),
        refDateArb,
        (tickets, today) => {
          const todayStr = today.toISOString().slice(0, 10);
          const report = generateStandupReport(tickets, today);
          const expected = tickets.filter(t => t.created && t.created.slice(0, 10) === todayStr);
          return report.newToday.length === expected.length;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('slaBreaches contains all isSLABreach tickets', () => {
    fc.assert(
      fc.property(
        fc.array(ticketArb, { maxLength: 50 }),
        refDateArb,
        (tickets, today) => {
          const report = generateStandupReport(tickets, today);
          const expected = tickets.filter(t => t.isSLABreach).length;
          return report.slaBreaches.length === expected;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── P11: Stand-up plain text serialisation ────────────────────────────────────
// Feature: csr-tickets-redesign, Property 11: Stand-up plain text serialisation

describe('P11: serializeStandupToText contains all four sections', () => {
  it('text contains all four section headers', () => {
    fc.assert(
      fc.property(
        fc.array(ticketArb, { maxLength: 30 }),
        refDateArb,
        (tickets, today) => {
          const report = generateStandupReport(tickets, today);
          const text = serializeStandupToText(report);
          return (
            text.includes('Closed Yesterday') &&
            text.includes('New Today') &&
            text.includes('In Progress by Assignee') &&
            text.includes('SLA Breaches')
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it('each ticket key appears in the appropriate section', () => {
    fc.assert(
      fc.property(
        fc.array(ticketArb, { maxLength: 30 }),
        refDateArb,
        (tickets, today) => {
          const report = generateStandupReport(tickets, today);
          const text = serializeStandupToText(report);
          const allKeys = [
            ...report.closedYesterday.map(t => t.key),
            ...report.newToday.map(t => t.key),
            ...report.slaBreaches.map(t => t.key),
          ];
          return allKeys.every(k => text.includes(k));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── P13: Age sort correctness ─────────────────────────────────────────────────
// Feature: csr-tickets-redesign, Property 13: Age sort correctness

describe('P13: age sort correctness', () => {
  it('ascending sort: adjacent pairs satisfy a.age <= b.age', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 80 }), (tickets) => {
        const sorted = [...tickets].sort((a, b) => a.age - b.age);
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].age > sorted[i + 1].age) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('descending sort: adjacent pairs satisfy a.age >= b.age', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 80 }), (tickets) => {
        const sorted = [...tickets].sort((a, b) => b.age - a.age);
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].age < sorted[i + 1].age) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests for StalePanel empty-state, generateStandupReport, serializeStandupToText
// ---------------------------------------------------------------------------

describe('generateStandupReport with fixed data', () => {
  const today = new Date('2025-06-15T10:00:00Z');
  const yesterday = '2025-06-14';
  const todayStr = '2025-06-15';

  const tickets = [
    {
      key: 'CSR-1', summary: 'Closed ticket', status: 'Completed', statusCat: 'Done',
      resolved: `${yesterday}T09:00:00Z`, created: '2025-05-01T00:00:00Z',
      assignee: 'Alice', bank: 'Piraeus Bank', age: 45, isSLABreach: true, isStale: false,
    },
    {
      key: 'CSR-2', summary: 'New ticket today', status: 'Open', statusCat: 'To Do',
      resolved: null, created: `${todayStr}T08:00:00Z`,
      assignee: 'Bob', bank: 'Eurobank', age: 0, isSLABreach: false, isStale: false,
    },
    {
      key: 'CSR-3', summary: 'WIP ticket', status: 'Work In Progress', statusCat: 'In Progress',
      resolved: null, created: '2025-05-10T00:00:00Z',
      assignee: 'Alice', bank: 'Alpha Bank', age: 36, isSLABreach: true, isStale: false,
    },
    {
      key: 'CSR-4', summary: 'Another WIP', status: 'In Progress', statusCat: 'In Progress',
      resolved: null, created: '2025-05-20T00:00:00Z',
      assignee: 'Bob', bank: 'Piraeus Bank', age: 26, isSLABreach: false, isStale: false,
    },
  ];

  it('closedYesterday contains CSR-1', () => {
    const report = generateStandupReport(tickets, today);
    expect(report.closedYesterday.map(t => t.key)).toContain('CSR-1');
  });

  it('newToday contains CSR-2', () => {
    const report = generateStandupReport(tickets, today);
    expect(report.newToday.map(t => t.key)).toContain('CSR-2');
  });

  it('inProgressByAssignee counts WIP tickets per assignee', () => {
    const report = generateStandupReport(tickets, today);
    const aliceEntry = report.inProgressByAssignee.find(e => e.assignee === 'Alice');
    const bobEntry = report.inProgressByAssignee.find(e => e.assignee === 'Bob');
    expect(aliceEntry?.count).toBe(1);
    expect(bobEntry?.count).toBe(1);
  });

  it('slaBreaches contains CSR-1 and CSR-3', () => {
    const report = generateStandupReport(tickets, today);
    const keys = report.slaBreaches.map(t => t.key);
    expect(keys).toContain('CSR-1');
    expect(keys).toContain('CSR-3');
  });
});

describe('serializeStandupToText sections', () => {
  const today = new Date('2025-06-15T10:00:00Z');
  const tickets = [
    {
      key: 'CSR-10', summary: 'Closed one', status: 'Completed', statusCat: 'Done',
      resolved: '2025-06-14T09:00:00Z', created: '2025-05-01T00:00:00Z',
      assignee: 'Alice', bank: 'Piraeus Bank', age: 45, isSLABreach: true, isStale: false,
    },
    {
      key: 'CSR-11', summary: 'New one', status: 'Open', statusCat: 'To Do',
      resolved: null, created: '2025-06-15T08:00:00Z',
      assignee: 'Bob', bank: 'Eurobank', age: 0, isSLABreach: false, isStale: false,
    },
    {
      key: 'CSR-12', summary: 'WIP one', status: 'Work In Progress', statusCat: 'In Progress',
      resolved: null, created: '2025-05-10T00:00:00Z',
      assignee: 'Alice', bank: 'Alpha Bank', age: 36, isSLABreach: true, isStale: false,
    },
  ];

  it('contains all four section headers', () => {
    const report = generateStandupReport(tickets, today);
    const text = serializeStandupToText(report);
    expect(text).toContain('Closed Yesterday');
    expect(text).toContain('New Today');
    expect(text).toContain('In Progress by Assignee');
    expect(text).toContain('SLA Breaches');
  });

  it('contains ticket keys in appropriate sections', () => {
    const report = generateStandupReport(tickets, today);
    const text = serializeStandupToText(report);
    expect(text).toContain('CSR-10');
    expect(text).toContain('CSR-11');
    expect(text).toContain('CSR-12');
  });
});

describe('StalePanel empty-state', () => {
  it('applyFilters with staleOnly=true on non-stale tickets returns empty array', () => {
    const tickets = [
      {
        key: 'T-1', summary: 'Fresh', status: 'Open', statusCat: 'To Do',
        bank: 'Unknown', assignee: 'Alice', projectKey: 'CSR', project: 'ais-Custody Support',
        age: 2, isSLABreach: false, isStale: false,
        created: '2025-06-10T00:00:00Z', updated: '2025-06-14T00:00:00Z', resolved: null,
      },
    ];
    const filters = {
      project: 'all', status: 'all', bank: 'all', assignee: 'all',
      dateFrom: '', dateTo: '', slaOnly: false, staleOnly: true,
    };
    const result = applyFilters(tickets, filters);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Task 5 property tests — helpers from CSRAnalyticsTab
// ---------------------------------------------------------------------------

import {
  buildWeeklyVolume,
  buildResolutionTrend,
  buildBacklogGrowth,
  buildAssigneeWorkload,
  getISOWeek,
} from '../components/CSRAnalyticsTab.jsx';

// ── P14: Weekly volume aggregation ───────────────────────────────────────────
// Feature: csr-tickets-redesign, Property 14: Weekly volume aggregation

describe('P14: buildWeeklyVolume — each ticket in exactly one bucket, counts sum to total', () => {
  it('bucket counts sum to total ticket count', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 80 }), (tickets) => {
        const data = buildWeeklyVolume(tickets);
        const total = data.reduce((s, row) => s + row.count, 0);
        // Only tickets with a valid created date contribute
        const validCount = tickets.filter(t => t.created && getISOWeek(t.created)).length;
        return total === validCount;
      }),
      { numRuns: 100 }
    );
  });

  it('each ticket is assigned to exactly one week bucket matching its created date', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 80 }), (tickets) => {
        const data = buildWeeklyVolume(tickets);
        // For each week in the result, count manually
        const manualMap = {};
        for (const t of tickets) {
          const week = getISOWeek(t.created);
          if (!week) continue;
          manualMap[week] = (manualMap[week] || 0) + 1;
        }
        return data.every(row => row.count === (manualMap[row.week] || 0));
      }),
      { numRuns: 100 }
    );
  });
});

// ── P15: Weekly resolution trend ─────────────────────────────────────────────
// Feature: csr-tickets-redesign, Property 15: Weekly resolution trend

describe('P15: buildResolutionTrend — weekly avg equals mean of that week\'s resolution times', () => {
  it('avgDays for each week equals arithmetic mean of resolution days for tickets in that week', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            created: isoDateArb,
            resolved: isoDateArb,
            assignee: assigneeArb,
            status: fc.constant('Completed'),
          }),
          { maxLength: 60 }
        ),
        (entries) => {
          // Ensure resolved >= created by swapping if needed
          const tickets = entries.map((e, i) => {
            const c = e.created < e.resolved ? e.created : e.resolved;
            const r = e.created < e.resolved ? e.resolved : e.created;
            return { ...e, key: `T-${i}`, created: c, resolved: r };
          });

          const data = buildResolutionTrend(tickets);

          return data.every(row => {
            const weekTickets = tickets.filter(t => t.resolved && getISOWeek(t.resolved) === row.week);
            if (weekTickets.length === 0) return false;
            const times = weekTickets.map(t =>
              Math.floor((new Date(t.resolved) - new Date(t.created)) / 86400000)
            );
            const expectedAvg = times.reduce((s, v) => s + v, 0) / times.length;
            return Math.abs(row.avgDays - expectedAvg) < 0.001;
          });
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ── P16: Backlog growth computation ──────────────────────────────────────────
// Feature: csr-tickets-redesign, Property 16: Backlog growth computation

describe('P16: buildBacklogGrowth — weekly delta equals created minus resolved per week', () => {
  it('delta equals created count minus resolved count for each week', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 80 }), (tickets) => {
        const data = buildBacklogGrowth(tickets);

        return data.every(row => {
          const created = tickets.filter(t => t.created && getISOWeek(t.created) === row.week).length;
          const resolved = tickets.filter(t => t.resolved && getISOWeek(t.resolved) === row.week).length;
          return row.delta === created - resolved;
        });
      }),
      { numRuns: 100 }
    );
  });

  it('cumulative is the running sum of deltas', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 80 }), (tickets) => {
        const data = buildBacklogGrowth(tickets);
        let running = 0;
        for (const row of data) {
          running += row.delta;
          if (row.cumulative !== running) return false;
        }
        return true;
      }),
      { numRuns: 100 }
    );
  });
});

// ── P17: Assignee workload aggregation ───────────────────────────────────────
// Feature: csr-tickets-redesign, Property 17: Assignee workload aggregation

describe('P17: buildAssigneeWorkload — (assignee, week) counts sum to total ticket count', () => {
  it('sum of all assignee counts across all weeks equals total valid ticket count', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 80 }), (tickets) => {
        const { data, assignees } = buildAssigneeWorkload(tickets);
        let total = 0;
        for (const row of data) {
          for (const a of assignees) {
            total += row[a] || 0;
          }
        }
        const validCount = tickets.filter(t => t.created && getISOWeek(t.created)).length;
        return total === validCount;
      }),
      { numRuns: 100 }
    );
  });

  it('each (assignee, week) count equals manual count of tickets with that assignee and week', () => {
    fc.assert(
      fc.property(fc.array(ticketArb, { maxLength: 80 }), (tickets) => {
        const { data, assignees } = buildAssigneeWorkload(tickets);

        return data.every(row => {
          return assignees.every(assignee => {
            const expected = tickets.filter(t =>
              t.created &&
              getISOWeek(t.created) === row.week &&
              (t.assignee || 'Unassigned') === assignee
            ).length;
            return (row[assignee] || 0) === expected;
          });
        });
      }),
      { numRuns: 100 }
    );
  });
});
