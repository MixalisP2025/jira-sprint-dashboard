// ─── Field accessors (consistent with rest of codebase) ──────────────────────
const getKey     = t => t['Issue key'] || t['Key'] || '';
const getSP      = t => parseFloat(t['Story Points']) || 0;
const getProject = t => t['Project'] || t['B'] || '';

/**
 * Greedy suggestion engine: assigns unassigned tickets to eligible assignees
 * with sufficient remaining capacity, largest tickets first.
 *
 * @param {Array}  unassignedTickets  - ticket objects with standard Jira fields
 * @param {Object} eligibility        - { [assigneeName]: Set<projectKey> }
 * @param {Object} remainingCap       - { [assigneeName]: number } SP remaining
 * @returns {Object}                  - { [ticketId]: assigneeName | 'NO_SUGGESTION' }
 */
export function generateSuggestions(unassignedTickets, eligibility, remainingCap) {
  const workingCap = { ...remainingCap };
  const result = {};

  // Greedy: largest tickets first to maximise utilisation
  const sorted = [...unassignedTickets].sort((a, b) => getSP(b) - getSP(a));

  for (const ticket of sorted) {
    const id = getKey(ticket);
    if (!id) continue;

    const sp = Math.max(getSP(ticket), 1); // treat 0 SP as 1
    const project = getProject(ticket);

    const candidates = Object.keys(workingCap)
      .filter(a => eligibility[a]?.has(project))
      .filter(a => workingCap[a] >= sp)
      // Primary: highest remaining cap; secondary: name alphabetically (determinism)
      .sort((a, b) => workingCap[b] - workingCap[a] || a.localeCompare(b));

    if (candidates.length > 0) {
      const chosen = candidates[0];
      result[id] = chosen;
      workingCap[chosen] -= sp;
    } else {
      result[id] = 'NO_SUGGESTION';
    }
  }

  return result;
}
