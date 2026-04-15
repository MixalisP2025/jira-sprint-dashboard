/**
 * @fileoverview CsrCreatedResolvedChart — grouped bar chart showing created vs resolved
 * tickets per ISO week.
 *
 * Supports drill-down: clicking a bar highlights that series and reduces the other
 * to 0.3 opacity. A second click on the same bar deselects it.
 */

import { useState } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from 'recharts';

/** Blue-500 — created tickets */
const COLOR_CREATED = '#3b82f6';
/** Emerald-500 — resolved tickets */
const COLOR_RESOLVED = '#10b981';

/**
 * Grouped bar chart: created vs resolved tickets per ISO week.
 *
 * @param {{
 *   data: { week: string, created: number, resolved: number }[],
 *   onDrilldown?: (filter: { dimension: string, value: string, label: string }) => void
 * }} props
 */
export default function CsrCreatedResolvedChart({ data = [], onDrilldown }) {
  /**
   * Tracks which bar series + week is currently highlighted.
   * Shape: { dimension: 'week-created' | 'week-resolved', value: string } | null
   */
  const [activeDrilldown, setActiveDrilldown] = useState(null);

  /**
   * Handles a click on a bar cell.
   *
   * @param {'week-created' | 'week-resolved'} dimension
   * @param {{ week: string }} entry  - the data entry for the clicked bar
   */
  function handleBarClick(dimension, entry) {
    const week = entry.week;
    const isActive =
      activeDrilldown?.dimension === dimension && activeDrilldown?.value === week;

    if (isActive) {
      // Toggle off — deselect
      setActiveDrilldown(null);
    } else {
      setActiveDrilldown({ dimension, value: week });
      onDrilldown?.({
        dimension,
        value: week,
        label: `${dimension === 'week-created' ? 'Created' : 'Resolved'} in ${week}`,
      });
    }
  }

  /**
   * Returns the opacity for a given bar cell.
   *
   * - No active drilldown → full opacity (1)
   * - Active drilldown on this dimension → full opacity for the active week, 0.4 for others
   * - Active drilldown on the OTHER dimension → 0.3 for all cells in this series
   *
   * @param {'week-created' | 'week-resolved'} dimension
   * @param {string} week
   * @returns {number}
   */
  function getCellOpacity(dimension, week) {
    if (!activeDrilldown) return 1;

    if (activeDrilldown.dimension === dimension) {
      // Same series: highlight the active week, dim others
      return activeDrilldown.value === week ? 1 : 0.4;
    }

    // Other series is active → dim this entire series
    return 0.3;
  }

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <p className="text-sm font-semibold text-slate-300 mb-3">Created vs Resolved per Week</p>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
          No data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart
            data={data}
            margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
            barCategoryGap="25%"
            barGap={2}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />

            <XAxis
              dataKey="week"
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={{ stroke: '#334155' }}
              tickLine={false}
            />

            <YAxis
              tick={{ fill: '#94a3b8', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={32}
            />

            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                color: '#f1f5f9',
                borderRadius: '6px',
                fontSize: 12,
              }}
              labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
              cursor={{ fill: 'rgba(148,163,184,0.06)' }}
            />

            <Legend
              wrapperStyle={{ fontSize: 12, color: '#94a3b8', paddingTop: 8 }}
            />

            {/* Created bars */}
            <Bar
              dataKey="created"
              name="Created"
              fill={COLOR_CREATED}
              radius={[3, 3, 0, 0]}
              onClick={(entry) => handleBarClick('week-created', entry)}
              style={{ cursor: 'pointer' }}
            >
              {data.map((entry) => (
                <Cell
                  key={`created-${entry.week}`}
                  fill={COLOR_CREATED}
                  opacity={getCellOpacity('week-created', entry.week)}
                />
              ))}
            </Bar>

            {/* Resolved bars */}
            <Bar
              dataKey="resolved"
              name="Resolved"
              fill={COLOR_RESOLVED}
              radius={[3, 3, 0, 0]}
              onClick={(entry) => handleBarClick('week-resolved', entry)}
              style={{ cursor: 'pointer' }}
            >
              {data.map((entry) => (
                <Cell
                  key={`resolved-${entry.week}`}
                  fill={COLOR_RESOLVED}
                  opacity={getCellOpacity('week-resolved', entry.week)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
