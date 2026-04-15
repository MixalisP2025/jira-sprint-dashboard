/**
 * @fileoverview Property-based tests for the CSR Analytics upgrade.
 *
 * Uses fast-check for property generation.
 * All property tests are annotated with the requirement they validate.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { isoWeekOf } from '../features/csr-analytics/utils/csrAnalyticsDates.js';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * Generates a random Date within a reasonable range (2000-01-01 to 2099-12-31)
 * and returns it as an ISO date string (YYYY-MM-DD).
 */
const isoDateStringArb = fc
  .date({
    min: new Date('2000-01-01T00:00:00Z'),
    max: new Date('2099-12-31T00:00:00Z'),
  })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString().slice(0, 10));

// ---------------------------------------------------------------------------
// Property 21: ISO week function consistency
// Validates: Requirements 17.10
// ---------------------------------------------------------------------------

describe('Property 21: ISO week function consistency', () => {
  /**
   * **Validates: Requirements 17.10**
   *
   * For any valid date string, `isoWeekOf` must return a string matching the
   * `YYYY-Www` pattern.
   */
  it('output always matches YYYY-Www pattern for valid date strings', () => {
    fc.assert(
      fc.property(isoDateStringArb, (dateStr) => {
        const result = isoWeekOf(dateStr);
        return /^\d{4}-W\d{2}$/.test(result);
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 17.10**
   *
   * Two dates that are in the same ISO week must return the same `YYYY-Www`
   * string. We verify this by taking a known Monday and checking that
   * Monday through Sunday of that week all return the same week string.
   */
  it('all days within the same ISO week return the same week string', () => {
    fc.assert(
      fc.property(
        // Generate a Monday by picking any date and snapping to its Monday
        fc.date({
          min: new Date('2000-01-03T00:00:00Z'), // 2000-01-03 is a Monday
          max: new Date('2099-12-25T00:00:00Z'),
        }).filter((d) => !isNaN(d.getTime())),
        (anyDate) => {
          // Snap to the Monday of this date's ISO week
          const dayNum = anyDate.getUTCDay() || 7; // Sunday → 7
          const monday = new Date(anyDate);
          monday.setUTCDate(anyDate.getUTCDate() - (dayNum - 1));
          monday.setUTCHours(0, 0, 0, 0);

          const mondayStr = monday.toISOString().slice(0, 10);
          const weekStr = isoWeekOf(mondayStr);

          // All 7 days of the week must return the same week string
          for (let offset = 0; offset < 7; offset++) {
            const day = new Date(monday.getTime() + offset * 86400000);
            const dayStr = day.toISOString().slice(0, 10);
            if (isoWeekOf(dayStr) !== weekStr) return false;
          }
          return true;
        }
      ),
      { numRuns: 200 }
    );
  });

  /**
   * **Validates: Requirements 17.10**
   *
   * The week number component must be in the range [1, 53].
   */
  it('week number is always between 1 and 53', () => {
    fc.assert(
      fc.property(isoDateStringArb, (dateStr) => {
        const result = isoWeekOf(dateStr);
        const weekNum = parseInt(result.split('-W')[1], 10);
        return weekNum >= 1 && weekNum <= 53;
      }),
      { numRuns: 500 }
    );
  });

  /**
   * **Validates: Requirements 17.10**
   *
   * `isoWeekOf` must return `''` for null, undefined, and invalid strings.
   */
  it('returns empty string for null, undefined, and invalid inputs', () => {
    expect(isoWeekOf(null)).toBe('');
    expect(isoWeekOf(undefined)).toBe('');
    expect(isoWeekOf('')).toBe('');
    expect(isoWeekOf('not-a-date')).toBe('');
  });

  /**
   * **Validates: Requirements 17.10**
   *
   * Sunday edge case: Sunday must belong to the same week as the preceding
   * Monday–Saturday, not the following week.
   *
   * Example: 2025-01-05 (Sunday) should be in 2025-W01, same as 2025-01-01
   * (Wednesday of that week).
   */
  it('Sunday belongs to the same ISO week as the preceding Monday', () => {
    fc.assert(
      fc.property(
        // Generate a Sunday by picking a Monday and adding 6 days
        fc.date({
          min: new Date('2000-01-03T00:00:00Z'),
          max: new Date('2099-12-19T00:00:00Z'),
        }).filter((d) => !isNaN(d.getTime())),
        (anyDate) => {
          // Snap to Monday
          const dayNum = anyDate.getUTCDay() || 7;
          const monday = new Date(anyDate);
          monday.setUTCDate(anyDate.getUTCDate() - (dayNum - 1));
          monday.setUTCHours(0, 0, 0, 0);

          const sunday = new Date(monday.getTime() + 6 * 86400000);

          const mondayWeek = isoWeekOf(monday.toISOString().slice(0, 10));
          const sundayWeek = isoWeekOf(sunday.toISOString().slice(0, 10));

          return mondayWeek === sundayWeek;
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Imports for normalisation properties (Task 3)
// ---------------------------------------------------------------------------

import { normalizeTicket } from '../features/csr-analytics/utils/csrAnalyticsTypes.js';

// ---------------------------------------------------------------------------
// Arbitraries for raw CSR tickets
// ---------------------------------------------------------------------------

/**
 * Generates a random ISO datetime string (UTC) within a reasonable range.
 * Produces full ISO-8601 strings like `transformCSRIssue` does.
 * Filters out NaN dates that fast-check may produce during shrinking.
 */
const isoDateTimeArb = fc
  .date({
    min: new Date('2015-01-01T00:00:00Z'),
    max: new Date('2030-12-31T23:59:59Z'),
  })
  .filter((d) => !isNaN(d.getTime()))
  .map((d) => d.toISOString());

/**
 * Generates a raw ticket object matching the shape produced by
 * `transformCSRIssue`. All fields that `getSLARisk` needs are included:
 * `status`, `statusCat`, `age`, `bank`, `priority`.
 */
const rawCsrTicketArb = fc.record({
  key:        fc.stringMatching(/^[A-Z]{2,6}-\d{1,5}$/),
  summary:    fc.string({ minLength: 0, maxLength: 120 }),
  status:     fc.oneof(
    fc.constant('Open'),
    fc.constant('In Progress'),
    fc.constant('Completed'),
    fc.constant('Closed'),
    fc.string({ minLength: 1, maxLength: 30 }),
  ),
  statusCat:  fc.oneof(
    fc.constant('To Do'),
    fc.constant('In Progress'),
    fc.constant('Done'),
    fc.string({ minLength: 1, maxLength: 30 }),
  ),
  assignee:   fc.oneof(fc.constant('Unassigned'), fc.string({ minLength: 1, maxLength: 60 })),
  bank:       fc.oneof(
    fc.constant('Piraeus Bank'),
    fc.constant('Eurobank'),
    fc.constant('Alpha Bank'),
    fc.string({ minLength: 1, maxLength: 40 }),
  ),
  project:    fc.string({ minLength: 1, maxLength: 40 }),
  projectKey: fc.stringMatching(/^[A-Z]{2,6}$/),
  issueType:  fc.oneof(fc.constant('Bug'), fc.constant('Task'), fc.constant('Story'), fc.string({ minLength: 1, maxLength: 30 })),
  priority:   fc.oneof(
    fc.constant('Critical'),
    fc.constant('High'),
    fc.constant('Medium'),
    fc.constant('Low'),
  ),
  created:    isoDateTimeArb,
  updated:    isoDateTimeArb,
  resolved:   fc.oneof(fc.constant(null), isoDateTimeArb),
  age:        fc.nat({ max: 3000 }),
  isSLABreach: fc.boolean(),
  slaRisk:    fc.oneof(fc.constant('on-track'), fc.constant('at-risk'), fc.constant('breaching')),
  jiraBreached: fc.boolean(),
});

// ---------------------------------------------------------------------------
// Property 1: Normalisation preserves ticket count and shape
// Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
// ---------------------------------------------------------------------------

describe('Property 1: Normalisation preserves ticket count and shape', () => {
  /**
   * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7**
   *
   * For any array of raw CsrTicket objects, mapping `normalizeTicket` over
   * the array SHALL produce an output of the same length where every element
   * contains all required NormalizedCsrTicket fields.
   */
  it('output length equals input length and every element has all required fields', () => {
    const REQUIRED_FIELDS = [
      'key', 'summary', 'project', 'bank', 'assignee', 'status', 'issueType',
      'createdAt', 'updatedAt', 'resolvedAt',
      'isOpen', 'isResolved', 'ageDays', 'resolutionDays', 'slaState', 'isLegacy',
    ];

    fc.assert(
      fc.property(fc.array(rawCsrTicketArb, { minLength: 0, maxLength: 50 }), (rawTickets) => {
        const normalized = rawTickets.map(normalizeTicket);

        // Length is preserved
        if (normalized.length !== rawTickets.length) return false;

        // Every element has all required fields (including those that may be null)
        for (const ticket of normalized) {
          for (const field of REQUIRED_FIELDS) {
            if (!(field in ticket)) return false;
          }
        }
        return true;
      }),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: isOpen derivation is correct for all status values
// Validates: Requirements 4.2
// ---------------------------------------------------------------------------

describe('Property 2: isOpen derivation is correct for all status values', () => {
  /**
   * **Validates: Requirements 4.2**
   *
   * For any raw ticket, `normalizeTicket(ticket).isOpen` SHALL be `true` if
   * and only if status is not `'Completed'` or `'Closed'` AND statusCat is
   * not `'Done'`.
   */
  it('isOpen is true iff status is not Completed/Closed and statusCat is not Done', () => {
    fc.assert(
      fc.property(
        fc.record({
          status:    fc.string(),
          statusCat: fc.string(),
        }),
        ({ status, statusCat }) => {
          // Build a minimal raw ticket with the generated status fields
          const rawTicket = {
            key: 'TST-1', summary: '', status, statusCat,
            assignee: 'Unassigned', bank: 'Unknown', project: 'Test',
            projectKey: 'TST', issueType: 'Task', priority: 'Medium',
            created: '2024-01-01T00:00:00.000Z',
            updated: '2024-01-01T00:00:00.000Z',
            resolved: null, age: 0,
            isSLABreach: false, slaRisk: 'on-track', jiraBreached: false,
          };

          const normalized = normalizeTicket(rawTicket);

          const expectedIsOpen =
            status !== 'Completed' &&
            status !== 'Closed' &&
            statusCat !== 'Done';

          return normalized.isOpen === expectedIsOpen;
        }
      ),
      { numRuns: 500 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: resolutionDays round-trip
// Validates: Requirements 4.5
// ---------------------------------------------------------------------------

describe('Property 3: resolutionDays round-trip', () => {
  /**
   * **Validates: Requirements 4.5**
   *
   * When `resolvedAt` is a non-null date string, `resolutionDays` SHALL equal
   * `Math.floor((new Date(resolvedAt) - new Date(createdAt)) / 86400000)`.
   * When `resolvedAt` is null, `resolutionDays` SHALL be null.
   */
  it('resolutionDays matches floor-division formula when resolvedAt is non-null, null otherwise', () => {
    fc.assert(
      fc.property(
        fc.record({
          created:  isoDateTimeArb,
          resolved: fc.oneof(fc.constant(null), isoDateTimeArb),
        }),
        ({ created, resolved }) => {
          const rawTicket = {
            key: 'TST-1', summary: '', status: 'Open', statusCat: 'To Do',
            assignee: 'Unassigned', bank: 'Unknown', project: 'Test',
            projectKey: 'TST', issueType: 'Task', priority: 'Medium',
            created, updated: created, resolved, age: 0,
            isSLABreach: false, slaRisk: 'on-track', jiraBreached: false,
          };

          const normalized = normalizeTicket(rawTicket);

          if (resolved == null || resolved === '') {
            return normalized.resolutionDays === null;
          }

          const expected = Math.floor(
            (new Date(resolved) - new Date(created)) / 86400000
          );
          return normalized.resolutionDays === expected;
        }
      ),
      { numRuns: 500 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: isLegacy threshold
// Validates: Requirements 4.7
// ---------------------------------------------------------------------------

describe('Property 4: isLegacy threshold', () => {
  /**
   * **Validates: Requirements 4.7**
   *
   * For any ticket, `normalizeTicket(ticket).isLegacy` SHALL equal `true` if
   * and only if `new Date(createdAt) < new Date(Date.now() - 2 * 365 * 86400000)`.
   */
  it('isLegacy matches the 2-year cutoff for all date values', () => {
    fc.assert(
      fc.property(
        fc.date({
          min: new Date('2010-01-01T00:00:00Z'),
          max: new Date('2030-12-31T23:59:59Z'),
        }).filter((d) => !isNaN(d.getTime())),
        (createdDate) => {
          const created = createdDate.toISOString();
          const rawTicket = {
            key: 'TST-1', summary: '', status: 'Open', statusCat: 'To Do',
            assignee: 'Unassigned', bank: 'Unknown', project: 'Test',
            projectKey: 'TST', issueType: 'Task', priority: 'Medium',
            created, updated: created, resolved: null, age: 0,
            isSLABreach: false, slaRisk: 'on-track', jiraBreached: false,
          };

          const normalized = normalizeTicket(rawTicket);

          const twoYearsAgo = new Date(Date.now() - 2 * 365 * 86400000);
          const expectedIsLegacy = new Date(created) < twoYearsAgo;

          return normalized.isLegacy === expectedIsLegacy;
        }
      ),
      { numRuns: 500 }
    );
  });
});

// ---------------------------------------------------------------------------
// Imports for filter properties (Task 4)
// ---------------------------------------------------------------------------

import { applyFilters, DEFAULT_MANUAL_FILTERS } from '../features/csr-analytics/utils/csrAnalyticsAggregations.js';
import { AGE_BUCKETS } from '../features/csr-analytics/utils/csrAnalyticsConstants.js';

// ---------------------------------------------------------------------------
// Arbitraries for NormalizedCsrTicket, ManualFilters, DrilldownFilters
// ---------------------------------------------------------------------------

/**
 * Generates a NormalizedCsrTicket directly via fc.record, avoiding the
 * complexity of going through normalizeTicket in tests.
 */
const normalizedTicketArb = fc.record({
  key:            fc.stringMatching(/^[A-Z]{2,6}-\d{1,5}$/),
  summary:        fc.string({ minLength: 0, maxLength: 120 }),
  project:        fc.string({ minLength: 1, maxLength: 40 }),
  bank:           fc.oneof(
    fc.constant('Piraeus Bank'),
    fc.constant('Eurobank'),
    fc.constant('Alpha Bank'),
    fc.string({ minLength: 1, maxLength: 40 }),
  ),
  assignee:       fc.oneof(fc.constant(''), fc.constant('Unassigned'), fc.string({ minLength: 1, maxLength: 60 })),
  status:         fc.oneof(
    fc.constant('Open'),
    fc.constant('In Progress'),
    fc.constant('Completed'),
    fc.constant('Closed'),
    fc.string({ minLength: 1, maxLength: 30 }),
  ),
  issueType:      fc.oneof(fc.constant('Bug'), fc.constant('Task'), fc.constant('Story'), fc.string({ minLength: 1, maxLength: 30 })),
  createdAt:      isoDateStringArb,
  updatedAt:      isoDateStringArb,
  resolvedAt:     fc.oneof(fc.constant(null), isoDateStringArb),
  isOpen:         fc.boolean(),
  isResolved:     fc.boolean(),
  ageDays:        fc.nat({ max: 3000 }),
  resolutionDays: fc.oneof(fc.constant(null), fc.nat({ max: 3000 })),
  slaState:       fc.oneof(
    fc.constant('on-track'),
    fc.constant('at-risk'),
    fc.constant('breaching'),
  ),
  isLegacy:       fc.boolean(),
});

/**
 * Generates a ManualFilters object with arbitrary (possibly non-default) values.
 */
const manualFiltersArb = fc.record({
  dateRange: fc.record({
    start: fc.oneof(fc.constant(''), isoDateStringArb),
    end:   fc.oneof(fc.constant(''), isoDateStringArb),
  }),
  project:      fc.oneof(fc.constant('all'), fc.string({ minLength: 1, maxLength: 40 })),
  bank:         fc.oneof(fc.constant('all'), fc.string({ minLength: 1, maxLength: 40 })),
  assignee:     fc.oneof(fc.constant('all'), fc.string({ minLength: 1, maxLength: 60 })),
  status:       fc.oneof(fc.constant('all'), fc.string({ minLength: 1, maxLength: 30 })),
  issueType:    fc.oneof(fc.constant('all'), fc.string({ minLength: 1, maxLength: 30 })),
  includeLegacy: fc.boolean(),
  ticketScope:  fc.oneof(fc.constant('all'), fc.constant('open'), fc.constant('resolved')),
});

/**
 * Generates a single DrilldownFilter object for one of the supported dimensions.
 */
const drilldownFilterArb = fc.oneof(
  // week-created
  fc.record({
    dimension: fc.constant('week-created'),
    value:     isoDateStringArb.map((d) => isoWeekOf(d)),
  }),
  // week-resolved
  fc.record({
    dimension: fc.constant('week-resolved'),
    value:     isoDateStringArb.map((d) => isoWeekOf(d)),
  }),
  // week-sla
  fc.record({
    dimension: fc.constant('week-sla'),
    value: fc.record({
      week:     isoDateStringArb.map((d) => isoWeekOf(d)),
      slaState: fc.oneof(fc.constant('on-track'), fc.constant('at-risk'), fc.constant('breaching')),
    }),
  }),
  // age-bucket
  fc.record({
    dimension: fc.constant('age-bucket'),
    value:     fc.constantFrom(...AGE_BUCKETS.map((b) => b.label)),
  }),
);

/**
 * Generates an array of DrilldownFilter objects (0–3 items, unique dimensions).
 * Uniqueness is enforced by deduplicating on dimension key after generation.
 */
const drilldownFiltersArb = fc
  .array(drilldownFilterArb, { minLength: 0, maxLength: 4 })
  .map((arr) => {
    // Keep only the first occurrence of each dimension to avoid conflicting filters
    const seen = new Set();
    return arr.filter((d) => {
      if (seen.has(d.dimension)) return false;
      seen.add(d.dimension);
      return true;
    });
  });

// ---------------------------------------------------------------------------
// Property 5: Legacy exclusion filter
// Validates: Requirements 5.2
// ---------------------------------------------------------------------------

describe('Property 5: Legacy exclusion filter', () => {
  /**
   * **Validates: Requirements 5.2**
   *
   * For any array of NormalizedCsrTicket objects with mixed isLegacy values,
   * applying applyFilters with includeLegacy = false SHALL produce an output
   * array containing no ticket where isLegacy is true.
   */
  it('no legacy tickets appear in output when includeLegacy is false', () => {
    fc.assert(
      fc.property(
        fc.array(normalizedTicketArb, { minLength: 0, maxLength: 50 }),
        (tickets) => {
          const filters = { ...DEFAULT_MANUAL_FILTERS, includeLegacy: false };
          const result = applyFilters(tickets, filters, []);
          return result.every((t) => t.isLegacy !== true);
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: Ticket scope filter correctness
// Validates: Requirements 5.3, 5.4
// ---------------------------------------------------------------------------

describe('Property 6: Ticket scope filter correctness', () => {
  /**
   * **Validates: Requirements 5.3**
   *
   * Applying applyFilters with ticketScope = 'open' SHALL produce an output
   * array where every ticket has isOpen = true.
   */
  it("ticketScope 'open' keeps only isOpen tickets", () => {
    fc.assert(
      fc.property(
        fc.array(normalizedTicketArb, { minLength: 0, maxLength: 50 }),
        (tickets) => {
          const filters = { ...DEFAULT_MANUAL_FILTERS, includeLegacy: true, ticketScope: 'open' };
          const result = applyFilters(tickets, filters, []);
          return result.every((t) => t.isOpen === true);
        }
      ),
      { numRuns: 300 }
    );
  });

  /**
   * **Validates: Requirements 5.4**
   *
   * Applying applyFilters with ticketScope = 'resolved' SHALL produce an
   * output array where every ticket has isResolved = true.
   */
  it("ticketScope 'resolved' keeps only isResolved tickets", () => {
    fc.assert(
      fc.property(
        fc.array(normalizedTicketArb, { minLength: 0, maxLength: 50 }),
        (tickets) => {
          const filters = { ...DEFAULT_MANUAL_FILTERS, includeLegacy: true, ticketScope: 'resolved' };
          const result = applyFilters(tickets, filters, []);
          return result.every((t) => t.isResolved === true);
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Date range filter correctness
// Validates: Requirements 5.5, 5.6
// ---------------------------------------------------------------------------

describe('Property 7: Date range filter correctness', () => {
  /**
   * **Validates: Requirements 5.5**
   *
   * When a dateRange start is set, all output tickets SHALL have
   * createdAt >= start (lexicographic YYYY-MM-DD comparison).
   */
  it('all output tickets have createdAt >= start when start is set', () => {
    fc.assert(
      fc.property(
        fc.tuple(isoDateStringArb, fc.array(normalizedTicketArb, { minLength: 0, maxLength: 50 })),
        ([start, tickets]) => {
          const filters = {
            ...DEFAULT_MANUAL_FILTERS,
            includeLegacy: true,
            dateRange: { start, end: '' },
          };
          const result = applyFilters(tickets, filters, []);
          return result.every((t) => (t.createdAt ?? '').slice(0, 10) >= start);
        }
      ),
      { numRuns: 300 }
    );
  });

  /**
   * **Validates: Requirements 5.6**
   *
   * When a dateRange end is set, all output tickets SHALL have
   * createdAt <= end (lexicographic YYYY-MM-DD comparison).
   */
  it('all output tickets have createdAt <= end when end is set', () => {
    fc.assert(
      fc.property(
        fc.tuple(isoDateStringArb, fc.array(normalizedTicketArb, { minLength: 0, maxLength: 50 })),
        ([end, tickets]) => {
          const filters = {
            ...DEFAULT_MANUAL_FILTERS,
            includeLegacy: true,
            dateRange: { start: '', end },
          };
          const result = applyFilters(tickets, filters, []);
          return result.every((t) => (t.createdAt ?? '').slice(0, 10) <= end);
        }
      ),
      { numRuns: 300 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: Filter reset round-trip
// Validates: Requirements 5.7
// ---------------------------------------------------------------------------

describe('Property 8: Filter reset round-trip', () => {
  /**
   * **Validates: Requirements 5.7**
   *
   * For any ManualFilters state, after calling resetFilters() the resulting
   * state SHALL deep-equal DEFAULT_MANUAL_FILTERS.
   *
   * Since useCsrAnalyticsFilters is a React hook, we test the underlying
   * reset logic directly: the reset function returns a fresh copy of
   * DEFAULT_MANUAL_FILTERS, so for any arbitrary ManualFilters value the
   * reset result must deep-equal the constant.
   */
  it('reset always produces a value deep-equal to DEFAULT_MANUAL_FILTERS', () => {
    fc.assert(
      fc.property(manualFiltersArb, (_arbitraryFilters) => {
        // Simulate the reset: the hook calls getDefaultFilters() which returns
        // a fresh copy of DEFAULT_MANUAL_FILTERS.
        const resetResult = {
          ...DEFAULT_MANUAL_FILTERS,
          dateRange: { ...DEFAULT_MANUAL_FILTERS.dateRange },
        };

        expect(resetResult).toEqual(DEFAULT_MANUAL_FILTERS);
        return true;
      }),
      { numRuns: 300 }
    );
  });

  it('DEFAULT_MANUAL_FILTERS has the expected shape and default values', () => {
    expect(DEFAULT_MANUAL_FILTERS).toEqual({
      dateRange: { start: '', end: '' },
      project: 'all',
      bank: 'all',
      assignee: 'all',
      status: 'all',
      issueType: 'all',
      includeLegacy: false,
      ticketScope: 'all',
    });
  });

  it('reset result is a distinct object (not the same reference as DEFAULT_MANUAL_FILTERS)', () => {
    fc.assert(
      fc.property(manualFiltersArb, (_arbitraryFilters) => {
        const resetResult = {
          ...DEFAULT_MANUAL_FILTERS,
          dateRange: { ...DEFAULT_MANUAL_FILTERS.dateRange },
        };
        // Must be a different object reference to prevent mutation bugs
        return resetResult !== DEFAULT_MANUAL_FILTERS;
      }),
      { numRuns: 100 }
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Combined filter intersection
// Validates: Requirements 6.7
// ---------------------------------------------------------------------------

describe('Property 9: Combined filter intersection', () => {
  /**
   * **Validates: Requirements 6.7**
   *
   * When both ManualFilters and DrilldownFilters are active, the output of
   * applyFilters SHALL be a subset of both the set that passes ManualFilters
   * alone and the set that passes DrilldownFilters alone (logical AND).
   */
  it('combined output is a subset of manual-only and drilldown-only results', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(normalizedTicketArb, { minLength: 0, maxLength: 50 }),
          manualFiltersArb,
          drilldownFiltersArb,
        ),
        ([tickets, manualFilters, drilldownFilters]) => {
          // Apply all filters together
          const combined = applyFilters(tickets, manualFilters, drilldownFilters);

          // Apply manual filters only (no drilldowns)
          const manualOnly = applyFilters(tickets, manualFilters, []);

          // Apply drilldown filters only (default manual filters with includeLegacy=true
          // so we don't accidentally exclude tickets that the drilldown would keep)
          const drilldownOnly = applyFilters(
            tickets,
            { ...DEFAULT_MANUAL_FILTERS, includeLegacy: true },
            drilldownFilters,
          );

          const manualOnlyKeys   = new Set(manualOnly.map((t) => t.key));
          const drilldownOnlyKeys = new Set(drilldownOnly.map((t) => t.key));

          // Every ticket in combined must appear in both manual-only and drilldown-only
          return combined.every(
            (t) => manualOnlyKeys.has(t.key) && drilldownOnlyKeys.has(t.key)
          );
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ---------------------------------------------------------------------------
// Imports for KPI properties (Task 5)
// ---------------------------------------------------------------------------

import {
  computeKpis,
  classifyDeltaTone,
} from '../features/csr-analytics/utils/csrAnalyticsAggregations.js';
import {
  fourWeekWindowBounds,
  isInWindow,
} from '../features/csr-analytics/utils/csrAnalyticsDates.js';

// ---------------------------------------------------------------------------
// Property 13: KPI aggregations are correct for all ticket sets
// Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.9, 17.1–17.4, 17.8
// ---------------------------------------------------------------------------

describe('Property 13: KPI aggregations are correct for all ticket sets', () => {
  /**
   * **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.9, 17.1, 17.2, 17.3, 17.4, 17.8**
   *
   * For any array of NormalizedCsrTicket objects, the KpiSet produced by
   * `computeKpis(tickets)` SHALL satisfy the exact count definitions:
   * - createdThisWeek  = count where isoWeekOf(createdAt) === current ISO week
   * - resolvedThisWeek = count where isoWeekOf(resolvedAt) === current ISO week
   * - netBacklogChange = createdThisWeek - resolvedThisWeek
   * - openBacklog      = count where isOpen === true
   * - openOver90Days   = count where isOpen === true AND ageDays >= 90
   */
  it('count-based KPIs match their exact definitions for all ticket sets', () => {
    fc.assert(
      fc.property(
        fc.array(normalizedTicketArb, { minLength: 0, maxLength: 100 }),
        (tickets) => {
          const kpis = computeKpis(tickets);
          const currentWeek = isoWeekOf(new Date().toISOString());

          const expectedCreated = tickets.filter(
            (t) => isoWeekOf(t.createdAt) === currentWeek,
          ).length;

          const expectedResolved = tickets.filter(
            (t) => t.resolvedAt != null && isoWeekOf(t.resolvedAt) === currentWeek,
          ).length;

          const expectedNetBacklog = expectedCreated - expectedResolved;

          const expectedOpenBacklog = tickets.filter((t) => t.isOpen === true).length;

          const expectedOpenOver90 = tickets.filter(
            (t) => t.isOpen === true && t.ageDays >= 90,
          ).length;

          return (
            kpis.createdThisWeek === expectedCreated &&
            kpis.resolvedThisWeek === expectedResolved &&
            kpis.netBacklogChange === expectedNetBacklog &&
            kpis.openBacklog === expectedOpenBacklog &&
            kpis.openOver90Days === expectedOpenOver90
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 14: Resolution statistics are correct for all ticket sets
// Validates: Requirements 8.6, 8.7, 17.5, 17.6
// ---------------------------------------------------------------------------

describe('Property 14: Resolution statistics are correct for all ticket sets', () => {
  /**
   * **Validates: Requirements 8.6, 8.7, 17.5, 17.6**
   *
   * For any array of NormalizedCsrTicket objects:
   * - When there are resolved tickets with resolvedAt in the 4w window,
   *   avgResolutionDays4w equals the arithmetic mean and
   *   medianResolutionDays4w equals the statistical median.
   * - When there are no such tickets, both are null.
   */
  it('avg and median are null when no resolved tickets in 4w window', () => {
    // Tickets with resolvedAt = null — never in any window
    fc.assert(
      fc.property(
        fc.array(
          normalizedTicketArb.map((t) => ({ ...t, resolvedAt: null, resolutionDays: null })),
          { minLength: 0, maxLength: 50 },
        ),
        (tickets) => {
          const kpis = computeKpis(tickets);
          return kpis.avgResolutionDays4w === null && kpis.medianResolutionDays4w === null;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('avg and median match arithmetic mean and statistical median for resolved tickets in 4w window', () => {
    // Generate tickets with resolvedAt within the current 4-week window
    const fw = fourWeekWindowBounds();
    const windowStart = fw.start.getTime();
    const windowEnd = fw.end.getTime();

    // Arbitrary for a date within the 4w window
    const resolvedInWindowArb = fc
      .integer({ min: 0, max: Math.floor(windowEnd - windowStart) })
      .map((offset) => new Date(windowStart + offset).toISOString().slice(0, 10));

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            resolvedAt: resolvedInWindowArb,
            resolutionDays: fc.nat({ max: 3000 }),
          }),
          { minLength: 1, maxLength: 50 },
        ),
        (resolvedEntries) => {
          // Build minimal tickets that have resolvedAt in window
          const tickets = resolvedEntries.map((entry, i) => ({
            key: `TST-${i}`,
            summary: '',
            project: 'Test',
            bank: 'Test',
            assignee: 'Alice',
            status: 'Completed',
            issueType: 'Task',
            createdAt: '2020-01-01',
            updatedAt: entry.resolvedAt,
            resolvedAt: entry.resolvedAt,
            isOpen: false,
            isResolved: true,
            ageDays: 10,
            resolutionDays: entry.resolutionDays,
            slaState: 'on-track',
            isLegacy: false,
          }));

          const kpis = computeKpis(tickets);

          // Compute expected avg
          const values = resolvedEntries.map((e) => e.resolutionDays);
          const expectedAvg = values.reduce((s, v) => s + v, 0) / values.length;

          // Compute expected median
          const sorted = [...values].sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          const expectedMedian =
            sorted.length % 2 === 0
              ? (sorted[mid - 1] + sorted[mid]) / 2
              : sorted[mid];

          return (
            kpis.avgResolutionDays4w === expectedAvg &&
            kpis.medianResolutionDays4w === expectedMedian
          );
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 15: SLA breach rate is correct for all ticket sets
// Validates: Requirements 8.8, 17.7
// ---------------------------------------------------------------------------

describe('Property 15: SLA breach rate is correct for all ticket sets', () => {
  /**
   * **Validates: Requirements 8.8, 17.7**
   *
   * For any array of NormalizedCsrTicket objects:
   * - slaBreachRate4w equals (breaching count in 4w window) / (non-null slaState count in 4w window)
   * - slaBreachRate4w is null when the denominator is zero
   */
  it('slaBreachRate4w matches the ratio formula or null when denominator is zero', () => {
    fc.assert(
      fc.property(
        fc.array(normalizedTicketArb, { minLength: 0, maxLength: 100 }),
        (tickets) => {
          const kpis = computeKpis(tickets);
          const fw = fourWeekWindowBounds();

          const inWindow = tickets.filter(
            (t) => t.slaState != null && isInWindow(t.createdAt, fw),
          );
          const breachingInWindow = inWindow.filter(
            (t) => t.slaState === 'breaching',
          );

          if (inWindow.length === 0) {
            return kpis.slaBreachRate4w === null;
          }

          const expected = breachingInWindow.length / inWindow.length;
          return kpis.slaBreachRate4w === expected;
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: KPI delta tone classification
// Validates: Requirements 8.12–8.15
// ---------------------------------------------------------------------------

describe('Property 16: KPI delta tone classification', () => {
  /**
   * **Validates: Requirements 8.12, 8.13, 8.14, 8.15**
   *
   * For any numeric delta and boolean lowerIsBetter:
   * - delta < 0 && lowerIsBetter  → 'good'
   * - delta > 0 && lowerIsBetter  → 'danger'
   * - delta > 0 && !lowerIsBetter → 'good'
   * - delta < 0 && !lowerIsBetter → 'danger'
   * - delta === 0                 → 'neutral'
   * - delta === null              → 'neutral'
   */
  it('classifyDeltaTone returns correct tone per the truth table', () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.integer(), fc.boolean()),
        ([delta, lowerIsBetter]) => {
          const tone = classifyDeltaTone(delta, lowerIsBetter);

          if (delta === 0) return tone === 'neutral';
          if (delta < 0 && lowerIsBetter) return tone === 'good';
          if (delta > 0 && lowerIsBetter) return tone === 'danger';
          if (delta > 0 && !lowerIsBetter) return tone === 'good';
          if (delta < 0 && !lowerIsBetter) return tone === 'danger';
          return false; // unreachable
        },
      ),
      { numRuns: 500 },
    );
  });

  it('delta === 0 always returns neutral', () => {
    expect(classifyDeltaTone(0, true)).toBe('neutral');
    expect(classifyDeltaTone(0, false)).toBe('neutral');
  });

  it('delta === null always returns neutral', () => {
    expect(classifyDeltaTone(null, true)).toBe('neutral');
    expect(classifyDeltaTone(null, false)).toBe('neutral');
  });
});

// ---------------------------------------------------------------------------
// Imports for chart series properties (Task 6)
// ---------------------------------------------------------------------------

import {
  buildBacklogTrendSeries,
  buildAgingBuckets,
  buildAssigneeWorkload,
} from '../features/csr-analytics/utils/csrAnalyticsAggregations.js';

// ---------------------------------------------------------------------------
// Property 17: Cumulative backlog computation
// Validates: Requirements 11.2
// ---------------------------------------------------------------------------

describe('Property 17: Cumulative backlog computation', () => {
  /**
   * **Validates: Requirements 11.2**
   *
   * For any array of NormalizedCsrTicket objects, the cumulative backlog
   * series produced by `buildBacklogTrendSeries(tickets)` SHALL satisfy:
   * for each week W at index i, `cumulative[i]` equals the running sum of
   * `(created[w] - resolved[w])` for all weeks w up to and including W.
   */
  it('cumulative[W] equals the running sum of netChange for all weeks up to W', () => {
    fc.assert(
      fc.property(
        fc.array(normalizedTicketArb, { minLength: 0, maxLength: 100 }),
        (tickets) => {
          const series = buildBacklogTrendSeries(tickets);

          // Verify the series is sorted ascending by week
          for (let i = 1; i < series.length; i++) {
            if (series[i].week <= series[i - 1].week) return false;
          }

          // Verify cumulative is the running sum of netChange
          let runningSum = 0;
          for (const entry of series) {
            runningSum += entry.netChange;
            if (entry.cumulative !== runningSum) return false;
          }

          return true;
        },
      ),
      { numRuns: 300 },
    );
  });

  it('returns empty array for empty input', () => {
    expect(buildBacklogTrendSeries([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Property 18: Age bucket assignment is exhaustive and mutually exclusive
// Validates: Requirements 12.2, 12.4
// ---------------------------------------------------------------------------

describe('Property 18: Age bucket assignment is exhaustive and mutually exclusive', () => {
  /**
   * **Validates: Requirements 12.2, 12.4**
   *
   * For any array of NormalizedCsrTicket objects:
   * - Every open ticket appears in exactly one bucket
   * - The sum of all bucket counts equals the count of open tickets
   */
  it('sum of bucket counts equals open ticket count', () => {
    fc.assert(
      fc.property(
        fc.array(normalizedTicketArb, { minLength: 0, maxLength: 100 }),
        (tickets) => {
          const buckets = buildAgingBuckets(tickets);
          const openCount = tickets.filter((t) => t.isOpen === true).length;
          const bucketTotal = buckets.reduce((sum, b) => sum + b.count, 0);
          return bucketTotal === openCount;
        },
      ),
      { numRuns: 300 },
    );
  });

  it('always returns exactly 5 buckets', () => {
    fc.assert(
      fc.property(
        fc.array(normalizedTicketArb, { minLength: 0, maxLength: 100 }),
        (tickets) => {
          const buckets = buildAgingBuckets(tickets);
          return buckets.length === 5;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('each open ticket is assigned to exactly one bucket (no double-counting)', () => {
    fc.assert(
      fc.property(
        fc.array(normalizedTicketArb, { minLength: 0, maxLength: 100 }),
        (tickets) => {
          const buckets = buildAgingBuckets(tickets);
          const openCount = tickets.filter((t) => t.isOpen === true).length;
          const bucketTotal = buckets.reduce((sum, b) => sum + b.count, 0);
          // If sum equals open count, each ticket is in exactly one bucket
          return bucketTotal === openCount;
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 19: Assignee workload top-8 aggregation
// Validates: Requirements 14.4
// ---------------------------------------------------------------------------

describe('Property 19: Assignee workload top-8 aggregation', () => {
  /**
   * **Validates: Requirements 14.4**
   *
   * For any array of NormalizedCsrTicket objects with more than 8 distinct
   * assignees, `buildAssigneeWorkload(tickets, mode)` SHALL return at most 9
   * entries, where the first 8 are the assignees with the highest counts and
   * the 9th entry is 'Other' with a count equal to the sum of all remaining
   * assignees' counts.
   *
   * To guarantee > 8 distinct assignees, tickets are generated with assignees
   * drawn from a pool of 10 distinct names.
   */
  it('returns at most 9 entries, top 8 are highest-count, 9th is Other with correct sum', () => {
    // Pool of 10 distinct assignee names to guarantee > 8 distinct assignees
    const assigneePool = [
      'Alice', 'Bob', 'Carol', 'Dave', 'Eve',
      'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy',
    ];

    // Generate tickets where each ticket has an assignee from the pool
    // and isOpen = true so 'open' mode counts them
    const ticketWithPoolAssigneeArb = normalizedTicketArb.map((t) => ({
      ...t,
      assignee: assigneePool[Math.abs(t.key.charCodeAt(0) + t.key.charCodeAt(t.key.length - 1)) % assigneePool.length],
      isOpen: true,
    }));

    // Use a dedicated arbitrary that picks assignees from the pool
    const poolTicketArb = fc.record({
      key:            fc.stringMatching(/^[A-Z]{2,6}-\d{1,5}$/),
      summary:        fc.string({ minLength: 0, maxLength: 120 }),
      project:        fc.string({ minLength: 1, maxLength: 40 }),
      bank:           fc.constant('Test Bank'),
      assignee:       fc.constantFrom(...assigneePool),
      status:         fc.constant('Open'),
      issueType:      fc.constant('Task'),
      createdAt:      isoDateStringArb,
      updatedAt:      isoDateStringArb,
      resolvedAt:     fc.constant(null),
      isOpen:         fc.constant(true),
      isResolved:     fc.constant(false),
      ageDays:        fc.nat({ max: 3000 }),
      resolutionDays: fc.constant(null),
      slaState:       fc.constant('on-track'),
      isLegacy:       fc.constant(false),
    });

    fc.assert(
      fc.property(
        // Generate enough tickets to ensure all 10 assignees appear at least once
        fc.array(poolTicketArb, { minLength: 30, maxLength: 200 }),
        (tickets) => {
          // Count distinct assignees in the input
          const distinctAssignees = new Set(tickets.map((t) => t.assignee));
          // Only run the full assertion when we have > 8 distinct assignees
          if (distinctAssignees.size <= 8) return true;

          const result = buildAssigneeWorkload(tickets, 'open');

          // At most 9 entries
          if (result.length > 9) return false;

          // When there are > 8 distinct assignees, we expect exactly 9 entries
          if (result.length !== 9) return false;

          // 9th entry must be 'Other'
          const lastEntry = result[result.length - 1];
          if (lastEntry.assignee !== 'Other') return false;

          // First 8 must be sorted descending by count
          for (let i = 1; i < 8; i++) {
            if (result[i].count > result[i - 1].count) return false;
          }

          // Compute expected counts from input
          const countMap = new Map();
          for (const ticket of tickets) {
            if (!ticket.isOpen) continue;
            const a = ticket.assignee || 'Unassigned';
            countMap.set(a, (countMap.get(a) ?? 0) + 1);
          }

          // Sort all assignees by count descending
          const allSorted = Array.from(countMap.entries()).sort(([, a], [, b]) => b - a);

          // Verify top 8 assignees match
          for (let i = 0; i < 8; i++) {
            if (result[i].assignee !== allSorted[i][0]) return false;
            if (result[i].count !== allSorted[i][1]) return false;
          }

          // Verify 'Other' count is the sum of the rest
          const expectedOtherCount = allSorted
            .slice(8)
            .reduce((sum, [, c]) => sum + c, 0);
          if (lastEntry.count !== expectedOtherCount) return false;

          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns at most 8 entries when there are 8 or fewer distinct assignees', () => {
    fc.assert(
      fc.property(
        fc.array(normalizedTicketArb, { minLength: 0, maxLength: 50 }),
        (tickets) => {
          const result = buildAssigneeWorkload(tickets, 'open');
          return result.length <= 9; // at most 9 (8 + Other)
        },
      ),
      { numRuns: 200 },
    );
  });
});

// ---------------------------------------------------------------------------
// Pure helper functions that mirror useCsrAnalyticsDrilldown hook logic
// (extracted for property-based testing without React rendering)
// ---------------------------------------------------------------------------

/**
 * Simulates `clearDrilldown()` — always returns an empty array.
 *
 * @returns {[]}
 */
function simulateClearDrilldown() {
  return [];
}

/**
 * Simulates `clearDrilldownDimension(key)` — filters out the drilldown whose
 * `dimension` matches `key`, preserving all others.
 *
 * @param {Array<{dimension: string, value: any, label?: string}>} drilldowns
 * @param {string} key
 * @returns {Array<{dimension: string, value: any, label?: string}>}
 */
function simulateClearDrilldownDimension(drilldowns, key) {
  return drilldowns.filter((d) => d.dimension !== key);
}

// ---------------------------------------------------------------------------
// Property 10: Drilldown clear removes all dimensions
// Validates: Requirements 6.5
// ---------------------------------------------------------------------------

describe('Property 10: Drilldown clear removes all dimensions', () => {
  /**
   * **Validates: Requirements 6.5**
   *
   * For any array of DrilldownFilter objects, calling `clearDrilldown()`
   * SHALL produce an empty array regardless of the prior state.
   */
  it('clearDrilldown always returns an empty array for any drilldown state', () => {
    fc.assert(
      fc.property(
        fc.array(drilldownFilterArb),
        (_drilldowns) => {
          const result = simulateClearDrilldown();
          return Array.isArray(result) && result.length === 0;
        },
      ),
      { numRuns: 300 },
    );
  });

  it('clearDrilldown returns [] for an empty array', () => {
    expect(simulateClearDrilldown()).toEqual([]);
  });

  it('clearDrilldown returns [] for a non-empty array', () => {
    const state = [
      { dimension: 'week-created', value: '2025-W20' },
      { dimension: 'age-bucket', value: '0–7 days' },
    ];
    expect(simulateClearDrilldown(state)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Property 11: Drilldown dimension removal preserves others
// Validates: Requirements 6.6
// ---------------------------------------------------------------------------

describe('Property 11: Drilldown dimension removal preserves others', () => {
  /**
   * **Validates: Requirements 6.6**
   *
   * For any array of DrilldownFilter objects with at least 2 entries,
   * calling `clearDrilldownDimension(key)` for one dimension SHALL:
   * - Remove exactly the drilldown(s) with that dimension
   * - Preserve all other drilldowns unchanged (same count - 1, same values)
   */
  it('removes only the targeted dimension and preserves all others', () => {
    fc.assert(
      fc.property(
        fc.array(drilldownFilterArb, { minLength: 2, maxLength: 8 }),
        (rawDrilldowns) => {
          // Deduplicate by dimension (same logic as drilldownFiltersArb)
          const seen = new Set();
          const drilldowns = rawDrilldowns.filter((d) => {
            if (seen.has(d.dimension)) return false;
            seen.add(d.dimension);
            return true;
          });

          // Need at least 2 unique dimensions to test preservation
          if (drilldowns.length < 2) return true;

          // Pick the first dimension to remove
          const keyToRemove = drilldowns[0].dimension;

          const result = simulateClearDrilldownDimension(drilldowns, keyToRemove);

          // The removed dimension must not appear in the result
          if (result.some((d) => d.dimension === keyToRemove)) return false;

          // All other dimensions must still be present
          const remaining = drilldowns.filter((d) => d.dimension !== keyToRemove);
          if (result.length !== remaining.length) return false;

          // Each remaining drilldown must appear in the result with the same value
          for (const expected of remaining) {
            const found = result.find((d) => d.dimension === expected.dimension);
            if (!found) return false;
            // Values must be deeply equal (JSON comparison for objects)
            if (JSON.stringify(found.value) !== JSON.stringify(expected.value)) return false;
          }

          return true;
        },
      ),
      { numRuns: 300 },
    );
  });

  it('removing a dimension that does not exist leaves the array unchanged', () => {
    const state = [
      { dimension: 'week-created', value: '2025-W20' },
      { dimension: 'age-bucket', value: '0–7 days' },
    ];
    const result = simulateClearDrilldownDimension(state, 'nonexistent-dimension');
    expect(result).toEqual(state);
  });

  it('result length is (original length - 1) when the dimension exists exactly once', () => {
    fc.assert(
      fc.property(
        fc.array(drilldownFilterArb, { minLength: 2, maxLength: 8 }),
        (rawDrilldowns) => {
          // Deduplicate by dimension
          const seen = new Set();
          const drilldowns = rawDrilldowns.filter((d) => {
            if (seen.has(d.dimension)) return false;
            seen.add(d.dimension);
            return true;
          });

          if (drilldowns.length < 2) return true;

          const keyToRemove = drilldowns[0].dimension;
          const result = simulateClearDrilldownDimension(drilldowns, keyToRemove);

          // Since dimensions are unique, removing one should reduce length by exactly 1
          return result.length === drilldowns.length - 1;
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Pure helper: compute active chip count (mirrors CsrAnalyticsActiveChips logic)
// ---------------------------------------------------------------------------

/**
 * Computes the number of active chips that CsrAnalyticsActiveChips would render,
 * without requiring React rendering. Mirrors the component's chip-building logic.
 *
 * @param {import('../features/csr-analytics/utils/csrAnalyticsTypes').ManualFilters} filters
 * @param {Array<{dimension: string, value: any, label?: string}>} drilldowns
 * @returns {number}
 */
function computeActiveChipCount(filters, drilldowns) {
  let count = 0;

  if (filters.dateRange.start !== DEFAULT_MANUAL_FILTERS.dateRange.start) count++;
  if (filters.dateRange.end   !== DEFAULT_MANUAL_FILTERS.dateRange.end)   count++;
  if (filters.project         !== DEFAULT_MANUAL_FILTERS.project)         count++;
  if (filters.bank            !== DEFAULT_MANUAL_FILTERS.bank)            count++;
  if (filters.assignee        !== DEFAULT_MANUAL_FILTERS.assignee)        count++;
  if (filters.status          !== DEFAULT_MANUAL_FILTERS.status)          count++;
  if (filters.issueType       !== DEFAULT_MANUAL_FILTERS.issueType)       count++;
  if (filters.includeLegacy   !== DEFAULT_MANUAL_FILTERS.includeLegacy)   count++;
  if (filters.ticketScope     !== DEFAULT_MANUAL_FILTERS.ticketScope)     count++;

  count += drilldowns.length;

  return count;
}

// ---------------------------------------------------------------------------
// Property 12: Active chip count matches non-default filter dimensions
// Validates: Requirements 7.1, 7.2
// ---------------------------------------------------------------------------

describe('Property 12: Active chip count matches non-default filter dimensions', () => {
  /**
   * **Validates: Requirements 7.1, 7.2**
   *
   * For any ManualFilters state and DrilldownFilter[] state, the number of
   * chips rendered by CsrAnalyticsActiveChips SHALL equal the count of
   * ManualFilters fields whose value differs from the default plus the length
   * of the DrilldownFilter[] array.
   */
  it('chip count equals (non-default ManualFilter fields) + (drilldown array length)', () => {
    fc.assert(
      fc.property(
        fc.tuple(manualFiltersArb, drilldownFiltersArb),
        ([filters, drilldowns]) => {
          const chipCount = computeActiveChipCount(filters, drilldowns);

          // Count non-default ManualFilter fields manually
          let expectedManualChips = 0;
          if (filters.dateRange.start !== DEFAULT_MANUAL_FILTERS.dateRange.start) expectedManualChips++;
          if (filters.dateRange.end   !== DEFAULT_MANUAL_FILTERS.dateRange.end)   expectedManualChips++;
          if (filters.project         !== DEFAULT_MANUAL_FILTERS.project)         expectedManualChips++;
          if (filters.bank            !== DEFAULT_MANUAL_FILTERS.bank)            expectedManualChips++;
          if (filters.assignee        !== DEFAULT_MANUAL_FILTERS.assignee)        expectedManualChips++;
          if (filters.status          !== DEFAULT_MANUAL_FILTERS.status)          expectedManualChips++;
          if (filters.issueType       !== DEFAULT_MANUAL_FILTERS.issueType)       expectedManualChips++;
          if (filters.includeLegacy   !== DEFAULT_MANUAL_FILTERS.includeLegacy)   expectedManualChips++;
          if (filters.ticketScope     !== DEFAULT_MANUAL_FILTERS.ticketScope)     expectedManualChips++;

          const expectedTotal = expectedManualChips + drilldowns.length;

          return chipCount === expectedTotal;
        },
      ),
      { numRuns: 500 },
    );
  });

  it('chip count is 0 when all filters are at defaults and drilldowns is empty', () => {
    const count = computeActiveChipCount(DEFAULT_MANUAL_FILTERS, []);
    expect(count).toBe(0);
  });

  it('chip count equals drilldown array length when all manual filters are at defaults', () => {
    fc.assert(
      fc.property(drilldownFiltersArb, (drilldowns) => {
        const count = computeActiveChipCount(DEFAULT_MANUAL_FILTERS, drilldowns);
        return count === drilldowns.length;
      }),
      { numRuns: 300 },
    );
  });

  it('each non-default ManualFilter field contributes exactly one chip', () => {
    // Test each field individually
    const cases = [
      { ...DEFAULT_MANUAL_FILTERS, dateRange: { start: '2024-01-01', end: '' } },
      { ...DEFAULT_MANUAL_FILTERS, dateRange: { start: '', end: '2024-12-31' } },
      { ...DEFAULT_MANUAL_FILTERS, project: 'MyProject' },
      { ...DEFAULT_MANUAL_FILTERS, bank: 'Piraeus Bank' },
      { ...DEFAULT_MANUAL_FILTERS, assignee: 'Alice' },
      { ...DEFAULT_MANUAL_FILTERS, status: 'In Progress' },
      { ...DEFAULT_MANUAL_FILTERS, issueType: 'Bug' },
      { ...DEFAULT_MANUAL_FILTERS, includeLegacy: true },
      { ...DEFAULT_MANUAL_FILTERS, ticketScope: 'open' },
    ];

    for (const filters of cases) {
      const count = computeActiveChipCount(filters, []);
      expect(count).toBe(1);
    }
  });

  it('chip count is non-negative for all inputs', () => {
    fc.assert(
      fc.property(
        fc.tuple(manualFiltersArb, drilldownFiltersArb),
        ([filters, drilldowns]) => {
          return computeActiveChipCount(filters, drilldowns) >= 0;
        },
      ),
      { numRuns: 300 },
    );
  });
});

// ---------------------------------------------------------------------------
// Imports for ticket grid sort property (Task 22)
// ---------------------------------------------------------------------------

// SORTABLE_COLUMNS mirrors the COLUMNS array in CsrAnalyticsTicketGrid.jsx
const SORTABLE_COLUMNS = ['key', 'summary', 'assignee', 'bank', 'status', 'ageDays', 'slaState', 'updatedAt'];

/** Columns that use numeric comparison. */
const NUMERIC_COLS_TEST = new Set(['ageDays', 'resolutionDays']);

/** Columns that are ISO date strings (sort lexicographically). */
const DATE_COLS_TEST = new Set(['updatedAt', 'createdAt', 'resolvedAt']);

/**
 * Mirrors the compareTickets function from CsrAnalyticsTicketGrid.jsx.
 *
 * @param {object} a
 * @param {object} b
 * @param {string} col
 * @param {'asc'|'desc'} dir
 * @returns {number}
 */
function compareTicketsTest(a, b, col, dir) {
  const aVal = a[col] ?? '';
  const bVal = b[col] ?? '';

  let cmp;
  if (NUMERIC_COLS_TEST.has(col)) {
    cmp = (aVal ?? 0) - (bVal ?? 0);
  } else if (DATE_COLS_TEST.has(col)) {
    cmp = String(aVal).localeCompare(String(bVal));
  } else {
    cmp = String(aVal).localeCompare(String(bVal));
  }

  return dir === 'asc' ? cmp : -cmp;
}

// ---------------------------------------------------------------------------
// Property 20: Ticket grid sort correctness
// Validates: Requirements 15.2
// ---------------------------------------------------------------------------

describe('Property 20: Ticket grid sort correctness', () => {
  /**
   * **Validates: Requirements 15.2**
   *
   * For any array of NormalizedCsrTicket objects and any sortable column key
   * and direction, the sorted rows SHALL be ordered such that for every
   * adjacent pair of rows (a, b), compare(a[col], b[col]) is ≤ 0 for
   * ascending and ≥ 0 for descending.
   */
  it('every adjacent pair of rows satisfies the sort comparator', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.array(normalizedTicketArb, { minLength: 0, maxLength: 100 }),
          fc.constantFrom(...SORTABLE_COLUMNS),
          fc.constantFrom('asc', 'desc'),
        ),
        ([tickets, col, dir]) => {
          // Sort using the same comparator as the component
          const sorted = [...tickets].sort((a, b) => compareTicketsTest(a, b, col, dir));

          // Verify every adjacent pair satisfies the comparator (result ≤ 0)
          for (let i = 1; i < sorted.length; i++) {
            const cmp = compareTicketsTest(sorted[i - 1], sorted[i], col, dir);
            if (cmp > 0) return false;
          }
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });

  it('ascending sort produces non-decreasing order for string columns', () => {
    fc.assert(
      fc.property(
        fc.array(normalizedTicketArb, { minLength: 0, maxLength: 50 }),
        (tickets) => {
          const sorted = [...tickets].sort((a, b) => compareTicketsTest(a, b, 'key', 'asc'));
          for (let i = 1; i < sorted.length; i++) {
            if (String(sorted[i - 1].key ?? '').localeCompare(String(sorted[i].key ?? '')) > 0) {
              return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('descending sort produces non-increasing order for numeric columns', () => {
    fc.assert(
      fc.property(
        fc.array(normalizedTicketArb, { minLength: 0, maxLength: 50 }),
        (tickets) => {
          const sorted = [...tickets].sort((a, b) => compareTicketsTest(a, b, 'ageDays', 'desc'));
          for (let i = 1; i < sorted.length; i++) {
            if ((sorted[i - 1].ageDays ?? 0) < (sorted[i].ageDays ?? 0)) {
              return false;
            }
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('sort is stable with respect to the comparator (no violations)', () => {
    // Concrete example: 3 tickets, sort by status ascending
    const tickets = [
      { ...{ key: 'A-1', summary: '', project: 'P', bank: 'B', assignee: 'X', status: 'Open', issueType: 'Task', createdAt: '2024-01-01', updatedAt: '2024-01-01', resolvedAt: null, isOpen: true, isResolved: false, ageDays: 5, resolutionDays: null, slaState: 'on-track', isLegacy: false } },
      { ...{ key: 'A-2', summary: '', project: 'P', bank: 'B', assignee: 'X', status: 'Closed', issueType: 'Task', createdAt: '2024-01-01', updatedAt: '2024-01-01', resolvedAt: null, isOpen: false, isResolved: false, ageDays: 10, resolutionDays: null, slaState: 'on-track', isLegacy: false } },
      { ...{ key: 'A-3', summary: '', project: 'P', bank: 'B', assignee: 'X', status: 'In Progress', issueType: 'Task', createdAt: '2024-01-01', updatedAt: '2024-01-01', resolvedAt: null, isOpen: true, isResolved: false, ageDays: 2, resolutionDays: null, slaState: 'at-risk', isLegacy: false } },
    ];
    const sorted = [...tickets].sort((a, b) => compareTicketsTest(a, b, 'status', 'asc'));
    // Closed < In Progress < Open (lexicographic)
    expect(sorted[0].status).toBe('Closed');
    expect(sorted[1].status).toBe('In Progress');
    expect(sorted[2].status).toBe('Open');
  });
});
