import { Card, Spin, Typography } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCommissioningShareWeightsByWeekList } from "@shared/api/generated/commissioning/commissioning";
import type { ShareWeightsByWeek } from "@shared/api/generated/models";
import { useIsDarkTheme } from "@shared/contexts/LocaleContext";
import { ExplainerText, StatsBarChart } from "@shared/ui";
import type { StatsBarSeries } from "@shared/ui";
import {
  colorRamp,
  formatWeekKey,
  termWeekKeys,
  VARIATION_PALETTE,
  VARIATION_PALETTE_DARK,
  variationLabel,
} from "@shared/utils";
import {
  useNumberFormat,
  useShareTypeVariationSizeOptions,
} from "@hooks/index";
import StatisticsRangePicker from "../components/StatisticsRangePicker";
import { useStatisticsRange } from "../hooks/useStatisticsRange";

const { Text } = Typography;

/** One line of the chart: a size of a share type. A variation succeeding
 *  another of the same size within the range continues its line, as the
 *  share-weights CSV export keeps one column per share type and size. */
interface SizeSeries {
  /** The size's first variation in the server's order, which names the line,
   *  places it and gives it its id. */
  first: ShareWeightsByWeek;
  pointsByWeek: Map<string, ShareWeightsByWeek[]>;
}

/** Share types are told apart by name, as in the export; by id where a share
 *  type has none. */
const shareTypeKey = (point: ShareWeightsByWeek) =>
  point.share_type_name || point.share_type;

/** The sizes the range delivered, in the server's order (``variation_rank``). */
function sizeSeriesOf(points: ShareWeightsByWeek[]): SizeSeries[] {
  const bySize = new Map<string, SizeSeries>();
  const ordered = [...points].sort((a, b) => a.variation_rank - b.variation_rank);
  for (const point of ordered) {
    const key = `${shareTypeKey(point)}\u0000${point.size}`;
    const size = bySize.get(key) ?? { first: point, pointsByWeek: new Map() };
    bySize.set(key, size);
    const weekKey = `${point.year}-${point.week}`;
    size.pointsByWeek.set(weekKey, [
      ...(size.pointsByWeek.get(weekKey) ?? []),
      point,
    ]);
  }
  return [...bySize.values()];
}

/** A size's average in a week: the mean over the weighed shares of its
 *  variations delivered that week; null when none was weighed. */
function weekAverage(points: ShareWeightsByWeek[] | undefined): number | null {
  let total = 0;
  let weighed = 0;
  for (const point of points ?? []) {
    if (point.average_weight === null) continue;
    total += Number(point.average_weight) * point.weighed_shares;
    weighed += point.weighed_shares;
  }
  return weighed > 0 ? total / weighed : null;
}

/** A size's target in every week of the range: that week's variation's, and
 *  in a week without a delivery the one before (before the first delivery,
 *  the first one). The line so runs through the whole range, a size delivered
 *  in one week alone included, and steps where a successor changes it. */
function weekTargets(size: SizeSeries, weekKeys: string[]): (number | null)[] {
  const delivered = weekKeys.map((weekKey) => {
    const point = size.pointsByWeek.get(weekKey)?.[0];
    if (point === undefined) return undefined;
    return point.target_weight === null ? null : Number(point.target_weight);
  });
  let carried = delivered.find((target) => target !== undefined) ?? null;
  return delivered.map((target) => {
    if (target !== undefined) carried = target;
    return carried;
  });
}

/**
 * Office overview of the share weights: per ISO week over a date range, the
 * average weight of the weighed shares of each size of a share type packed in
 * boxes as a bar, with the size's target weight as a dashed line in the bar's
 * colour across the whole range. Each share type takes one hue of the
 * variation palette, its sizes shades of it; bars and legend follow the
 * server's order (``share_type_rank``, ``variation_rank``). Laid out like
 * the purchase statistics; the averages come from the weights recorded under
 * the boxes packing list, aggregated server-side (``share_weights_by_week``).
 */
