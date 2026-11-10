import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useTenant } from "@hooks/index";
import { ToolTipIcon } from "@shared/ui";
import {
  formatDayLabel,
  formatWeekLabel,
  generatePdfFilename,
} from "@shared/utils";
import { StationContentsPDFGenerator } from "@features/commissioning/pdfs";
import type { DeliveryStationOption } from "../hooks/useDeliveryStations";
import {
  useStationContentsPages,
  type StationContentsSlot,
} from "../hooks/useStationContentsPages";
import type { WeekStationSlot } from "../hooks/useWeekStationSlots";

interface StationContentsDownloadsProps {
  year: number;
  week: number;
  dayNumber: number | null;
  /** The station on screen, once one is chosen. */
  station: DeliveryStationOption | undefined;
  /** Every station the chosen delivery day serves. */
  dayStations: DeliveryStationOption[];
  weekSlots: WeekStationSlot[];
  /** Off when the week has one delivery day, whose notices the day's are. */
  showWeek: boolean;
}

const fileNamePart = (text: string) => text.replace(/[^a-zA-Z0-9]/g, "_");

/**
 * The downloads of the members' notices — what the shares collected at a
 * station hold — for the station on screen, every station of the delivery
 * day and every station of the week.
 */
export default function StationContentsDownloads({
  year,
  week,
  dayNumber,
  station,
  dayStations,
  weekSlots,
  showWeek,
}: StationContentsDownloadsProps) {
  const { t } = useTranslation();
  const { tenantName, logoUrl, tenant } = useTenant();
  const tenantInfo = useMemo(
    () => ({
      name: tenantName,
      logoUrl,
      email: (tenant?.email as string) || "",
      phone: (tenant?.phone_number as string) || "",
    }),
    [tenantName, logoUrl, tenant],
  );

  const stationSlots = useMemo<StationContentsSlot[]>(
    () =>
      dayNumber !== null && station
        ? [{ dayNumber, stationId: station.value, stationName: station.label }]
        : [],
    [dayNumber, station],
  );
  const daySlots = useMemo<StationContentsSlot[]>(
    () =>
      dayNumber === null
        ? []
        : dayStations.map((option) => ({
            dayNumber,
            stationId: option.value,
            stationName: option.label,
          })),
    [dayNumber, dayStations],
  );
  const weekNoticeSlots = useMemo<StationContentsSlot[]>(
    () =>
      showWeek
        ? weekSlots.map((slot) => ({
            dayNumber: slot.dayNum,
            stationId: slot.station.value,
            stationName: slot.station.label,
          }))
        : [],
    [showWeek, weekSlots],
  );
  const stationNotices = useStationContentsPages(year, week, stationSlots);
  const dayNotices = useStationContentsPages(year, week, daySlots);
  const weekNotices = useStationContentsPages(year, week, weekNoticeSlots);

  const fileName = t("commissioning.station_contents.file_name");

  return (
    <div className="delivery-stations-details__pdf-buttons">
      <StationContentsPDFGenerator
        pages={stationNotices}
        tenant={tenantInfo}
        filename={generatePdfFilename([
          fileName,
          year,
          formatWeekLabel(week, t),
          formatDayLabel(dayNumber, t),
          fileNamePart(station?.label ?? ""),
        ])}
        buttonText={t("download.station_contents_station")}
        t={t}
      />
      <ToolTipIcon
        title={t("tooltip.station_contents_station")}
        className="tooltip-icon-beside-button"
      />

      <StationContentsPDFGenerator
        pages={dayNotices}
        tenant={tenantInfo}
        filename={generatePdfFilename([
          fileName,
          year,
          formatWeekLabel(week, t),
          formatDayLabel(dayNumber, t),
          t("commissioning.all_day"),
        ])}
        buttonText={t("download.station_contents_day")}
        t={t}
      />
      <ToolTipIcon
        title={t("tooltip.station_contents_day")}
        className="tooltip-icon-beside-button"
      />

      {showWeek && (
        <>
          <StationContentsPDFGenerator
            pages={weekNotices}
            tenant={tenantInfo}
            filename={generatePdfFilename([
              fileName,
              year,
              formatWeekLabel(week, t),
              t("commissioning.whole_week"),
            ])}
            buttonText={t("download.station_contents_week")}
            t={t}
          />
          <ToolTipIcon
            title={t("tooltip.station_contents_week")}
            className="tooltip-icon-beside-button"
          />
        </>
      )}
    </div>
  );
}
