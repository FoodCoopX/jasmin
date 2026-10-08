import { useEffect, useState } from "react";

import { useDeliveryStations } from "./useDeliveryStations";

/**
 * The selected delivery station, kept to the stations of the delivery day:
 * none when the selected one isn't scheduled that day — including on a day
 * whose station list came back empty — and, with `selectFirst`, the day's
 * first station whenever none is selected. Only a loaded list counts: while
 * the day or its stations are still loading the list is empty too, and the
 * selection has to survive that. A `null` day checks nothing and keeps the
 * selection as it is.
 *
 * The third value says whether the selection is one of the day's loaded
 * stations — false while that is still unknown — so a page can hold a request
 * that a station left over from another day would make.
 */
export function useDeliveryStationOfDay(
  deliveryDayId: string | null,
  { selectFirst = true }: { selectFirst?: boolean } = {},
) {
  const [selectedDeliveryStation, setSelectedDeliveryStation] = useState<
    string | null
  >(null);
  const { deliveryStations, loading } = useDeliveryStations({
    delivery_day: deliveryDayId ?? undefined,
  });

  useEffect(() => {
    if (deliveryDayId === null || loading) return;
    if (selectedDeliveryStation === null) {
      if (selectFirst && deliveryStations.length > 0) {
        setSelectedDeliveryStation(deliveryStations[0].value);
      }
      return;
    }
    const stillValid = deliveryStations.some(
      (station) => station.value === selectedDeliveryStation,
    );
    if (!stillValid) setSelectedDeliveryStation(null);
  }, [deliveryDayId, loading, deliveryStations, selectedDeliveryStation, selectFirst]);

  const isStationOfDay =
    deliveryDayId !== null &&
    !loading &&
    deliveryStations.some((station) => station.value === selectedDeliveryStation);

  return [selectedDeliveryStation, setSelectedDeliveryStation, isStationOfDay] as const;
}
