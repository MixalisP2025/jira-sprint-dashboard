import { DEFAULT_MANUAL_FILTERS } from '../utils/csrAnalyticsConstants.js';

/**
 * Active filter chip bar for the CSR Analytics page.
 *
 * Renders one chip per active ManualFilter dimension (value differs from the
 * default) and one chip per DrilldownFilter. Each chip has a dismiss × button.
 * A "Clear all" button is shown when ≥ 2 chips are visible.
 * Returns null (no wrapper element) when no chips are active.
 *
 * @param {{
 *   filters: import('../utils/csrAnalyticsTypes').ManualFilters,
 *   drilldowns: Array<{dimension: string, value: any, label?: string}>,
 *   onResetDimension: (key: string) => void,
 *   onClearDrilldownDimension: (key: string) => void,
 *   onClearAll: () => void
 * }} props
 */
export default function CsrAnalyticsActiveChips({
  filters,
  drilldowns,
  onResetDimension,
  onClearDrilldownDimension,
  onClearAll,
}) {
  // ── Build the list of active ManualFilter chips ───────────────────────────

  /** @type {Array<{ key: string, label: string }>} */
  const manualChips = [];

  if (filters.dateRange.start !== DEFAULT_MANUAL_FILTERS.dateRange.start) {
    manualChips.push({ key: 'dateRange.start', label: `From: ${filters.dateRange.start}` });
  }

  if (filters.dateRange.end !== DEFAULT_MANUAL_FILTERS.dateRange.end) {
    manualChips.push({ key: 'dateRange.end', label: `To: ${filters.dateRange.end}` });
  }

  if (filters.project !== DEFAULT_MANUAL_FILTERS.project) {
    manualChips.push({ key: 'project', label: `Project: ${filters.project}` });
  }

  if (filters.bank !== DEFAULT_MANUAL_FILTERS.bank) {
    manualChips.push({ key: 'bank', label: `Bank: ${filters.bank}` });
  }

  if (filters.assignee !== DEFAULT_MANUAL_FILTERS.assignee) {
    manualChips.push({ key: 'assignee', label: `Assignee: ${filters.assignee}` });
  }

  if (filters.status !== DEFAULT_MANUAL_FILTERS.status) {
    manualChips.push({ key: 'status', label: `Status: ${filters.status}` });
  }

  if (filters.issueType !== DEFAULT_MANUAL_FILTERS.issueType) {
    manualChips.push({ key: 'issueType', label: `Type: ${filters.issueType}` });
  }

  if (filters.includeLegacy !== DEFAULT_MANUAL_FILTERS.includeLegacy) {
    manualChips.push({ key: 'includeLegacy', label: 'Including legacy' });
  }

  if (filters.ticketScope !== DEFAULT_MANUAL_FILTERS.ticketScope) {
    manualChips.push({ key: 'ticketScope', label: `Scope: ${filters.ticketScope}` });
  }

  // ── Total chip count ──────────────────────────────────────────────────────

  const totalChips = manualChips.length + drilldowns.length;

  // ── Return null when no chips are active ─────────────────────────────────

  if (totalChips === 0) {
    return null;
  }

  // ── Shared chip class ─────────────────────────────────────────────────────

  const chipClass =
    'flex items-center gap-1 px-2 py-1 text-xs bg-indigo-900/50 border border-indigo-700 text-indigo-200 rounded-full';

  const dismissClass = 'text-indigo-400 hover:text-indigo-200 ml-1 font-bold';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-wrap items-center gap-2 px-6 py-2 bg-slate-800/50 border-b border-slate-700">

      {/* ManualFilter chips */}
      {manualChips.map(({ key, label }) => (
        <span key={key} className={chipClass}>
          {label}
          <button
            type="button"
            className={dismissClass}
            onClick={() => onResetDimension(key)}
            aria-label={`Remove filter: ${label}`}
          >
            ×
          </button>
        </span>
      ))}

      {/* DrilldownFilter chips */}
      {drilldowns.map((drilldown) => {
        const label =
          drilldown.label != null
            ? drilldown.label
            : `${drilldown.dimension}: ${JSON.stringify(drilldown.value)}`;

        return (
          <span key={drilldown.dimension} className={chipClass}>
            {label}
            <button
              type="button"
              className={dismissClass}
              onClick={() => onClearDrilldownDimension(drilldown.dimension)}
              aria-label={`Remove drilldown: ${label}`}
            >
              ×
            </button>
          </span>
        );
      })}

      {/* Clear all button — only when ≥ 2 chips */}
      {totalChips >= 2 && (
        <button
          type="button"
          className="text-xs text-slate-400 hover:text-slate-200 underline"
          onClick={onClearAll}
        >
          Clear all
        </button>
      )}

    </div>
  );
}
