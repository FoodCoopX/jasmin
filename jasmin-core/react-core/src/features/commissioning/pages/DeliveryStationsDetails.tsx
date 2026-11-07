import { useQueries } from "@tanstack/react-query";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  getCommissioningShareDeliveryDetailsMatrixRetrieveQueryOptions,
  useCommissioningShareDeliveryDetailsMatrixRetrieve,
} from "@shared/api/generated/commissioning/commissioning";
import type {
  CommissioningShareDeliveryDetailsMatrixRetrieveParams,
  PackingModeEnum,
  PackingBoxesMatrixColumn,
  StationMemberMatrix,
} from "@shared/api/generated/models";
import {
  ImportSharesModeBanner,
  StationContentsDownloads,
} from "@features/commissioning/components";
import { DeliveryStationDetailsPDFGenerator } from "@features/commissioning/pdfs";
import type { StationPageData } from "@features/commissioning/pdfs/exports/DeliveryStationDetailsPDF";
import { DaySelector, WeekSelector } from "@shared/selectors";
import { DeliveryStationSelector } from "@features/commissioning/selectors";
import type { TableRecord } from "@shared/tables/BasicEditableTable/types";
import { ExplainerText, PastWarningMessage, ToolTipIcon } from "@shared/ui";
import { ReadOnlyReportTable } from "@shared/tables";
import { useTenant, useYearWeekState } from "@hooks/index";
import {
  useBoxCombinationColumns,
  useDeliveryStations,
  useShareDeliveryDays,
  useStationSheetLabels,
  useWeekStationSlots,
} from "@features/commissioning/hooks";
import {
  activeAtDateForWeek,
  formatDayLabel,
  formatWeekLabel,
  generatePdfFilename,
} from "@shared/utils";

type StationQuery = { data?: unknown; isLoading: boolean };

/**
 * One PDF page per station and day that has pickups, the pickup matrix read
 * from the query at the same index. Null while any of them loads, or when no
 * station has pickups.
 */
function buildStationPages(
  stations: { stationName: string; dateLabel: string }[],
  matrixQueries: StationQuery[],
): StationPageData[] | null {
  if (stations.length === 0 || matrixQueries.some((query) => query.isLoading))
    return null;
  const pages = stations.flatMap((station, index) => {
    const matrix = matrixQueries[index]?.data as StationMemberMatrix | undefined;
    const rows = (matrix?.rows ?? []) as unknown as StationPageData["rows"];
    if (rows.length === 0) return [];
    return [{ ...station, columns: matrix?.columns ?? [], rows }];
  });
  return pages.length > 0 ? pages : null;
}

