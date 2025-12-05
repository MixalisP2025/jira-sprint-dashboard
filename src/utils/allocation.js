export function computeSuggestionsDetailed(filteredData = [], stats = {}, denyWhenMissing = false) {
  const normalize = (s) => {
    if (!s) return '';
    return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  };
  // Build unique items by issue id to avoid duplicates coming from the export
  const itemsMap = new Map();
  filteredData.forEach((item, idx) => {
    const id = item['Issue key'] || item['Key'] || idx;
    const key = String(id);
    const spVal = parseFloat(item['Story Points']) || 0;
    if (itemsMap.has(key)) {
      // aggregate story points and merge metadata for duplicate rows
      const existing = itemsMap.get(key);
      existing.sp = (existing.sp || 0) + spVal;
      // prefer an explicit project if we don't have one yet
      if ((!existing.project || existing.project === '') && (item['Project'] || item['E'])) {
        existing.project = item['Project'] || item['E'] || existing.project;
      }
      // merge summaries (avoid exact duplicates)
      const newSummary = item['Summary'] || item['Issue summary'] || '';
      if (newSummary && newSummary !== existing.summary) {
        existing.summary = `${existing.summary}${existing.summary ? ' | ' : ''}${newSummary}`;
      }
      // keep the first assignee (assume same issue key has same assignee)
      existing._raw = existing._raw || item;
      itemsMap.set(key, existing);
      return;
    }
    // detect parent / subtask information when available
    const issueType = (item['Issue Type'] || item['Type'] || '').toString();
    const parentKey = item['Parent'] || item['Parent Key'] || item['Parent Id'] || item['Parent ID'] || item['ParentIssue'] || item['Parent Issue'] || null;
    const isSubtask = issueType.toLowerCase().includes('sub');

    itemsMap.set(key, {
      id: id,
      assignee: item['Assignee'] || item['D'] || 'Unassigned',
      sp: spVal,
      summary: item['Summary'] || item['Issue summary'] || '',
      project: item['Project'] || item['E'] || '',
      _raw: item,
      parent: parentKey || null,
      isSubtask: !!isSubtask,
    });
  });
  const items = Array.from(itemsMap.values());

  const over = [];
  const under = [];

  Object.entries(stats).forEach(([assignee, aData]) => {
    const cap = aData.sprintCapacity || 14;
    const used = aData.capacityUsed || 0;
    const diff = used - cap;
    if (diff > 0) over.push({ assignee, overflow: diff });
    else if (diff < 0) under.push({ assignee, slack: -diff });
  });

  over.sort((a, b) => b.overflow - a.overflow);
  under.sort((a, b) => b.slack - a.slack);

  const suggestionsLocal = [];
  // track which issue ids we've already suggested (prevent duplicate suggestions across overs)
  const alreadySuggested = new Set(suggestionsLocal.map((s) => String(s.id)));
  const rejections = [];

  for (const o of over) {
    const candidates = items
      .filter((it) => it.assignee === o.assignee && it.sp > 0)
      .sort((a, b) => b.sp - a.sp);

    for (const c of candidates) {
      if (alreadySuggested.has(String(c.id))) continue;

      // compute eligible vs allowed candidate counts for diagnostics/UI
      const projNorm = c.project ? normalize(c.project) : '';
      const eligibleCandidates = under.filter((u) => u.slack >= c.sp).map((u) => u.assignee);
      // No uploaded mapping support: allow any eligible candidate
      const allowedCandidates = eligibleCandidates;

      if (allowedCandidates.length === 0) {
        // No eligible under-capacity candidates available for this item
        continue;
      }

      // find the first allowed under index (preferring largest slack)
      const targetIdx = under.findIndex((u) => allowedCandidates.includes(u.assignee) && u.slack >= c.sp);
      if (targetIdx >= 0) {
        const target = under[targetIdx];
        suggestionsLocal.push({
          id: c.id,
          from: o.assignee,
          to: target.assignee,
          sp: c.sp,
          summary: c.summary,
          project: c.project || '',
          isSubtask: !!c.isSubtask,
          eligibleCount: eligibleCandidates.length,
          allowedCount: allowedCandidates.length,
          eligibleCandidates: Array.from(eligibleCandidates),
          allowedCandidates: Array.from(allowedCandidates),
        });
        alreadySuggested.add(String(c.id));
        under[targetIdx].slack -= c.sp;
        o.overflow -= c.sp;
        if (under[targetIdx].slack <= 0) under.splice(targetIdx, 1);
        if (o.overflow <= 0) break;
      }
    }
  }

  return { suggestions: suggestionsLocal, rejections };
}

