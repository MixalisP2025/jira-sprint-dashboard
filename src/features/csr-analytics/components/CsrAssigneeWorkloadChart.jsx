/**
 * @fileoverview CsrAssigneeWorkloadChart — horizontal bar chart showing ticket
 * counts per assignee, with a three-button mode toggle (Open / Created / Resolved).
 *
 * Displays the top 8 assignees plus an aggregated "Other" bar. Aggregation is
 * performed upstream by `buildAssigneeWorkload`; this component is purely
 * presentational.
 *
 * Requirements: 14.1–14.5
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from 'recharts';

import { ASSIGNEE_COLORS, CHART_COLORS } from '../utils/csrAnalyticsConstants.js';

/**
 * Mode toggle button definitions.
 *
 * @type {Array<{ value: 'open'|'created'|'resolved', label: string }>}
 */
const modes = [
  { value: 'open',     label: 'Open'     },
  { value: 'created',  label: 'Created'  },
  { value: 'resolved', label: 'Resolved' },
];

/**
 * Returns the fill colour for a given assignee bar.
 * The "Other" bucket always uses the neutral slate colour; all other assignees
 * cycle through the `ASSIGNEE_COLORS` palette.
 *
 * @param {string} assignee - Assignee display name
 * @param {number} index    - Zero-based position in the data array
 * @returns {string} Hex colour string
 */
function getBarColor(assignee, index) {
  if (assignee === 'Other') return CHART_COLORS.other;
  return ASSIGNEE_COLORS[index % ASSIGNEE_COLORS.length];
}

/**
 * Horizontal bar chart: per-assignee ticket counts with a mode toggle.
 *
 * @param {{
 *   data: { assignee: string, count: number }[],
 *   mode: 'open' | 'created' | 'resolved',
 *   onModeChange: (mode: 'open' | 'created' | 'resolved') => void
 * }} props
 */
export default function CsrAssigneeWorkloadChart({ data = [], mode = 'open', onModeChange }) {
  /** Dynamic chart height: taller when there are more assignees. */
  const chartHeight = Math.max(200, data.length * 36 + 40);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      {/* Header row: title + mode toggle */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-slate-300">Assignee Workload</p>

        {/* Three-button mode toggle */}
        <div className="flex rounded overflow-hidden border border-slate-600">
          {modes.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => onModeChange?.(value)}
              className={
                value === mode
                  ? 'px-3 py-1 text-xs font-medium bg-indigo-600 text-white'
                  : 'px-3 py-1 text-xs font-medium bg-slate-700 text-slate-300 hover:bg-slate-600'
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
          No data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={chartHeight}>
          <BarChart
            layout="vertical"
            data={data}
            margin={{ top: 4, right: 24, left: 8, bottom: 4 }}
            barCategoryGap="20%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />

            {/* X-axis: numeric count values */}
            <XAxis
              type="number"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
            />

            {/* Y-axis: assignee names */}
            <YAxis
              type="category"
              dataKey="assignee"
              width={110}
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                color: '#f1f5f9',
                borderRadius: 6,
                fontSize: 12,
              }}
              labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
              cursor={{ fill: 'rgba(148,163,184,0.06)' }}
              formatter={(value) => [value, 'Tickets']}
            />

            <Bar dataKey="count" radius={[0, 3, 3, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${entry.assignee}`}
                  fill={getBarColor(entry.assignee, index)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
