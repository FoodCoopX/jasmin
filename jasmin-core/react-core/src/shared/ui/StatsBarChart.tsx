import { theme } from "antd";
import type { ReactElement, ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Rectangle,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BarShapeProps } from "recharts";
import EmptyHint from "./EmptyHint";

// Height of the dark-grey stub drawn for a zero-value bar, so an empty period
// stays visible on the baseline instead of leaving a blank gap.
const EMPTY_BAR_STUB_PX = 3;

/** Bar renderer that draws zero-value bars as a short dark-grey stub at the
 *  baseline and everything else as the normal rounded-top bar. */
const makeBarShape =
  (emptyFill: string) =>
  (props: BarShapeProps): ReactElement => {
    const raw = props.value;
    const numeric = Array.isArray(raw) ? raw[1] - raw[0] : raw;
    if (!numeric) {
      const baselineY = props.y;
      return (
        <Rectangle
          {...props}
          y={baselineY - EMPTY_BAR_STUB_PX}
          height={EMPTY_BAR_STUB_PX}
          fill={emptyFill}
          radius={0}
        />
      );
    }
    return <Rectangle {...props} radius={[4, 4, 0, 0]} />;
  };

export interface StatsBarSeries {
  /** Data-row key holding this series' value. */
  id: string;
  /** Legend / tooltip name (already translated). */
  label: string;
  /** Bar fill colour, or the line colour of a reference series. */
  color: string;
  /** A dashed line over the bars instead of a bar (e.g. a target), left out
   *  of the legend. A row without its value leaves a gap in the line. */
  reference?: boolean;
}

interface StatsBarChartProps {
  /** Rows keyed by `xKey` + each series id; `null` where a series has no
   *  value, which the data table leaves blank. */
  data: Array<Record<string, string | number | null>>;
  series: StatsBarSeries[];
  /** X-axis category key (default "label"). */
  xKey?: string;
  /** Key of the field that identifies each row uniquely (default `xKey`); set
   *  it when two rows can share a label. */
  rowKey?: string;
  height?: number;
  /** Shown when there is no non-zero data. */
  emptyText: ReactNode;
  /** Force the legend; defaults to showing it only for ≥ 2 series. */
  showLegend?: boolean;
  /** Formats bar values for the tooltip (e.g. currency). Raw number by default. */
  valueFormatter?: (value: number) => string;
  /** Formats the y-axis ticks (e.g. "2,5"). Raw number by default. */
  axisFormatter?: (value: number) => string;
  /** The widest a bar gets (default 48px); lower it for many bars per period. */
  maxBarSize?: number;
  /** Draw zero-value bars as a short dark-grey baseline stub instead of nothing,
   *  so empty periods stay visible. Off by default. */
  showEmptyBars?: boolean;
  /** Render the x-axis label of "empty" rows (every series 0) in a lighter grey
   *  than the normal tick colour — e.g. weeks with no spend. */
  muteEmptyLabels?: boolean;
  /** Force every category tick to render (recharts thins them by default). Use
   *  when each label matters (e.g. every ISO week). */
  showAllXLabels?: boolean;
  /** Accessible name for the chart. recharts marks the SVG as a focusable
   *  ``role="application"`` widget; without this it has no name. Also used as
   *  the caption of the visually-hidden data table. */
  ariaLabel?: string;
  /** Header for the category column of the visually-hidden data table
   *  (e.g. "Week"). Defaults to ``xKey``. */
  xHeader?: string;
}

/**
 * Shared discrete bar chart — a sum-per-bucket companion to {@link StatsAreaChart}.
 * Use it for summed, non-continuous quantities (money spent per week, counts per
 * period) where each bar is an independent total, not a point on a trend line.
 * Rounded bar tops, recessive token-coloured grid/axes, a per-bar hover tooltip,
 * and a legend only for ≥ 2 series (a single series is named by the card title).
 * Reference series (a target, say) are drawn as dashed lines over the bars.
 */
