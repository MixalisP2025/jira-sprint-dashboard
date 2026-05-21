/**
 * @fileoverview CsrKpiCard — a single KPI metric card for the CSR Analytics dashboard.
 *
 * Displays a value prominently, a label below it, and an optional delta badge
 * coloured by tone (good / danger / neutral).
 */

import { formatDelta } from '../utils/csrAnalyticsFormatters.js';

/**
 * Tone-to-Tailwind class map for the delta badge.
 */
const TONE_CLASSES = {
  good:    'bg-green-900/50 text-green-400 border border-green-700',
  danger:  'bg-red-900/50 text-red-400 border border-red-700',
  neutral: 'bg-slate-700 text-slate-400 border border-slate-600',
};

/**
 * A single KPI metric card.
 *
 * @param {{
 *   label: string,
 *   value: string | number | null,
 *   delta: number | null,
 *   tone: 'good' | 'danger' | 'neutral',
 *   lowerIsBetter?: boolean,
 *   onClick?: () => void,
 *   active?: boolean
 * }} props
 */
export default function CsrKpiCard({ label, value, delta, tone = 'neutral', lowerIsBetter, onClick, active }) {
  const badgeClasses = TONE_CLASSES[tone] ?? TONE_CLASSES.neutral;
  const displayValue = value === null || value === undefined ? '—' : value;

  return (
    <div
      onClick={onClick}
      className={`bg-slate-800 border rounded-xl p-4 flex flex-col items-center text-center transition-all ${onClick ? 'cursor-pointer hover:bg-slate-700 hover:shadow-lg' : ''} ${active ? 'ring-2 ring-indigo-500 border-indigo-400' : 'border-slate-700'}`}
    >
      {/* Value */}
      <span className="text-2xl font-bold text-slate-100">{displayValue}</span>

      {/* Label */}
      <span className="text-xs text-slate-400 mt-1">{label}</span>

      {/* Delta badge — only rendered when delta is non-null */}
      {delta !== null && delta !== undefined && (
        <span className={`mt-2 inline-block text-xs font-medium px-2 py-0.5 rounded-full ${badgeClasses}`}>
          {formatDelta(delta)}
        </span>
      )}

      {/* Active indicator */}
      {active && <div className="text-xs text-indigo-400 mt-1 font-semibold">✓ filtered</div>}
    </div>
  );
}