// Backwards-compatible wrapper used by tests and existing callers
export function computeSuggestions(filteredData = [], stats = {}) {
  const res = computeSuggestionsDetailed(filteredData, stats, false);
  return res.suggestions;
}

export function computeWhatIfProjection(stats = {}, multiplier = 1) {
  const totalSP = Object.values(stats).reduce((s, a) => s + (a.totalStoryPoints || 0), 0);
  const completedSP = Object.values(stats).reduce((s, a) => s + (a.completedStoryPoints || 0), 0);
  const currentCapacity = Object.values(stats).reduce((s, a) => s + (a.sprintCapacity || 0), 0);
  const projectedCapacity = Object.values(stats).reduce((s, a) => s + ((a.sprintCapacity || 0) * multiplier), 0);
  const currentUsed = Object.values(stats).reduce((s, a) => s + (a.capacityUsed || 0), 0);

  const additional = Math.max(0, projectedCapacity - currentUsed);
  const potentialDone = completedSP + additional;
  const projectedCompletion = totalSP > 0 ? Math.min(100, (potentialDone / totalSP) * 100) : 0;
  return { totalSP, completedSP, currentCapacity, projectedCapacity, projectedCompletion };
}

// Compute per-project progress for a given sprint name
export function computeSprintProjectProgress(allData = [], sprintName = 'all') {
  const sprintFilter = (item) => {
    if (!sprintName || sprintName === 'all') return true;
    const s = item['Sprint'] || item['G'] || '';
    return String(s) === String(sprintName);
  };

  const isParentIssue = (item) => {
    const t = (item['Issue Type'] || item['Type'] || '').toString().toLowerCase();
    if (!t) return false;
    if (t.includes('sub')) return false;
    return t.includes('story') || t.includes('task') || t.includes('bug') || t.includes('epic');
  };

  // Deduplicate by issue key to avoid double-counting rows for the same issue
  const unique = new Map();
  (allData || []).forEach((raw, idx) => {
    if (!sprintFilter(raw) || !isParentIssue(raw)) return;
    const issueKey = raw['Issue key'] || raw['Key'] || raw['Issue Key'] || String(idx);
    const k = String(issueKey || '').trim();
    const spVal = parseFloat(raw['Story Points'] || raw['SP'] || 0) || 0;
    const status = (raw['Status'] || '').toString().toLowerCase();
    const resolution = (raw['Resolution'] || '').toString().toLowerCase();
    const done = status === 'done' || resolution === 'done';

    if (!unique.has(k)) {
      const projectName = (raw['Project'] || raw['E'] || 'No Project') || 'No Project';
      const projectKey = raw['Project key'] || raw['Project Key'] || raw['ProjectKey'] || '';
      unique.set(k, {
        id: k,
        project: projectName,
        projectKey: projectKey,
        sp: spVal,
        done: !!done,
      });
    } else {
      const existing = unique.get(k);
      // prefer a non-empty project
      if ((!existing.project || existing.project === 'No Project') && (raw['Project'] || raw['E'])) {
        existing.project = raw['Project'] || raw['E'] || existing.project;
      }
      // prefer a non-empty projectKey if available
      const rawProjectKey = raw['Project key'] || raw['Project Key'] || raw['ProjectKey'] || '';
      if ((!existing.projectKey || existing.projectKey === '') && rawProjectKey) existing.projectKey = rawProjectKey;
      // prefer a non-zero story point value (do not sum duplicates)
      if ((!existing.sp || existing.sp === 0) && spVal > 0) existing.sp = spVal;
      // if any duplicate row marks it done, treat the issue as done
      if (done) existing.done = true;
      unique.set(k, existing);
    }
  });

  const map = new Map();
  Array.from(unique.values()).forEach((it) => {
    const projectRaw = it.project || 'No Project';
    const project = String(projectRaw).trim() || 'No Project';
    const key = project;
    if (!map.has(key)) {
      map.set(key, { project: key, projectKey: it.projectKey || '', totalItems: 0, doneItems: 0, totalSP: 0, completedSP: 0 });
    }
    const entry = map.get(key);
    entry.totalItems += 1;
    if (it.done) entry.doneItems += 1;
    const sp = parseFloat(it.sp || 0) || 0;
    entry.totalSP += sp;
    if (it.done) entry.completedSP += sp;
  });

  const arr = Array.from(map.values()).map((e) => {
    const remainingSP = Math.max(0, e.totalSP - e.completedSP);
    const percentSP = e.totalSP > 0 ? (e.completedSP / e.totalSP) * 100 : null;
    const percentCount = e.totalItems > 0 ? (e.doneItems / e.totalItems) * 100 : 0;
    return { ...e, remainingSP, percentSP, percentCount };
  });

  arr.sort((a, b) => (b.totalSP || 0) - (a.totalSP || 0));
  return arr;
}
