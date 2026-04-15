/**
 * @fileoverview CsrSlaHealthChart — stacked bar chart showing SLA health per ISO week.
 *
 * Each bar is split into three segments: on-track (green), at-risk (amber),
 * and breaching (red). Clicking a segment fires an `onDrilldown` callback
 * with the week and SLA state.
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';

/** Emerald-500 — on-track tickets */
const COLOR_ON_TRACK = '#10b981';
/** Amber-500 — at-risk tickets */
const COLOR_AT_RISK = '#f59e0b';
/** Red-500 — breaching tickets */
const COLOR_BREACHING = '#ef4444';

/**
 * Stacked bar chart: SLA health (on-track / at-risk / breaching) per ISO week.
 *
 * @param {{
 *   data: { week: string, onTrack: number, atRisk: number, breaching: number }[],
 *   onDrilldown?: (filter: { dimension: string, value: { week: string, slaState: string }, label: string }) => void
 * }} props
 */
export default function CsrSlaHealthChart({ data = [], onDrilldown }) {
  /**
   * Handles a click on a stacked bar segment.
   *
   * @param {'on-track' | 'at-risk' | 'breaching'} slaState
   * @param {{ week: string }} entry  - the data entry for the clicked bar
   */
  function handleBarClick(slaState, entry) {
    onDrilldown?.({
      dimension: 'week-sla',
      value: { week: entry.week, slaState },
      label: `${slaState} in ${entry.week}`,
    });
  }

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <p className="text-sm font-semibold text-slate-300 mb-3">SLA Health per Week</p>

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
                borderRadius: 6,
                fontSize: 12,
              }}
              labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
              cursor={{ fill: 'rgba(148,163,184,0.06)' }}
            />

            <Legend
              wrapperStyle={{ fontSize: 12, color: '#94a3b8', paddingTop: 8 }}
            />

            {/* On-track segment */}
            <Bar
              dataKey="onTrack"
              name="On Track"
              stackId="sla"
              fill={COLOR_ON_TRACK}
              onClick={(entry) => handleBarClick('on-track', entry)}
              style={{ cursor: 'pointer' }}
            />

            {/* At-risk segment */}
            <Bar
              dataKey="atRisk"
              name="At Risk"
              stackId="sla"
              fill={COLOR_AT_RISK}
              onClick={(entry) => handleBarClick('at-risk', entry)}
              style={{ cursor: 'pointer' }}
            />

            {/* Breaching segment */}
            <Bar
              dataKey="breaching"
              name="Breaching"
              stackId="sla"
              fill={COLOR_BREACHING}
              radius={[3, 3, 0, 0]}
              onClick={(entry) => handleBarClick('breaching', entry)}
              style={{ cursor: 'pointer' }}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
