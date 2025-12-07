import { describe, it, expect } from 'vitest';
import { computeSuggestions, computeWhatIfProjection } from '../utils/allocation';

describe('allocation helpers', () => {
  it('returns no suggestions when there is no over/under', () => {
    const filteredData = [
      { 'Issue key': '1', Assignee: 'A', 'Story Points': '3' },
      { 'Issue key': '2', Assignee: 'B', 'Story Points': '2' },
    ];

    const stats = {
      A: { sprintCapacity: 14, capacityUsed: 3 },
      B: { sprintCapacity: 14, capacityUsed: 2 },
    };

    const suggestions = computeSuggestions(filteredData, stats);
    expect(suggestions).toHaveLength(0);
  });

  it('moves large items from over to under when slack exists', () => {
    const filteredData = [
      { 'Issue key': '1', Assignee: 'A', 'Story Points': '3', Summary: 'Big task' },
      { 'Issue key': '2', Assignee: 'A', 'Story Points': '1', Summary: 'Small task' },
    ];

    const stats = {
      A: { sprintCapacity: 14, capacityUsed: 18 }, // overflow 4
      B: { sprintCapacity: 14, capacityUsed: 10 }, // slack 4
    };

    const suggestions = computeSuggestions(filteredData, stats);
    expect(suggestions.length).toBeGreaterThan(0);
    // first suggestion should move largest SP item from A to B
    const first = suggestions[0];
    expect(first.from).toBe('A');
    expect(first.to).toBe('B');
    expect(first.sp).toBe(3);
  });

  it('handles fractional story points and computes projections', () => {
    const stats = {
      A: { sprintCapacity: 10, capacityUsed: 4, totalStoryPoints: 10, completedStoryPoints: 2 },
      B: { sprintCapacity: 8, capacityUsed: 6, totalStoryPoints: 8, completedStoryPoints: 1 },
    };

    const p = computeWhatIfProjection(stats, 1.2);
    expect(p.totalSP).toBe(18);
    expect(p.completedSP).toBe(3);
    expect(p.projectedCapacity).toBeCloseTo((10 + 8) * 1.2);
    expect(typeof p.projectedCompletion).toBe('number');
  });
});
