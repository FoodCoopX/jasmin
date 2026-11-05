import { useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  commissioningSharesPartialUpdate,
  getCommissioningSharesListQueryKey,
  useCommissioningSharesList,
} from "@shared/api/generated/commissioning/commissioning";
import type {
  CommissioningSharesListParams,
  Share,
} from "@shared/api/generated/models";
import { useRoles } from "@shared/auth";
import { ExportCsvShareWeights } from "@features/commissioning/modals";
import {
  EditableTable,
  gatedByPermissionOnlyEdit,
  wrapApiFunctions,
} from "@shared/tables";
import type {
  ApiFunctions,
  EditableColumnConfig,
  TableRecord,
} from "@shared/tables/BasicEditableTable/types";
import { ExplainerText } from "@shared/ui";
import {
  useInvalidateAfterTableMutation,
  useIsMobile,
  useNumberFormat,
  useShareTypeVariationSizeOptions,
  useTenant,
} from "@hooks/index";

type ShareRow = Share & TableRecord;

interface ShareWeightsSectionProps {
  year: number;
  week: number;
  /** The delivery day the shares are packed for; ``null`` while the week's
   *  days are still loading, or in a week without any. */
  deliveryDayId: string | null;
}

/**
 * Up to four sample weights of each share packed for one delivery day, next
 * to the share size's target weight and the average of the weights taken,
 * recorded inline by the office; plus the CSV export of the average weights
 * over a date range. Shown under the boxes packing list, for the week and day
 * picked there.
 */
export default function ShareWeightsSection({
  year,
  week,
  deliveryDayId,
}: ShareWeightsSectionProps) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { format } = useNumberFormat();
  const { getShareTypeVariationSizeLabel } = useShareTypeVariationSizeOptions();
  // Writes here are office-only on the backend (ShareViewSet, IsOffice);
  // `canEdit` would offer gardener/staff a save the API refuses.
  const { isOffice } = useRoles();
  const permissions = useMemo(
    () => gatedByPermissionOnlyEdit(isOffice),
    [isOffice],
  );
  const [csvExportVisible, setCsvExportVisible] = useState(false);
  const { getSetting } = useTenant();
  const packingMode = getSetting("packing_mode", "BOXES");

  // Only boxes are weighed, as the boxes list above packs them: physical
  // variations, and in mixed packing not the ones packed in bulk.
  const listParams = useMemo<CommissioningSharesListParams>(
    () => ({
      year,
      delivery_week: week,
      delivery_day: deliveryDayId ?? "",
      physical: true,
      ...(packingMode === "MIXED" ? { is_packed_bulk: false } : {}),
    }),
    [year, week, deliveryDayId, packingMode],
  );
  const queryClient = useQueryClient();

  // React Query — failures route through the global queryCache.onError
  // toast. Writes call `invalidateData()` to trigger a refetch.
  const { data: rawData, isFetching } = useCommissioningSharesList(listParams, {
    query: { enabled: deliveryDayId !== null },
  });
  const data = useMemo<ShareRow[]>(
    () =>
      ((rawData ?? []) as unknown as Share[]).map((item) => ({
        ...item,
        key: item.id ?? "",
      })),
    [rawData],
  );
  const invalidateData = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: getCommissioningSharesListQueryKey(listParams),
    });
  }, [queryClient, listParams]);
  const { onSaveSuccess, onDeleteSuccess } =
    useInvalidateAfterTableMutation(invalidateData);

  const apiFunctions = useMemo<ApiFunctions>(
    () =>
      wrapApiFunctions<Share & TableRecord>({
        update: (id, payload) => commissioningSharesPartialUpdate(id, payload),
      }),
    [],
  );

  const columns: EditableColumnConfig<ShareRow>[] = useMemo(
    () => [
      {
        title: "",
        dataIndex: "share_type_name",
        key: "share_label",
        readOnly: true,
        width: "14em",
        render: (_: unknown, record: ShareRow) => {
          const typeName = record.share_type_name ?? "";
          const sizeLabel = getShareTypeVariationSizeLabel(
            record.share_type_variation_size ?? "",
          );
          // lint-allow: no-raw-decimal — both args are display strings, not numbers.
          return `${typeName} ${sizeLabel}`.trim();
        },
      },
      {
        title: t("commissioning.target_weight"),
        dataIndex: "share_type_variation_average_weight",
        key: "target_weight",
        readOnly: true,
        disabled: true,
        width: "8em",
        align: "center",
        render: (_: unknown, record: ShareRow) => {
          const val = Number(record.share_type_variation_average_weight);
          return val > 0 ? `${format(val, 3)} kg` : "";
        },
      },
      ...[1, 2, 3, 4].map(
        (n): EditableColumnConfig<ShareRow> => ({
          title: `${t("commissioning.weight")} ${n}`,
          dataIndex: `weight${n}`,
          key: `weight${n}`,
          inputType: "decimal3",
          width: "8em",
          align: "center",
          render: (_: unknown, record: ShareRow) => {
            const val = Number(record[`weight${n}`]);
            return val > 0 ? format(val, 3) : "";
          },
        }),
      ),
      {
        title: "⌀",
        dataIndex: "weight_avg",
        key: "weight_avg",
        width: "8em",
        align: "center",
        readOnly: true,
        render: (_: unknown, record: ShareRow) => {
          const weights = [
            record.weight1,
            record.weight2,
            record.weight3,
            record.weight4,
          ]
            .map(Number)
            .filter((v) => v > 0);
          if (weights.length === 0) return "";
          const avg = weights.reduce((sum, v) => sum + v, 0) / weights.length;
          return `${format(avg, 2)} kg`;
        },
      },
    ],
    [t, getShareTypeVariationSizeLabel, format],
  );

  return (
    <div className="section-divider--lg">
      <h2>{t("commissioning.share_weights")}</h2>

      {deliveryDayId !== null && (
        <EditableTable
          key={`${year}-${week}-${deliveryDayId}`}
          columns={columns}
          apiFunctions={apiFunctions}
          initialData={data}
          onSaveSuccess={onSaveSuccess}
          onDeleteSuccess={onDeleteSuccess}
          loading={isFetching}
          className="w-max custom-jasmin-table"
          permissions={permissions}
        />
      )}
      {!isMobile && (
        <>
          <ExplainerText title={t("common.info")}>
            {t("explainers.share_weights")}
          </ExplainerText>
          <div className="section-divider">
            <Button
              onClick={() => setCsvExportVisible(true)}
              className="download-button"
            >
              {t("commissioning.csv_export_average_weight")}
            </Button>
          </div>
          <ExportCsvShareWeights
            open={csvExportVisible}
            onClose={() => setCsvExportVisible(false)}
          />
        </>
      )}
    </div>
  );
}
