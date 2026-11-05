import { Card, Spin, Typography } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCommissioningPurchaseCostByWeekList } from "@shared/api/generated/commissioning/commissioning";
import type { PurchaseCostByWeek } from "@shared/api/generated/models";
import { ExplainerText, StatsBarChart } from "@shared/ui";
import { formatWeekKey } from "@shared/utils";
import { useCurrency } from "@hooks/index";
import StatisticsRangePicker from "../components/StatisticsRangePicker";
import { useStatisticsRange } from "../hooks/useStatisticsRange";

const { Text } = Typography;

/**
 * Office overview of purchase ("Zukauf") spending: total money bought-in per
 * ISO week over a date range, as a bar per week. Mirrors DashboardAbos — a
 * fiscal-year RangePicker + a dark-green Card holding the chart. The figures
 * are the same per-week purchase totals shown on the harvest-share-planning
 * page, aggregated server-side (``purchase_cost_by_week``).
 */
export default function StatisticsPurchase() {
  const { t } = useTranslation();
  const { formatCurrency } = useCurrency();
  const { range, setRange, params } = useStatisticsRange();

  // Gated on ``range`` so we never fire with empty date params.
  const { data: rawData, isLoading } = useCommissioningPurchaseCostByWeekList(
    params,
    { query: { enabled: !!range } },
  );

  const { chartData, series, total } = useMemo(() => {
    const points = (rawData ?? []) as PurchaseCostByWeek[];
    // Bare ISO week number on the x-axis (the selected range is shown in the
    // picker above) — "week/year" once the range spans years, so the two
    // weeks numbered 1 around a New Year stay apart. ``amount`` is a 2dp
    // money string on the wire.
    const spansYears = new Set(points.map((point) => point.year)).size > 1;
    const chartData = points.map((point) => ({
      key: `${point.year}-${point.week}`,
      label: spansYears
        ? formatWeekKey(`${point.year}-${point.week}`)
        : point.week,
      amount: parseFloat(point.amount) || 0,
    }));
    const total = chartData.reduce((sum, point) => sum + point.amount, 0);
    const series = [
      {
        id: "amount",
        label: t("commissioning.statistics_purchase_series"),
        // Recharts writes the colour into the bars' SVG ``fill`` attribute,
        // where the browser resolves the token per theme.
        color: "var(--color-chart-money)",
      },
    ];
    return { chartData, series, total };
  }, [rawData, t]);

  return (
    <div>
      <h1>{t("commissioning.statistics_purchase")}</h1>

      <Spin spinning={isLoading}>
        <StatisticsRangePicker
          value={range}
          onChange={setRange}
          ariaLabel={t("commissioning.statistics_purchase_date_range")}
        />

        {/* The totals are only as good as the prices entered in the planning /
            article-price screens — same data-quality caveat as the current-stock
            documentation page. */}
        <div className="alert-banner alert-banner-danger mt-1em">
          {t("commissioning.statistics_purchase_data_quality_warning")}
        </div>

        <Card
          className="dark-green-border mt-1em"
          title={t("commissioning.statistics_purchase_chart_title")}
        >
          <Text type="secondary">
            {t("commissioning.statistics_purchase_total", {
              total: formatCurrency(total),
            })}
          </Text>
          <StatsBarChart
            data={chartData}
            series={series}
            height={320}
            emptyText={t("commissioning.statistics_purchase_no_data")}
            valueFormatter={formatCurrency}
            // Accessible name for the chart SVG + caption/header for its
            // visually-hidden data table (per-week figures for screen readers).
            ariaLabel={t("commissioning.statistics_purchase_chart_title")}
            xHeader={t("commissioning.KW")}
            rowKey="key"
            // Weeks with no buy-in (e.g. delivery-exception weeks): a dark-grey
            // baseline stub bar, with their x-axis week number one step greyer.
            // Show every week number, not just recharts' auto-thinned subset.
            showEmptyBars
            muteEmptyLabels
            showAllXLabels
          />
        </Card>
      </Spin>

      <ExplainerText title={t("common.info")}>
        {t("explainers.statistics_purchase")}
      </ExplainerText>
    </div>
  );
}
