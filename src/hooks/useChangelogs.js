import { useEffect, useMemo, useState } from 'react';
import { jiraService } from '../utils/jiraService';

// Jira change history (status, assignee and sprint moves) for a set of issue keys, shared
// across tabs: one module-level cache, so Sprint Review and the PM Dashboard never fetch
// the same ticket twice in a session.
const changelogCache = new Map();

/**
 * Returns { status: 'idle' | 'loading' | 'loaded' | 'error', byKey: Map | null, error }.
 * Loading/loaded is derived from the cache, so the effect only sets state when a fetch
 * returns. Keys Jira returned nothing for are cached as null and never refetched.
 */
export function useChangelogs(keys) {
  const sorted = useMemo(() => [...new Set((keys || []).filter(Boolean))].sort(), [keys]);
  const keySig = sorted.join(',');
  const [fetchState, setFetchState] = useState({ tick: 0, errorSig: null, error: null });

  useEffect(() => {
    const missing = sorted.filter(k => !changelogCache.has(k));
    if (!missing.length) return undefined;
    let cancelled = false;
    jiraService.getChangelogs(missing)
      .then(res => {
        for (const c of res.changelogs) changelogCache.set(c.key, c);
        for (const k of missing) if (!changelogCache.has(k)) changelogCache.set(k, null);
        if (!cancelled) setFetchState(s => ({ tick: s.tick + 1, errorSig: null, error: null }));
      })
      .catch(e => { if (!cancelled) setFetchState(s => ({ ...s, errorSig: keySig, error: e.message })); });
    return () => { cancelled = true; };
  }, [sorted, keySig]);

  return useMemo(() => {
    if (!sorted.length) return { status: 'idle', byKey: new Map(), error: null };
    if (fetchState.errorSig === keySig) return { status: 'error', byKey: null, error: fetchState.error };
    if (sorted.some(k => !changelogCache.has(k))) return { status: 'loading', byKey: null, error: null };
    return { status: 'loaded', byKey: new Map(sorted.map(k => [k, changelogCache.get(k)]).filter(([, v]) => v)), error: null };
    // fetchState is the signal that the cache changed
  }, [sorted, keySig, fetchState]);
}
