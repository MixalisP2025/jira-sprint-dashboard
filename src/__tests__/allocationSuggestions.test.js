// Feature: smart-ticket-allocation
// Tests for the generateSuggestions engine (unit + property-based)

import { describe, it, expect } from 'vitest';
import { generateSuggestions } from '../utils/allocationSuggestions';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeTicket(key, sp, project = 'CC') {
  return { 'Issue key': key, 'Story Points': String(sp), Project: project };
}

function makeEligibility(assignees, projects) {
  const e = {};
  assignees.forEach(a => { e[a] = new Set(projects); });
  return e;
}

// Simple deterministic pseudo-random number generator (LCG)
function makePrng(seed = 42) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function randomInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function randomChoice(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// ─── Unit tests ───────────────────────────────────────────────────────────────
describe('generateSuggestions — unit tests', () => {
  it('returns empty object for empty input', () => {
    const result = generateSuggestions([], {}, {});
    expect(result).toEqual({});
  });

  it('assigns ticket to eligible assignee with capacity', () => {
    const tickets = [makeTicket('CC-1', 3, 'CC')];
    const eligibility = { Alice: new Set(['CC']) };
    const caps = { Alice: 10 };
    const result = generateSuggestions(tickets, eligibility, caps);
    expect(result['CC-1']).toBe('Alice');
  });

  it('returns NO_SUGGESTION when no eligible assignee', () => {
    const tickets = [makeTicket('CC-1', 3, 'CC')];
    const eligibility = { Alice: new Set(['WTR1']) }; // not eligible for CC
    const caps = { Alice: 10 };
    const result = generateSuggestions(tickets, eligibility, caps);
    expect(result['CC-1']).toBe('NO_SUGGESTION');
  });

  it('returns NO_SUGGESTION when eligible assignee has insufficient capacity', () => {
    const tickets = [makeTicket('CC-1', 5, 'CC')];
    const eligibility = { Alice: new Set(['CC']) };
    const caps = { Alice: 3 }; // only 3 SP remaining
    const result = generateSuggestions(tickets, eligibility, caps);
    expect(result['CC-1']).toBe('NO_SUGGESTION');
  });

  it('treats 0 SP tickets as requiring 1 SP', () => {
    const tickets = [makeTicket('CC-1', 0, 'CC')];
    const eligibility = { Alice: new Set(['CC']) };
    const caps = { Alice: 1 };
    const result = generateSuggestions(tickets, eligibility, caps);
    expect(result['CC-1']).toBe('Alice');
  });

  it('0 SP ticket fails when assignee has 0 remaining capacity', () => {
    const tickets = [makeTicket('CC-1', 0, 'CC')];
    const eligibility = { Alice: new Set(['CC']) };
    const caps = { Alice: 0 };
    const result = generateSuggestions(tickets, eligibility, caps);
    expect(result['CC-1']).toBe('NO_SUGGESTION');
  });

  it('selects assignee with highest remaining capacity', () => {
    const tickets = [makeTicket('CC-1', 2, 'CC')];
    const eligibility = { Alice: new Set(['CC']), Bob: new Set(['CC']), Carol: new Set(['CC']) };
    const caps = { Alice: 5, Bob: 10, Carol: 7 };
    const result = generateSuggestions(tickets, eligibility, caps);
    expect(result['CC-1']).toBe('Bob'); // highest cap
  });

  it('breaks ties alphabetically', () => {
    const tickets = [makeTicket('CC-1', 2, 'CC')];
    const eligibility = { Alice: new Set(['CC']), Bob: new Set(['CC']) };
    const caps = { Alice: 10, Bob: 10 }; // tied
    const result = generateSuggestions(tickets, eligibility, caps);
    expect(result['CC-1']).toBe('Alice'); // alphabetically first
  });

  it('deducts capacity after each assignment', () => {
    const tickets = [
      makeTicket('CC-1', 8, 'CC'),
      makeTicket('CC-2', 5, 'CC'),
    ];
    const eligibility = { Alice: new Set(['CC']) };
    const caps = { Alice: 10 };
    const result = generateSuggestions(tickets, eligibility, caps);
    // CC-1 (8sp) assigned to Alice (10 remaining → 2 left)
    // CC-2 (5sp) cannot fit in 2 remaining
    expect(result['CC-1']).toBe('Alice');
    expect(result['CC-2']).toBe('NO_SUGGESTION');
  });

  it('processes largest tickets first (greedy)', () => {
    const tickets = [
      makeTicket('CC-1', 3, 'CC'),
      makeTicket('CC-2', 8, 'CC'),
    ];
    const eligibility = { Alice: new Set(['CC']) };
    const caps = { Alice: 10 };
    const result = generateSuggestions(tickets, eligibility, caps);
    // Largest first: CC-2 (8sp) → Alice (10→2), CC-1 (3sp) → NO_SUGGESTION (only 2 left)
    expect(result['CC-2']).toBe('Alice');
    expect(result['CC-1']).toBe('NO_SUGGESTION');
  });

  it('handles multiple projects and assignees', () => {
    const tickets = [
      makeTicket('CC-1', 3, 'CC'),
      makeTicket('WTR1-1', 3, 'WTR1'),
    ];
    const eligibility = {
      Alice: new Set(['CC']),
      Bob: new Set(['WTR1']),
    };
    const caps = { Alice: 10, Bob: 10 };
    const result = generateSuggestions(tickets, eligibility, caps);
    expect(result['CC-1']).toBe('Alice');
    expect(result['WTR1-1']).toBe('Bob');
  });

  it('does not mutate the input remainingCap object', () => {
    const tickets = [makeTicket('CC-1', 3, 'CC')];
    const eligibility = { Alice: new Set(['CC']) };
    const caps = { Alice: 10 };
    const capsCopy = { ...caps };
    generateSuggestions(tickets, eligibility, caps);
    expect(caps).toEqual(capsCopy);
  });

  it('is deterministic for identical inputs', () => {
    const tickets = [
      makeTicket('CC-1', 5, 'CC'),
      makeTicket('CC-2', 3, 'CC'),
      makeTicket('WTR1-1', 4, 'WTR1'),
    ];
    const eligibility = {
      Alice: new Set(['CC', 'WTR1']),
      Bob: new Set(['CC']),
    };
    const caps = { Alice: 8, Bob: 6 };
    const r1 = generateSuggestions(tickets, eligibility, caps);
    const r2 = generateSuggestions(tickets, eligibility, caps);
    expect(r1).toEqual(r2);
  });
});

// ─── Property-based tests (manual random generation) ─────────────────────────
describe('generateSuggestions — property-based tests', () => {
  const ITERATIONS = 100;

  // Property 5: Every ticket in input appears in result
  // Feature: smart-ticket-allocation, Property 5: Suggestion Engine Completeness
  // Validates: Requirements 3.1
  it('P5: every input ticket appears in result (completeness)', () => {
    const rng = makePrng(1);
    const projects = ['CC', 'WTR1', 'PROJ', 'ALPHA'];
    const assigneeNames = ['Alice', 'Bob', 'Carol', 'Dave'];

    for (let i = 0; i < ITERATIONS; i++) {
      const ticketCount = randomInt(rng, 0, 20);
      const tickets = Array.from({ length: ticketCount }, (_, j) => ({
        'Issue key': `T-${i}-${j}`,
        'Story Points': String(randomInt(rng, 0, 13)),
        Project: randomChoice(rng, projects),
      }));

      const eligibility = {};
      assigneeNames.forEach(a => {
        const eligible = projects.filter(() => rng() > 0.5);
        eligibility[a] = new Set(eligible);
      });

      const caps = {};
      assigneeNames.forEach(a => { caps[a] = randomInt(rng, 0, 30); });

      const result = generateSuggestions(tickets, eligibility, caps);

      for (const ticket of tickets) {
        const id = ticket['Issue key'];
        expect(result).toHaveProperty(id);
        expect(result[id] === 'NO_SUGGESTION' || typeof result[id] === 'string').toBe(true);
      }
    }
  });

  // Property 6: Eligibility invariant — no suggestion pairs ineligible assignee
  // Feature: smart-ticket-allocation, Property 6: Suggestion Engine Eligibility Invariant
  // Validates: Requirements 3.2
  it('P6: all suggestions respect eligibility (no ineligible assignments)', () => {
    const rng = makePrng(2);
    const projects = ['CC', 'WTR1', 'PROJ'];
    const assigneeNames = ['Alice', 'Bob', 'Carol'];

    for (let i = 0; i < ITERATIONS; i++) {
      const ticketCount = randomInt(rng, 1, 15);
      const tickets = Array.from({ length: ticketCount }, (_, j) => ({
        'Issue key': `T-${i}-${j}`,
        'Story Points': String(randomInt(rng, 1, 8)),
        Project: randomChoice(rng, projects),
      }));

      const eligibility = {};
      assigneeNames.forEach(a => {
        const eligible = projects.filter(() => rng() > 0.4);
        eligibility[a] = new Set(eligible);
      });

      const caps = {};
      assigneeNames.forEach(a => { caps[a] = randomInt(rng, 5, 20); });

      const result = generateSuggestions(tickets, eligibility, caps);

      for (const ticket of tickets) {
        const id = ticket['Issue key'];
        const assigned = result[id];
        if (assigned && assigned !== 'NO_SUGGESTION') {
          const project = ticket['Project'];
          expect(eligibility[assigned]?.has(project)).toBe(true);
        }
      }
    }
  });

  // Property 7: Capacity deduction invariant
  // Feature: smart-ticket-allocation, Property 7: Suggestion Engine Capacity and Deduction Invariant
  // Validates: Requirements 3.3, 3.6
  it('P7: capacity deductions are consistent — no over-allocation', () => {
    const rng = makePrng(3);
    const projects = ['CC', 'WTR1'];
    const assigneeNames = ['Alice', 'Bob', 'Carol'];

    for (let i = 0; i < ITERATIONS; i++) {
      const ticketCount = randomInt(rng, 1, 20);
      const tickets = Array.from({ length: ticketCount }, (_, j) => ({
        'Issue key': `T-${i}-${j}`,
        'Story Points': String(randomInt(rng, 1, 8)),
        Project: randomChoice(rng, projects),
      }));

      const eligibility = makeEligibility(assigneeNames, projects);
      const caps = {};
      assigneeNames.forEach(a => { caps[a] = randomInt(rng, 5, 25); });

      const result = generateSuggestions(tickets, eligibility, caps);

      // Sum SP assigned to each assignee
      const assignedSP = {};
      assigneeNames.forEach(a => { assignedSP[a] = 0; });

      for (const ticket of tickets) {
        const id = ticket['Issue key'];
        const assigned = result[id];
        if (assigned && assigned !== 'NO_SUGGESTION') {
          const sp = Math.max(parseFloat(ticket['Story Points']) || 0, 1);
          assignedSP[assigned] = (assignedSP[assigned] || 0) + sp;
        }
      }

      // Each assignee's total assigned SP must not exceed their original cap
      for (const a of assigneeNames) {
        expect(assignedSP[a]).toBeLessThanOrEqual(caps[a]);
      }
    }
  });

  // Property 8: Highest-capacity candidate selected
  // Feature: smart-ticket-allocation, Property 8: Suggestion Engine Selects Highest-Capacity Candidate
  // Validates: Requirements 3.4
  it('P8: selects highest-capacity eligible assignee (ties broken alphabetically)', () => {
    const rng = makePrng(4);
    const project = 'CC';

    for (let i = 0; i < ITERATIONS; i++) {
      const assigneeCount = randomInt(rng, 2, 5);
      const assigneeNames = Array.from({ length: assigneeCount }, (_, j) => `Assignee${String.fromCharCode(65 + j)}`);

      const caps = {};
      assigneeNames.forEach(a => { caps[a] = randomInt(rng, 5, 20); });

      const eligibility = makeEligibility(assigneeNames, [project]);

      const sp = randomInt(rng, 1, 4);
      const ticket = { 'Issue key': `T-${i}`, 'Story Points': String(sp), Project: project };

      const result = generateSuggestions([ticket], eligibility, caps);
      const assigned = result[`T-${i}`];

      // Find expected: highest cap among those with cap >= sp
      const eligible = assigneeNames.filter(a => caps[a] >= sp);
      if (eligible.length === 0) {
        expect(assigned).toBe('NO_SUGGESTION');
      } else {
        const maxCap = Math.max(...eligible.map(a => caps[a]));
        const topCandidates = eligible.filter(a => caps[a] === maxCap).sort();
        expect(assigned).toBe(topCandidates[0]);
      }
    }
  });

  // Property 9: NO_SUGGESTION when no eligible capacity
  // Feature: smart-ticket-allocation, Property 9: No Suggestion When No Eligible Capacity
  // Validates: Requirements 3.5, 3.8
  it('P9: NO_SUGGESTION when no assignee has sufficient eligible capacity', () => {
    const rng = makePrng(5);
    const projects = ['CC', 'WTR1', 'PROJ'];

    for (let i = 0; i < ITERATIONS; i++) {
      const project = randomChoice(rng, projects);
      const sp = randomInt(rng, 5, 13);
      const ticket = { 'Issue key': `T-${i}`, 'Story Points': String(sp), Project: project };

      // All assignees either ineligible or have insufficient capacity
      const eligibility = {
        Alice: new Set([project]),  // eligible but insufficient cap
        Bob: new Set(['OTHER']),    // ineligible
      };
      const caps = {
        Alice: sp - 1, // one less than needed
        Bob: 20,
      };

      const result = generateSuggestions([ticket], eligibility, caps);
      expect(result[`T-${i}`]).toBe('NO_SUGGESTION');
    }
  });
});
