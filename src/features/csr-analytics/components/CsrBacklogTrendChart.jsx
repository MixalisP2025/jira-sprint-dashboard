/**
 * @fileoverview CsrBacklogTrendChart — area chart showing cumulative open backlog
 * per ISO week, with spike annotations for weeks where net change exceeds +20.
 *
 * Requirements: 11.1–11.4
 */

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

/** Indigo-500 — backlog area fill and stroke */
const COLOR_BACKLOG = '#6366f1';
/** Amber-500 — spike annotation colour */
const COLOR_SPIKE = '#f59e0b';

/**
 * Area chart: cumulative open backlog per ISO week.
 *
 * Weeks where `netChange > 20` are annotated with a vertical `ReferenceLine`
 * and a label showing the net change value (e.g. "+23").
 *
 * @param {{
 *   data: { week: string, cumulative: number, netChange: number }[]
 * }} props
 */
export default function CsrBacklogTrendChart({ data = [] }) {
  /** Weeks that qualify as spikes (netChange > 20) */
  const spikeWeeks = data.filter((entry) => entry.netChange > 20);

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <p className="text-sm font-semibold text-slate-300 mb-3">
        Cumulative Backlog Trend
      </p>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
          No data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart
            data={data}
            margin={{ top: 16, right: 16, left: 0, bottom: 4 }}
          >
            <defs>
              <linearGradient id="backlogFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={COLOR_BACKLOG} stopOpacity={0.3} />
                <stop offset="95%" stopColor={COLOR_BACKLOG} stopOpacity={0.05} />
              </linearGradient>
            </defs>

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
              width={36}
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
              cursor={{ stroke: '#475569', strokeWidth: 1 }}
              formatter={(value, name, props) => {
                const netChange = props?.payload?.netChange;
                return [
                  <span key="val">
                    {value}
                    {netChange !== undefined && (
                      <span style={{ color: netChange > 0 ? COLOR_SPIKE : '#10b981', marginLeft: 6 }}>
                        ({netChange > 0 ? '+' : ''}{netChange} net)
                      </span>
                    )}
                  </span>,
                  'Cumulative',
                ];
              }}
            />

            {/* Spike annotations — one ReferenceLine per week where netChange > 20 */}
            {spikeWeeks.map((entry) => (
              <ReferenceLine
                key={`spike-${entry.week}`}
                x={entry.week}
                stroke={COLOR_SPIKE}
                strokeDasharray="4 2"
                label={{
                  value: `+${entry.netChange}`,
                  position: 'top',
                  fill: COLOR_SPIKE,
                  fontSize: 11,
                }}
              />
            ))}

            <Area
              type="monotone"
              dataKey="cumulative"
              stroke={COLOR_BACKLOG}
              strokeWidth={2}
              fill="url(#backlogFill)"
              fillOpacity={0.3}
              dot={false}
              activeDot={{ r: 5, fill: COLOR_BACKLOG, stroke: '#1e293b', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