export default function DeliveryStationsDetails() {
  const { selectedYear, setSelectedYear, selectedWeek, setSelectedWeek } =
    useYearWeekState();
  const [selectedDeliveryDay, setSelectedDeliveryDay] = useState<number | null>(
    null,
  );
  const [selectedDeliveryStation, setSelectedDeliveryStation] = useState<
    string | null
  >(null);

  const { t } = useTranslation();
  const { tenantName, logoUrl, tenant, getSetting } = useTenant();
  const usesExternalDemand = getSetting(
    "uploads_weekly_share_amount",
    false,
  ) as boolean;

  // delivery days — derived purely from the selected year/week (no effect).
  const shareDeliveryDaysFilters = useMemo(
    () => ({
      active_at_date: activeAtDateForWeek(selectedYear, selectedWeek),
    }),
    [selectedYear, selectedWeek],
  );

  const { shareDeliveryDays, dayNumbers } = useShareDeliveryDays(
    shareDeliveryDaysFilters,
  );

  // Select the first delivery day when the selected day isn't one of them
  useEffect(() => {
    if (
      dayNumbers.length > 0 &&
      !dayNumbers.some((day) => day === selectedDeliveryDay)
    ) {
      setSelectedDeliveryDay(dayNumbers[0]);
    }
  }, [dayNumbers, selectedDeliveryDay]);

  const isQueryEnabled =
    selectedDeliveryDay !== null && selectedDeliveryStation !== null;

  // --- Combination matrix (members × box combinations) for the table AND
  // the pickup-list PDFs — both render the same box-combination columns. ---
  const matrixParams =
    useMemo<CommissioningShareDeliveryDetailsMatrixRetrieveParams>(
      () => ({
        year: selectedYear,
        delivery_week: selectedWeek,
        day_number: selectedDeliveryDay ?? 0,
        delivery_station: selectedDeliveryStation ?? "",
      }),
      [selectedYear, selectedWeek, selectedDeliveryDay, selectedDeliveryStation],
    );
  const {
    data: matrix,
    isFetching: matrixFetching,
    isError: matrixError,
  } = useCommissioningShareDeliveryDetailsMatrixRetrieve(matrixParams, {
      query: { enabled: isQueryEnabled },
    });
  const matrixColumns = useMemo<PackingBoxesMatrixColumn[]>(
    () => (isQueryEnabled ? (matrix?.columns ?? []) : []),
    [isQueryEnabled, matrix],
  );
  const matrixRows = useMemo<TableRecord[]>(
    () =>
      isQueryEnabled ? ((matrix?.rows ?? []) as unknown as TableRecord[]) : [],
    [isQueryEnabled, matrix],
  );
  const comboColumns = useBoxCombinationColumns(matrixColumns);
  const loading = isQueryEnabled && matrixFetching;
  // A failed load is shown as such, never as a station nobody collects at.
  const matrixFailed = isQueryEnabled && !loading && matrixError;

  // Compute selectedDeliveryDayId early (needed for station selector and bulk PDFs)
  const selectedDeliveryDayId = useMemo(() => {
    if (selectedDeliveryDay === null) {
      return null;
    }
    const deliveryDay = shareDeliveryDays.find(
      (day) => day.day_number === selectedDeliveryDay,
    );
    return deliveryDay?.id ?? null;
  }, [selectedDeliveryDay, shareDeliveryDays]);

  // Fetch all delivery stations for the selected day (for bulk PDFs)
  const { deliveryStations } = useDeliveryStations(
    selectedDeliveryDayId ? { delivery_day: selectedDeliveryDayId } : {},
  );

  // Bulk fetch: the combination matrix for every station on the selected day,
  // fired once the day's stations are known — independent of the station on
  // screen, which may have nobody collecting. Each result carries that
  // station's own columns + member rows.
  const allStationsDayQueries = useQueries({
    queries:
      selectedDeliveryDay !== null && deliveryStations.length > 0
        ? deliveryStations.map((station) =>
            getCommissioningShareDeliveryDetailsMatrixRetrieveQueryOptions({
              year: selectedYear,
              delivery_week: selectedWeek,
              day_number: selectedDeliveryDay,
              delivery_station: station.value,
            }),
          )
        : [],
  });

  const weekSlots = useWeekStationSlots(dayNumbers, shareDeliveryDays);

  // Bulk fetch: the combination matrix for every station on every day of the
  // week it serves.
  const allStationsWeekQueries = useQueries({
    queries: weekSlots.map(({ dayNum, station }) =>
      getCommissioningShareDeliveryDetailsMatrixRetrieveQueryOptions({
        year: selectedYear,
        delivery_week: selectedWeek,
        day_number: dayNum,
        delivery_station: station.value,
      }),
    ),
  });

  const selectedStation = deliveryStations.find(
    (s) => s.value === selectedDeliveryStation,
  );
  const selectedStationName = selectedStation?.label ?? "";

  const { tints, dateLabel } = useStationSheetLabels(selectedYear, selectedWeek);

  // Build PDF pages for the current station — reuses the already-fetched
  // matrix.
  const currentStationPages = useMemo<StationPageData[] | null>(() => {
    if (
      !selectedDeliveryStation ||
      selectedDeliveryDay === null ||
      matrixRows.length === 0
    )
      return null;
    return [
      {
        stationName: selectedStationName,
        dateLabel: dateLabel(selectedDeliveryDay),
        columns: matrixColumns,
        rows: matrixRows as unknown as StationPageData["rows"],
      },
    ];
  }, [
    selectedDeliveryStation,
    selectedDeliveryDay,
    selectedStationName,
    dateLabel,
    matrixColumns,
    matrixRows,
  ]);

  // Build PDF pages for all stations on the selected day.
  const allStationsDayPages = useMemo(
    () =>
      selectedDeliveryDay === null
        ? null
        : buildStationPages(
            deliveryStations.map((station) => ({
              stationName: station.label,
              dateLabel: dateLabel(selectedDeliveryDay),
            })),
            allStationsDayQueries,
          ),
    [allStationsDayQueries, deliveryStations, selectedDeliveryDay, dateLabel],
  );

  // Build PDF pages for all stations across all days in the week.
  const allStationsWeekPages = useMemo(
    () =>
      buildStationPages(
        weekSlots.map(({ dayNum, station }) => ({
          stationName: station.label,
          dateLabel: dateLabel(dayNum),
        })),
        allStationsWeekQueries,
      ),
    [allStationsWeekQueries, weekSlots, dateLabel],
  );

  // With one delivery day in the week, the week's PDFs would be the day's.
  const hasSeveralDeliveryDays = dayNumbers.length > 1;
  const packingMode = getSetting("packing_mode", "BOXES") as PackingModeEnum;

  // Tenant info for PDF header
  const tenantInfo = useMemo(
    () => ({
      name: tenantName,
      logoUrl,
      email: (tenant?.email as string) || "",
      phone: (tenant?.phone_number as string) || "",
    }),
    [tenantName, logoUrl, tenant],
  );

  const columns = useMemo<ColumnsType<any>>(() => {
    const baseColumns: ColumnsType<any> = [
      {
        title: t("commissioning.pickup_name"),
        dataIndex: "name",
        key: "name",
        align: "left",
        width: "15em",
        fixed: "left",
        render: (text: string) => <strong>{text || "-"}</strong>,
      },
    ];

    return [
      ...baseColumns,
      // The SAME combination columns the packing boxes matrix uses. Cast:
      // EditableColumnConfig is a superset of Ant's column type.
      ...(comboColumns as unknown as ColumnsType<unknown>),
    ];
  }, [comboColumns, t]);

  // NOTE: no "reset station to null on day/week change" effect here — it
  // would wipe a still-valid station (and blank the table, because the query
  // is gated on a station being selected). The station selector reconciles
  // itself via preserveSelection — it keeps the pick when it's still
  // scheduled for the new day, and only falls back to the first station when
  // it's gone.

  // Pickup lists are inherently per-member (rows are members); import-shares
  // tenants have no members / ShareDeliveries, so the list can't be built. Show
  // the "not available" notice instead of an empty grid + dead PDF buttons.
  if (usesExternalDemand) {
    return (
      <div>
        <h1>
          {t("commissioning.delivery_notes_delivery_stations_details_title")}
        </h1>
        <ImportSharesModeBanner messageKey="commissioning.pickup_lists_import_unavailable" />
      </div>
    );
  }

  return (
    <div>
      <h1>
        {t("commissioning.delivery_notes_delivery_stations_details_title")}
      </h1>
      <p className="page-subtitle">{t("commissioning.pickup_lists_subtitle")}</p>
      <div>
        <WeekSelector
          selectedYear={selectedYear}
          setSelectedYear={setSelectedYear}
          selectedWeek={selectedWeek}
          setSelectedWeek={setSelectedWeek}
        />
        <DaySelector
          selectedDay={selectedDeliveryDay}
          setSelectedDay={setSelectedDeliveryDay}
          selectedWeek={selectedWeek}
          selectedYear={selectedYear}
          days={dayNumbers}
          suffix={t("commissioning.delivery_day")}
        />
      </div>
      <div className="delivery-stations-details__station-selector">
        <DeliveryStationSelector
          selectedDeliveryStation={selectedDeliveryStation}
          setSelectedDeliveryStation={setSelectedDeliveryStation}
          delivery_day={selectedDeliveryDayId}
          preserveSelection
        />
      </div>

      <div className="delivery-stations-details__pdf-buttons">
        <DeliveryStationDetailsPDFGenerator
          pages={currentStationPages}
          packingMode={packingMode}
          tints={tints}
          tenant={tenantInfo}
          filename={generatePdfFilename([
            t("commissioning.pickup_list"),
            selectedYear,
            formatWeekLabel(selectedWeek, t),
            formatDayLabel(selectedDeliveryDay, t),
            selectedStationName.replace(/[^a-zA-Z0-9]/g, "_"),
          ])}
          buttonText={t("download.delivery_details_station")}
          t={t}
        />
        <ToolTipIcon
          title={t("tooltip.pickup_list_single_delivery_station")}
          className="tooltip-icon-beside-button"
        />

        <DeliveryStationDetailsPDFGenerator
          pages={allStationsDayPages}
          packingMode={packingMode}
          tints={tints}
          tenant={tenantInfo}
          filename={generatePdfFilename([
            t("commissioning.pickup_lists"),
            selectedYear,
            formatWeekLabel(selectedWeek, t),
            formatDayLabel(selectedDeliveryDay, t),
            t("commissioning.all_day"),
          ])}
          buttonText={t("download.all_pdf_for_this_day")}
          t={t}
        />
        <ToolTipIcon
          title={t("tooltip.pickup_list_whole_day")}
          className="tooltip-icon-beside-button"
        />

        {hasSeveralDeliveryDays && (
          <>
            <DeliveryStationDetailsPDFGenerator
              pages={allStationsWeekPages}
              packingMode={packingMode}
              tints={tints}
              tenant={tenantInfo}
              filename={generatePdfFilename([
                t("commissioning.pickup_lists"),
                selectedYear,
                formatWeekLabel(selectedWeek, t),
                t("commissioning.whole_week"),
              ])}
              buttonText={t("download.all_pdf_for_this_week")}
              t={t}
            />
            <ToolTipIcon
              title={t("tooltip.pickup_list_whole_week")}
              className="tooltip-icon-beside-button"
            />
          </>
        )}
      </div>

      {/* The members' notices, for the same three scopes. */}
      <StationContentsDownloads
        year={selectedYear}
        week={selectedWeek}
        dayNumber={selectedDeliveryDay}
        station={selectedStation}
        dayStations={deliveryStations}
        weekSlots={weekSlots}
        showWeek={hasSeveralDeliveryDays}
      />

      {isQueryEnabled &&
      !loading &&
      !matrixFailed &&
      matrixColumns.length === 0 ? (
        <PastWarningMessage>
          {t("commissioning.packing_list_no_columns")}
        </PastWarningMessage>
      ) : (
        <ReadOnlyReportTable
          columns={columns}
          dataSource={matrixRows}
          pagination={false}
          loading={loading}
          className="custom-jasmin-table w-max mt-2em"
          rowKey="id"
          bordered
          emptyText={
            matrixFailed
              ? t("common.error_loading_data")
              : selectedDeliveryStation
                ? t("table.no_data")
                : t("commissioning.select_delivery_station")
          }
        />
      )}

      <ExplainerText title={t("common.info")}>
        {t("explainers.delivery_stations_details")}
      </ExplainerText>
    </div>
  );
}
