import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useCommissioningShareArticleNetPricesList } from "@shared/api/generated/commissioning/commissioning";
import type { CommissioningShareArticleNetPricesListParams } from "@shared/api/generated/models";
import ExportCsvAtDateModal, { type PriceColumn } from "./ExportCsvAtDateModal";
import { useSharePriceCsvColumns } from "./useSharePriceCsvColumns";

interface ExportCsvPricesShareArticleProps {
  open: boolean;
  onClose: () => void;
  /** Export only the extra articles' prices instead of every article's. */
  extrasOnly?: boolean;
}

/**
 * Row supplier: the share-article net-prices endpoint annotates each row with
 * the joined `share_article_name` and filters to prices active at the given
 * date. Gated on `loadedDate` so nothing is fetched before Load.
 */
function usePriceRowsAtDate(
  loadedDate: string | null,
  filter: Pick<CommissioningShareArticleNetPricesListParams, "is_extra">,
) {
  const { data, isLoading } = useCommissioningShareArticleNetPricesList(
    { active_at_date: loadedDate ?? "", ...filter },
    { query: { enabled: !!loadedDate } },
  );
  return {
    rows: (data ?? null) as unknown as Record<string, unknown>[] | null,
    isLoading,
  };
}

function useShareArticlePriceRowsAtDate(loadedDate: string | null) {
  return usePriceRowsAtDate(loadedDate, {});
}

function useExtraArticlePriceRowsAtDate(loadedDate: string | null) {
  return usePriceRowsAtDate(loadedDate, { is_extra: true });
}

export default function ExportCsvPricesShareArticle({
  open,
  onClose,
  extrasOnly = false,
}: ExportCsvPricesShareArticleProps) {
  const { t } = useTranslation();
  const priceColumns = useSharePriceCsvColumns();

  // Standalone price export keys the row's name off the annotated
  // `share_article_name` (the prices endpoint joins it onto each
  // ShareArticleNetPrice row).
  const columns: PriceColumn[] = useMemo(
    () => [
      { key: "share_article_name", label: t("commissioning.name") },
      ...priceColumns,
    ],
    [t, priceColumns],
  );

  return (
    <ExportCsvAtDateModal
      open={open}
      onClose={onClose}
      title={t("commissioning.export_prices_for_date")}
      filenamePrefix={t("commissioning.prices")}
      columns={columns}
      useRows={
        extrasOnly
          ? useExtraArticlePriceRowsAtDate
          : useShareArticlePriceRowsAtDate
      }
    />
  );
}