export default function StatisticsShareWeights() {
  const { t } = useTranslation();
  const { format } = useNumberFormat();
  const { getShareTypeVariationSizeLabel } = useShareTypeVariationSizeOptions();
  const isDark = useIsDarkTheme();
  const { range, setRange, params } = useStatisticsRange();

  // Gated on ``range`` so we never fire with empty date params.
  const { data: rawData, isLoading } = useCommissioningShareWeightsByWeekList(
    params,
    { query: { enabled: !!range } },
  );

  const { chartData, series } = useMemo(() => {
    const sizes = sizeSeriesOf((rawData ?? []) as ShareWeightsByWeek[]);

    // Each share type takes one hue of the palette, its sizes shades of it.
    const palette = isDark ? VARIATION_PALETTE_DARK : VARIATION_PALETTE;
    const sizesByShareType = new Map<string, SizeSeries[]>();
    for (const size of sizes) {
      const key = shareTypeKey(size.first);
      sizesByShareType.set(key, [...(sizesByShareType.get(key) ?? []), size]);
    }
    const colorOf = new Map<SizeSeries, string>();
    for (const group of sizesByShareType.values()) {
      const base = palette[group[0].first.share_type_rank % palette.length];
      colorRamp(base, group.length, isDark).forEach((color, index) =>
        colorOf.set(group[index], color),
      );
    }

    // Bare ISO week number on the x-axis — "week/year" once the range spans
    // years, so the two weeks numbered 1 around a New Year stay apart. A week
    // nobody weighed, or that delivered nothing, holds a null average and
    // draws no bar.
    const weekKeys = range ? termWeekKeys(range[0], range[1]) : [];
    const spansYears =
      new Set(weekKeys.map((weekKey) => weekKey.split("-")[0])).size > 1;
    const chartData = weekKeys.map(
      (weekKey) =>
        ({
          key: weekKey,
          label: spansYears
            ? formatWeekKey(weekKey)
            : Number(weekKey.split("-")[1]),
        }) as Record<string, string | number | null>,
    );

    const series: StatsBarSeries[] = sizes.flatMap((size) => {
      const id = size.first.share_type_variation;
      const targets = weekTargets(size, weekKeys);
      chartData.forEach((row, index) => {
        row[`average_${id}`] = weekAverage(
          size.pointsByWeek.get(weekKeys[index]),
        );
        row[`target_${id}`] = targets[index];
      });
      const label = variationLabel(
        size.first.share_type_name,
        getShareTypeVariationSizeLabel(size.first.size),
      );
      const color = colorOf.get(size) ?? palette[0];
      return [
        { id: `average_${id}`, label, color },
        {
          id: `target_${id}`,
          label: t("commissioning.statistics_share_weights_target_of", {
            label,
          }),
          color,
          reference: true,
        },
      ];
    });
    return { chartData, series };
  }, [rawData, range, isDark, getShareTypeVariationSizeLabel, t]);

  return (
    <div>
      <h1>{t("commissioning.statistics_share_weights")}</h1>

      <Spin spinning={isLoading}>
        <StatisticsRangePicker
          value={range}
          onChange={setRange}
          ariaLabel={t("commissioning.statistics_share_weights_date_range")}
        />

        <Card
          className="dark-green-border mt-1em"
          title={t("commissioning.statistics_share_weights_chart_title")}
        >
          <Text type="secondary">
            {t("commissioning.statistics_share_weights_target_hint")}
          </Text>
          <StatsBarChart
            data={chartData}
            series={series}
            height={320}
            emptyText={t("commissioning.statistics_share_weights_no_data")}
            // Each variation is named in the legend, even when it is the
            // only one.
            showLegend
            valueFormatter={(value) => `${format(value, 3)} kg`}
            axisFormatter={(value) => format(value, 1)}
            // Several thin bars share a week.
            maxBarSize={12}
            ariaLabel={t("commissioning.statistics_share_weights_chart_title")}
            xHeader={t("commissioning.KW")}
            rowKey="key"
            showAllXLabels
          />
        </Card>
      </Spin>

      <ExplainerText title={t("common.info")}>
        {t("explainers.statistics_share_weights")}
      </ExplainerText>
    </div>
  );
}
