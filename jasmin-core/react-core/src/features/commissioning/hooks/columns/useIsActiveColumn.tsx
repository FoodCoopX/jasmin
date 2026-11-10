import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type {
  EditableColumnConfig,
  TableRecord,
} from "@shared/tables/BasicEditableTable/types";
import ToolTipIcon from "@shared/ui/ToolTipIcon";

// A single stable reference for the no-args case. Without this, `options = {}`
// allocates a fresh object on every call, which would invalidate the inner
// useMemo and hand callers a brand-new column each render.
const EMPTY_OPTIONS: Partial<EditableColumnConfig<TableRecord>> = {};

export const useIsActiveColumn = (
  options: Partial<EditableColumnConfig<TableRecord>> = EMPTY_OPTIONS,
) => {
  const { t } = useTranslation();

  const isActiveColumn = useMemo<EditableColumnConfig<TableRecord>>(
    () => ({
      title: (
        <>
          {t("commissioning.is_active")}
          <ToolTipIcon title={t("tooltip.is_active_description")} />
        </>
      ),
      dataIndex: "is_active",
      key: "is_active",
      inputType: "checkbox",
      required: false,
      sortable: true,
      ...options,
    }),
    [t, options],
  );

  return isActiveColumn;
};
