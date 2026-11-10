import { Button } from "antd";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
  EditableColumnConfig,
  TableRecord,
} from "@shared/tables/BasicEditableTable/types";

export const useShareArticlePriceColumn = (handleOpenModal: (record: TableRecord) => void) => {
  const { t } = useTranslation();

  const priceModalColumn = useMemo<EditableColumnConfig<TableRecord>>(
    () => ({
      title: "",
      dataIndex: "actions",
      key: "actions",
      fixed: true,
      width: "6em",
      align: "center",
      readOnly: true,
      disabled: true,
      render: (_: unknown, record: TableRecord) => (
        <Button
          type="primary"
          size="small"
          onClick={() => handleOpenModal(record)}
          disabled={record.key === -1 || !record.id}
          title={t("commissioning.manage_prices")}
        >
          {t("commissioning.prices")}
        </Button>
      ),
    }),
    [handleOpenModal, t],
  );

  return priceModalColumn;
};