export default function StatsBarChart({
  data,
  series,
  xKey = "label",
  rowKey = xKey,
  height = 300,
  emptyText,
  showLegend,
  valueFormatter,
  axisFormatter,
  maxBarSize = 48,
  showEmptyBars = false,
  muteEmptyLabels = false,
  showAllXLabels = false,
  ariaLabel,
  xHeader,
}: StatsBarChartProps) {
  const { token } = theme.useToken();

  const bars = series.filter((s) => !s.reference);
  const references = series.filter((s) => s.reference);
  const hasData =
    bars.length > 0 &&
    data.some((d) => bars.some((s) => Number(d[s.id] ?? 0) !== 0));

  if (!hasData) {
    return <EmptyHint style={{ padding: "2em 0" }}>{emptyText}</EmptyHint>;
  }

  const axisTick = { fill: token.colorText, fontSize: 12 };
  const gridStroke = token.colorBorderSecondary;
  const tooltipStyle = {
    background: token.colorBgElevated,
    border: `1px solid ${token.colorBorderSecondary}`,
    borderRadius: token.borderRadius,
    boxShadow: token.boxShadowSecondary,
  } as const;
  const tooltipText = { color: token.colorText };
  const withLegend = showLegend ?? bars.length > 1;

  // Empty bars: a dark-grey baseline stub. Empty x-labels: a lighter grey.
  const emptyBarShape = showEmptyBars
    ? makeBarShape(token.colorTextTertiary)
    : undefined;

  // x-values whose every series value is 0 — their axis labels render one step
  // greyer (colorTextSecondary vs the normal colorText) so an empty period
  // (e.g. a delivery-exception week) reads as de-emphasised while STILL meeting
  // the 4.5:1 text-contrast minimum. Null when the feature is off (default tick
  // object).
  const emptyXValues = muteEmptyLabels
    ? new Set(
        data
          .filter((d) => bars.every((s) => Number(d[s.id] ?? 0) === 0))
          .map((d) => d[xKey]),
      )
    : null;

  // Reference lines need a composed chart; without them it stays a bar chart,
  // whose hover highlights the whole period.
  const Chart = references.length > 0 ? ComposedChart : BarChart;

  const renderMutedTick = (tickProps: {
    x?: string | number;
    y?: string | number;
    payload?: { value?: string | number };
  }): ReactElement => {
    const value = tickProps.payload?.value;
    const muted = emptyXValues?.has(value as string | number) ?? false;
    return (
      <text
        x={tickProps.x}
        y={tickProps.y}
        dy={12}
        textAnchor="middle"
        fontSize={12}
        fill={muted ? token.colorTextSecondary : token.colorText}
      >
        {value}
      </text>
    );
  };

  return (
    <>
      {/* Visually-hidden text equivalent so the per-bucket figures are
          available to screen readers, not only as visual bars / hover. */}
      <table className="sr-only">
        {ariaLabel ? <caption>{ariaLabel}</caption> : null}
        <thead>
          <tr>
            <th scope="col">{xHeader ?? xKey}</th>
            {series.map((s) => (
              <th key={s.id} scope="col">
                {s.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            <tr key={String(row[rowKey] ?? index)}>
              <th scope="row">{String(row[xKey] ?? "")}</th>
              {series.map((s) => {
                const raw = row[s.id];
                if (raw === null) return <td key={s.id} />;
                const value = Number(raw ?? 0);
                return (
                  <td key={s.id}>
                    {valueFormatter ? valueFormatter(value) : String(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ResponsiveContainer width="100%" height={height}>
        <Chart
          data={data}
          margin={{ top: 8, right: 8, left: -12, bottom: 0 }}
          aria-label={ariaLabel}
          barGap={2}
        >
          <CartesianGrid
          strokeDasharray="3 3"
          stroke={gridStroke}
          vertical={false}
        />
        <XAxis
          dataKey={xKey}
          tick={emptyXValues ? renderMutedTick : axisTick}
          axisLine={{ stroke: gridStroke }}
          tickLine={false}
          minTickGap={showAllXLabels ? 0 : 8}
          interval={showAllXLabels ? 0 : undefined}
        />
        <YAxis
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={
            axisFormatter ? (value) => axisFormatter(Number(value)) : undefined
          }
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipText}
          itemStyle={tooltipText}
          // A composed chart's cursor is a line, a bar chart's a band.
          cursor={
            references.length > 0
              ? { stroke: token.colorBorder, strokeWidth: 1 }
              : { fill: token.colorFillSecondary }
          }
          formatter={
            valueFormatter ? (value) => valueFormatter(Number(value)) : undefined
          }
        />
        {withLegend && <Legend />}
        {bars.map((s) => (
          <Bar
            key={s.id}
            dataKey={s.id}
            name={s.label}
            fill={s.color}
            radius={[4, 4, 0, 0]}
            maxBarSize={maxBarSize}
            shape={emptyBarShape}
          />
        ))}
        {references.map((s) => (
          <Line
            key={s.id}
            type="linear"
            dataKey={s.id}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            strokeDasharray="6 4"
            strokeLinecap="round"
            dot={false}
            activeDot={false}
            legendType="none"
          />
        ))}
        </Chart>
      </ResponsiveContainer>
    </>
  );
}
