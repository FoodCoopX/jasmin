/**
 * "Needed harvesting crates" summary under the HarvestingList table —
 * compact card on mobile, small bordered table on desktop. Pure
 * presentation; the aggregation lives in ``useHarvestingListData``.
 */

import type { CrateSummaryEntry } from "@features/commissioning/hooks/useHarvestingListData";
import { ToolTipIcon } from "@shared/ui";
import { ReadOnlyReportTable } from "@shared/tables";
import { Card } from "antd";
import { useTranslation } from "react-i18next";

export default function HarvestingCrateSummary({
  crateSummary,
  isMobile,
  showMobileCard,
}: {
  crateSummary: CrateSummaryEntry[];
  isMobile: boolean;
  /** Mobile renders the card only once the data has loaded and the list
   *  has rows. */
  showMobileCard: boolean;
}) {
  const { t } = useTranslation();

  if (isMobile) {
    if (!showMobileCard) return null;
    return (
      <Card
        size="small"
        className="harvesting-crate-summary-card"
        styles={{ body: { padding: "8px 12px" } }}
        title={
          <span className="text-label-sm">
            {t("commissioning.needed_harvesting_crates")}
          </span>
        }
      >
        {crateSummary.length === 0 ? (
          <div className="text-muted">{t("table.no_data")}</div>
        ) : (
          crateSummary.map((item) => (
            <div key={item.key} className="harvesting-crate-summary-row">
              <span className="font-medium">{item.crate_name}</span>
              <span className="font-semibold">{item.quantity}</span>
            </div>
          ))
        )}
      </Card>
    );
  }

  const columns = [
    {
      title: (
        <>
          {t("commissioning.needed_harvesting_crates")}
          <ToolTipIcon title={t("tooltip.needed_harvesting_crates")} />
        </>
      ),
      dataIndex: "crate_name",
      key: "crate_name",
      width: "14em",
    },
    {
      title: t("commissioning.quantity"),
      dataIndex: "quantity",
      key: "quantity",
      align: "center" as const,
      width: "8em",
    },
  ];

  return (
    <div className="mt-2em mb-2em">
      <ReadOnlyReportTable
        columns={columns}
        dataSource={crateSummary}
        pagination={false}
        className="compact-table custom-jasmin-table harvesting-crate-summary-table mt-1em"
      />
    </div>
  );
}
