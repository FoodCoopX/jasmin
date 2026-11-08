import { Card, DatePicker, Divider, Spin, Typography } from "antd";
import dayjs from "dayjs";
import { ExplainerText, StatsAreaChart } from "@shared/ui";
import { ReadOnlyReportTable } from "@shared/tables";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  useCommissioningAbosList,
  useCommissioningShareTypeVariationsList,
} from "@shared/api/generated/commissioning/commissioning";
import { usePaymentsChargeSchedulesIncomeByMonthList } from "@shared/api/generated/payments-—-charge-schedule/payments-—-charge-schedule";
import {
  buildMonthlyActiveByVariation,
  useSubscriptionVariationStats,
} from "@features/abos/hooks/useSubscriptionVariationStats";
import { useVariationReferencePrices } from "@features/abos/hooks/useVariationReferencePrices";
import { buildMonthlyIncomeSeries } from "@features/abos/utils/incomeSeries";
import {
  buildSolidarityPriceRows,
  type PriceRow,
} from "@features/abos/utils/solidarityPriceRows";
import {
  useCurrency,
  useDateFormat,
  useDateRangePresets,
  useFiscalYearRangeState,
  useShareTypeVariationSizeOptions,
  useTenant,
} from "@hooks/index";

const { RangePicker } = DatePicker;
const { Text } = Typography;

