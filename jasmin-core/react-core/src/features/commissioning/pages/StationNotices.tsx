import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { StationContentsDownloads } from "@features/commissioning/components";
import {
  useDeliveryStations,
  useShareDeliveryDays,
  useWeekStationSlots,
} from "@features/commissioning/hooks";
import { DeliveryStationSelector } from "@features/commissioning/selectors";
import { useYearWeekState } from "@hooks/index";
import { DaySelector, WeekSelector } from "@shared/selectors";
import { activeAtDateForWeek } from "@shared/utils";

/**
 * The members' notices on their own: what the shares collected at a delivery
 * station hold, for a station, a delivery day or the week. For a host that
 * keeps the pickup lists itself, where the pickup-list page that also offers
 * them isn't there.
 */
export default function StationNotices() {
  const { t } = useTranslation();
  const { selectedYear, setSelectedYear, selectedWeek, setSelectedWeek } =
    useYearWeekState();
  const [selectedDeliveryDay, setSelectedDeliveryDay] = useState<number | null>(
    null,
  );
  const [selectedDeliveryStation, setSelectedDeliveryStation] = useState<
    string | null
  >(null);

  const shareDeliveryDaysFilters = useMemo(
    () => ({
      active_at_date: activeAtDateForWeek(selectedYear, selectedWeek),
    }),
    [selectedYear, selectedWeek],
  );
  const { shareDeliveryDays, dayNumbers } = useShareDeliveryDays(
    shareDeliveryDaysFilters,
  );

  // Keep the selection on one of the week's delivery days.
  useEffect(() => {
    if (
      dayNumbers.length > 0 &&
      !dayNumbers.some((day) => day === selectedDeliveryDay)
    ) {
      setSelectedDeliveryDay(dayNumbers[0]);
    }
  }, [dayNumbers, selectedDeliveryDay]);

  const selectedDeliveryDayId = useMemo(() => {
    if (selectedDeliveryDay === null) return null;
    return (
      shareDeliveryDays.find((day) => day.day_number === selectedDeliveryDay)
        ?.id ?? null
    );
  }, [selectedDeliveryDay, shareDeliveryDays]);

  // The stations the day served in the selected week.
  const weekDate = activeAtDateForWeek(selectedYear, selectedWeek);
  const { deliveryStations } = useDeliveryStations(
    selectedDeliveryDayId
      ? { delivery_day: selectedDeliveryDayId, active_at_date: weekDate }
      : {},
  );
  const weekSlots = useWeekStationSlots(dayNumbers, shareDeliveryDays, weekDate);

  return (
    <div>
      <h1>{t("commissioning.station_contents.page_title")}</h1>
      <p className="page-subtitle">
        {t("commissioning.station_contents.page_subtitle")}
      </p>
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
          active_at_date={weekDate}
          preserveSelection
        />
      </div>

      <StationContentsDownloads
        year={selectedYear}
        week={selectedWeek}
        dayNumber={selectedDeliveryDay}
        station={deliveryStations.find(
          (station) => station.value === selectedDeliveryStation,
        )}
        dayStations={deliveryStations}
        weekSlots={weekSlots}
        showWeek={dayNumbers.length > 1}
      />
    </div>
  );
}
