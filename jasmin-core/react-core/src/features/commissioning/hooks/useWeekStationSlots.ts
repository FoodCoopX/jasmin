import { useMemo } from "react";
import { useDeliveryStationsPerDay } from "./useDeliveryStations";
import type { DeliveryStationOption } from "./useDeliveryStations";

/** One of the week's delivery days with one station it serves. */
export interface WeekStationSlot {
  dayNum: number;
  station: DeliveryStationOption;
}

/**
 * The week's delivery days, each paired with the stations IT serves — every
 * day has its own, so the week's pages pair a day only with its stations.
 * Empty until every day's stations have loaded.
 */
export function useWeekStationSlots(
  dayNumbers: number[],
  shareDeliveryDays: { id?: unknown; day_number?: unknown }[],
): WeekStationSlot[] {
  const weekDeliveryDays = useMemo(
    () =>
      dayNumbers.flatMap((dayNum) => {
        const id = shareDeliveryDays.find(
          (day) => day.day_number === dayNum,
        )?.id;
        return id ? [{ dayNum, id: String(id) }] : [];
      }),
    [dayNumbers, shareDeliveryDays],
  );
  const { stationsPerDay, loading } = useDeliveryStationsPerDay(
    weekDeliveryDays.map((day) => day.id),
  );
  return useMemo(
    () =>
      loading
        ? []
        : weekDeliveryDays.flatMap(({ dayNum }, index) =>
            (stationsPerDay[index] ?? []).map((station) => ({
              dayNum,
              station,
            })),
          ),
    [weekDeliveryDays, stationsPerDay, loading],
  );
}
