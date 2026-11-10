/**
 * "Which reseller got the offer email when" table under the Offers
 * page. Pure presentation; the sending-status query lives in
 * ``useOffersData``.
 */

import { CheckCircleOutlined, CloseCircleOutlined } from "@ant-design/icons";
import { useTranslation } from "react-i18next";
import type { OfferSendingStatus } from "@shared/api/generated/models";
import { EditableTable, READ_ONLY_PERMISSION } from "@shared/tables";
import type {
  EditableColumnConfig,
  TableRecord,
} from "@shared/tables/BasicEditableTable/types";
import { useDateFormat } from "@hooks/index";

export default function OfferSendingStatusTable({
  sendingStatus,
  loading,
}: {
  sendingStatus: OfferSendingStatus[];
  loading: boolean;
}) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();

  const rows: TableRecord[] = sendingStatus.map((record) => ({
    ...record,
    key: record.id,
  }));

  const columns: EditableColumnConfig<TableRecord>[] = [
    {
      title: t("commissioning.reseller"),
      dataIndex: "name",
      key: "name",
      width: "22em",
    },
    {
      title: t("commissioning.offer_sent"),
      dataIndex: "sent_at",
      key: "sent_at",
      align: "left",
      width: "24em",
      render: (_: unknown, record: TableRecord) =>
        // Status must not be conveyed by colour alone — the icon is
        // aria-hidden and a visible text label (the date carries a sr-only
        // "sent" prefix; the not-sent state shows its label) makes it readable.
        record.sent_at ? (
          <div className="text-label-sm mt-4">
            <CheckCircleOutlined
              className="text-success text-18"
              aria-hidden="true"
            />
            <span className="sr-only">{t("commissioning.offer_sent")}: </span>
            {formatDate(record.sent_at as string)}
          </div>
        ) : (
          <div className="text-label-sm mt-4">
            <CloseCircleOutlined
              className="text-error text-18"
              aria-hidden="true"
            />
            {t("commissioning.offer_not_sent")}
          </div>
        ),
    },
  ];

  return (
    <div className="mt-2em mb-2em">
      <EditableTable
        columns={columns}
        initialData={rows}
        loading={loading}
        permissions={READ_ONLY_PERMISSION}
        className="custom-jasmin-table offer-sending-status-table"
      />
    </div>
  );
}
