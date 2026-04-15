/**
 * @fileoverview CsrResolutionTrendChart — line chart showing median and average
 * resolution time (in days) per ISO week.
 *
 * Data points with fewer than 5 resolved tickets render a distinct hollow dot
 * with a dashed stroke, and the tooltip shows a "Low sample" warning.
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';

/** Violet-500 — median resolution days */
const COLOR_MEDIAN = '#8b5cf6';
/** Amber-500 — average resolution days */
const COLOR_AVG = '#f59e0b';

/**
 * Custom dot renderer for a line series.
 *
 * When `sampleSize < 5`, renders a hollow dot with a dashed stroke to signal
 * low statistical confidence. Otherwise renders a normal filled dot.
 *
 * @param {{ cx: number, cy: number, payload: object, color: string }} props
 */
function CustomDot({ cx, cy, payload, color }) {
  if (cx == null || cy == null) return null;

  const isLowSample = payload.sampleSize < 5;

  if (isLowSample) {
    return (
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill="transparent"
        stroke={color}
        strokeWidth={2}
        strokeDasharray="3 2"
      />
    );
  }

  return <circle cx={cx} cy={cy} r={3} fill={color} />;
}

/**
 * Custom tooltip content.
 *
 * Shows median and average values in days, plus a sample-size note.
 * When `sampleSize < 5`, the note is highlighted in amber with a warning icon.
 *
 * @param {{ active: boolean, payload: object[], label: string }} props
 */
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  const sampleSize = payload[0]?.payload?.sampleSize;

  return (
    <div
      style={{
        backgroundColor: '#1e293b',
        border: '1px solid #334155',
        borderRadius: 6,
        padding: '8px 12px',
        fontSize: 12,
        color: '#f1f5f9',
      }}
    >
      <p style={{ color: '#94a3b8', marginBottom: 4 }}>{label}</p>

      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value?.toFixed(1)} days
        </p>
      ))}

      {sampleSize !== undefined && (
        <p
          style={{
            color: sampleSize < 5 ? '#f59e0b' : '#94a3b8',
            marginTop: 4,
          }}
        >
          {sampleSize < 5 ? `⚠ Low sample (n=${sampleSize})` : `n=${sampleSize}`}
        </p>
      )}
    </div>
  );
}

/**
 * Line chart: median and average resolution time per ISO week.
 *
 * @param {{
 *   data: { week: string, median: number, avg: number, sampleSize: number }[],
 *   onDrilldown?: (filter: { dimension: string, value: string, label: string }) => void
 * }} props
 */
export default function CsrResolutionTrendChart({ data = [], onDrilldown }) {
  /**
   * Handles a click on a line data point.
   *
   * @param {{ week: string }} payload
   */
  function handleDotClick(payload) {
    if (!payload?.week) return;
    onDrilldown?.({
      dimension: 'week-resolution',
      value: payload.week,
      label: `Resolution trend: ${payload.week}`,
    });
  }

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-4">
      <p className="text-sm font-semibold text-slate-300 mb-3">
        Resolution Time Trend (days)
      </p>

      {data.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-slate-500 text-sm">
          No data available
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart
            data={data}
            margin={{ top: 4, right: 16, left: 0, bottom: 4 }}
            onClick={(chartData) => {
              if (chartData?.activePayload?.[0]?.payload) {
                handleDotClick(chartData.activePayload[0].payload);
              }
            }}
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
              width={36}
              tickFormatter={(v) => `${v}d`}
            />

            <Tooltip content={<CustomTooltip />} />

            <Legend
              wrapperStyle={{ fontSize: 12, color: '#94a3b8', paddingTop: 8 }}
            />

            {/* Median resolution line */}
            <Line
              type="monotone"
              dataKey="median"
              name="Median"
              stroke={COLOR_MEDIAN}
              strokeWidth={2}
              dot={(dotProps) => (
                <CustomDot
                  key={`median-dot-${dotProps.payload?.week}`}
                  {...dotProps}
                  color={COLOR_MEDIAN}
                />
              )}
              activeDot={{ r: 6, fill: COLOR_MEDIAN }}
            />

            {/* Average resolution line */}
            <Line
              type="monotone"
              dataKey="avg"
              name="Average"
              stroke={COLOR_AVG}
              strokeWidth={2}
              dot={(dotProps) => (
                <CustomDot
                  key={`avg-dot-${dotProps.payload?.week}`}
                  {...dotProps}
                  color={COLOR_AVG}
                />
              )}
              activeDot={{ r: 6, fill: COLOR_AVG }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
