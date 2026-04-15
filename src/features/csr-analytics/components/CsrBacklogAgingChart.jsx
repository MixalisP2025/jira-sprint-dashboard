/**
 * @fileoverview CsrBacklogAgingChart — horizontal bar chart showing open backlog
 * ticket counts grouped by age bucket.
 *
 * Bars are coloured with a green-to-red gradient (youngest → oldest) using
 * `CHART_COLORS.gradient` from the shared constants module.
 *
 * Requirements: 12.1–12.5
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

import { CHART_COLORS } from '../utils/csrAnalyticsConstants.js';

/**
 * Colour gradient for age buckets.
 * Index 0 = 0–7 days (green), Index 4 = 90+ days (red).
 *
 * @type {string[]}
 */
const AGE_BUCKET_COLORS = CHART_COLORS.gradient;

/**
 * Horizontal bar chart: open backlog ticket counts per age bucket.
 *
 * @param {{
 *   data: { bucket: string, count: number }[],
 *   onDrilldown?: (filter: { dimension: string, value: string, label: string }) => void
 * }} props
 */
export default function CsrBacklogAgingChart({ data = [], onDrilldown }) {
  /**
   * Handles a click on an age-bucket bar.
   *
   * @param {{ bucket: string }} entry - the data entry for the clicked bar
   */
  function handleBarClick(entry) {
    onDrilldown?.({
      dimension: 'age-bucket',
      value: entry.bucket,
      label: entry.bucket,
    });
  }

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <p className="text-sm font-semibold text-slate-300 mb-3">Backlog Aging</p>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
          No data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
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

            {/* Y-axis: age bucket labels */}
            <YAxis
              type="category"
              dataKey="bucket"
              width={80}
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
              formatter={(value) => [value, 'Open tickets']}
            />

            <Bar
              dataKey="count"
              radius={[0, 3, 3, 0]}
              onClick={handleBarClick}
              style={{ cursor: 'pointer' }}
            >
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${entry.bucket}`}
                  fill={AGE_BUCKET_COLORS[index % AGE_BUCKET_COLORS.length]}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