export default function DashboardAbos() {
  const { t } = useTranslation();
  const { formatCurrency } = useCurrency();
  const { dateFormat, formatDateForAPI } = useDateFormat();
  const presets = useDateRangePresets();
  const { getSetting } = useTenant();
  const { getShareTypeVariationSizeLabel } = useShareTypeVariationSizeOptions();

  // The average-vs-reference price comparison is only meaningful when members
  // can pay different amounts for the same variation — i.e. solidarity pricing.
  const allowsSolidarity = !!getSetting("allows_solidarity_pricing", false);

  // Default window: the tenant's current fiscal year (1st of
  // ``fiscal_year_start_month`` → one year).
  const [range, setRange] = useFiscalYearRangeState();

  const { data: subscriptions, isLoading } = useCommissioningAbosList({});
  // Fetched for stable per-variation labels + colours (order taken from the
  // catalogue, not from whichever subscriptions happen to exist). Every
  // physical size, ended ones too, so a past range draws the sizes it had.
  const { data: variations } = useCommissioningShareTypeVariationsList({
    physical: true,
  });
  const { referencePricesOn } = useVariationReferencePrices();

  const { variationLegendById } = useSubscriptionVariationStats(
    subscriptions,
    variations,
  );

  // One line per variation: active subscription quantity per month.
  const { data: chartData, series } = useMemo(
    () =>
      buildMonthlyActiveByVariation(subscriptions, variationLegendById, range),
    [subscriptions, variationLegendById, range],
  );

  // Billed income (sum of due amounts) per month, over the same range — the
  // backend aggregates it (exact Decimal SUM) so only the monthly points cross
  // the wire. Gated on ``range`` so we never fire with empty date params.
  const incomeParams = useMemo(
    () => ({
      date_from: range ? (formatDateForAPI(range[0]) ?? "") : "",
      date_to: range ? (formatDateForAPI(range[1]) ?? "") : "",
    }),
    [range, formatDateForAPI],
  );
  const { data: incomeData } = usePaymentsChargeSchedulesIncomeByMonthList(
    incomeParams,
    { query: { enabled: !!range } },
  );
  // Income is a single series, so it takes the money colour rather than one
  // of the per-variation palette colours.
  const income = useMemo(
    () =>
      buildMonthlyIncomeSeries(
        incomeData ?? [],
        range,
        {
          id: "income",
          label: t("statistics.income"),
          color: "var(--color-chart-money)",
        },
      ),
    [incomeData, range, t],
  );
  // Solidarity: prices actually paid per variation for subs STARTED in range.
  const paidPricesByVariation = useMemo(() => {
    const rows = subscriptions ?? [];
    const from = range ? range[0].startOf("day") : null;
    const to = range ? range[1].endOf("day") : null;
    const inRange = (validFrom: string) => {
      if (!from || !to) return true;
      const d = dayjs(validFrom);
      return !d.isBefore(from) && !d.isAfter(to);
    };
    const map = new Map<string, number[]>();
    for (const s of rows) {
      if (s.on_waiting_list || !s.valid_from || !inRange(s.valid_from))
        continue;
      const price = parseFloat(s.price_per_delivery || "0");
      if (price > 0) {
        const arr = map.get(s.share_type_variation) ?? [];
        arr.push(price);
        map.set(s.share_type_variation, arr);
      }
    }
    return map;
  }, [subscriptions, range]);

  const priceRows = useMemo<PriceRow[]>(
    () =>
      allowsSolidarity
        ? buildSolidarityPriceRows(variations ?? [], {
            range: range
              ? [formatDateForAPI(range[0])!, formatDateForAPI(range[1])!]
              : null,
            paidPricesByVariation,
            referencePriceOn: (variation, date) =>
              referencePricesOn(
                {
                  value: variation.id ?? "",
                  active_price_per_delivery: variation.active_price_per_delivery,
                },
                date,
              ).regular,
            nameOf: (variation) =>
              [variation.share_type_name, getShareTypeVariationSizeLabel(variation.size)]
                .filter(Boolean)
                .join(" · "),
          })
        : [],
    [
      allowsSolidarity,
      variations,
      range,
      formatDateForAPI,
      referencePricesOn,
      paidPricesByVariation,
      getShareTypeVariationSizeLabel,
    ],
  );

  const priceColumns = useMemo(
    () => [
      { title: t("statistics.col_variation"), dataIndex: "name", key: "name" },
      {
        title: t("statistics.col_reference_price"),
        dataIndex: "reference",
        key: "reference",
        align: "right" as const,
        render: (v: number) => formatCurrency(v),
      },
      {
        title: t("statistics.col_avg_paid"),
        dataIndex: "avg",
        key: "avg",
        align: "right" as const,
        render: (v: number | null) => (v == null ? "—" : formatCurrency(v)),
      },
    ],
    [t, formatCurrency],
  );

  return (
    <div>
      <h1>{t("statistics.abos_title")}</h1>

      <Spin spinning={isLoading}>
        <RangePicker
          value={range}
          onChange={(v) => setRange(v && v[0] && v[1] ? [v[0], v[1]] : null)}
          presets={presets}
          format={dateFormat}
          allowClear={false}
        />
        <Card
          className="dark-green-border mt-1em"
          title={t("statistics.chart_active_subscriptions_by_variation")}
        >
          <Text type="secondary">
            {t("statistics.chart_active_subscriptions_by_variation")}
          </Text>
          <StatsAreaChart
            data={chartData}
            series={series}
            height={320}
            emptyText={t("statistics.no_subscription_data")}
          />
        </Card>

        {allowsSolidarity && (
          <Card
            className="dark-green-border mt-1em"
            title={t("statistics.solidarity_title")}
          >
            <ReadOnlyReportTable<PriceRow>
              rowKey="id"
              pagination={false}
              columns={priceColumns}
              dataSource={priceRows}
              className="custom-jasmin-table solidarity-price-table"
              emptyText={t("statistics.no_subscription_data")}
            />
          </Card>
        )}

        <Card
          className="dark-green-border mt-1em"
          title={t("statistics.chart_income_by_month")}
        >
          <Text type="secondary">{t("statistics.chart_income_by_month")}</Text>
          <StatsAreaChart
            data={income.data}
            series={income.series}
            height={320}
            emptyText={t("statistics.no_income_data")}
          />
          <Typography.Paragraph
            type="secondary"
            className="mb-0 income-chart-hint"
          >
            {t("statistics.income_hint")}
          </Typography.Paragraph>
        </Card>
      </Spin>

      <ExplainerText title={t("common.info")}>
        {t("explainers.dashboard_abos")}
      </ExplainerText>
    </div>
  );
}
