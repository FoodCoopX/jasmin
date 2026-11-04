import type { ColumnsType } from "antd/es/table";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ShareWeightsSummary } from "@shared/api/generated/models";
import { ReadOnlyReportTable } from "@shared/tables";
import { variationLabel } from "@shared/utils";
import {
  useNumberFormat,
  useShareTypeVariationSizeOptions,
} from "@hooks/index";

interface ShareWeightsSummaryTableProps {
  rows: ShareWeightsSummary[];
  /** Each size's chart colour, by the id of its first variation. */
  colorByVariation: Map<string, string>;
}

/**
 * The weight statistics' figures for the whole date range, one row per share
 * type size in the chart's order: how many boxes were weighed, their average
 * with the standard deviation between them, the target, and how much the
 * weighed boxes weighed over (+) or under (−) their targets in sum. Each size
 * wears its colour from the chart.
 */
export default function ShareWeightsSummaryTable({
  rows,
  colorByVariation,
}: ShareWeightsSummaryTableProps) {
  const { t } = useTranslation();
  const { format } = useNumberFormat();
  const { getShareTypeVariationSizeLabel } = useShareTypeVariationSizeOptions();

  const columns = useMemo<ColumnsType<ShareWeightsSummary>>(() => {
    const kilos = (value: string | null) =>
      value === null ? "—" : `${format(Number(value), 3)} kg`;
    const signedKilos = (value: string | null) => {
      if (value === null) return "—";
      const difference = Number(value);
      const sign = difference > 0 ? "+" : difference < 0 ? "−" : "";
      return `${sign}${format(Math.abs(difference), 3)} kg`;
    };
    return [
      {
        title: t("commissioning.statistics_share_weights_summary_size"),
        key: "size",
        render: (_, row) => (
          <span className="flex-center-y gap-8">
            <svg width="10" height="10" aria-hidden="true">
              <circle
                cx="5"
                cy="5"
                r="5"
                fill={colorByVariation.get(row.share_type_variation) ?? "currentColor"}
              />
            </svg>
            {variationLabel(
              row.share_type_name,
              getShareTypeVariationSizeLabel(row.size),
            )}
          </span>
        ),
      },
      {
        title: t("commissioning.statistics_share_weights_summary_weighed"),
        dataIndex: "weighed_boxes",
        key: "weighed_boxes",
        align: "right",
      },
      {
        title: t("commissioning.statistics_share_weights_summary_average"),
        key: "average",
        align: "right",
        render: (_, row) =>
          row.average_weight !== null && row.standard_deviation !== null
            ? `${format(Number(row.average_weight), 3)} ± ${format(Number(row.standard_deviation), 3)} kg`
            : kilos(row.average_weight),
      },
      {
        title: t("commissioning.statistics_share_weights_summary_target"),
        key: "target",
        align: "right",
        render: (_, row) => kilos(row.target_weight),
      },
      {
        title: t("commissioning.statistics_share_weights_summary_difference"),
        key: "difference",
        align: "right",
        render: (_, row) => signedKilos(row.total_difference_from_target),
      },
    ];
  }, [t, format, getShareTypeVariationSizeLabel, colorByVariation]);

  return (
    <ReadOnlyReportTable<ShareWeightsSummary>
      columns={columns}
      dataSource={rows}
      rowKey="share_type_variation"
      pagination={false}
      emptyText={t("commissioning.statistics_share_weights_no_data")}
    />
  );
}
