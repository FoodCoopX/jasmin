import { useCallback, useMemo } from "react";
import { useEarlierStartWindow } from "@hooks/index";
import type { TableRecord } from "@shared/tables/BasicEditableTable/types";
import type { ShareDeliveryDayOption } from "./useShareDeliveryDays";

interface StationDayRow extends TableRecord {
  delivery_day?: string;
  valid_from?: string;
  valid_until?: string | null;
}

// A station's earlier rows for the same delivery day are the versions before it.
const sameDeliveryDay = (a: StationDayRow, b: StationDayRow) =>
  a.delivery_day === b.delivery_day;

/**
 * The window a station's saved station day may move back in while the tenant's
 * onboarding mode is on (see ``useEarlierStartWindow``): no earlier than its
 * delivery day's start, nor into the station's previous row for that day.
 * ``rows`` are the station's station days, closed ones included.
 */
export function useStationDayEarlierStart<Row extends StationDayRow>(
  rows: Row[],
  deliveryDays: ShareDeliveryDayOption[],
) {
  const deliveryDayStartById = useMemo(
    () => new Map(deliveryDays.map((day) => [day.id, day.valid_from])),
    [deliveryDays],
  );
  const deliveryDayStart = useCallback(
    (row: Row) =>
      row.delivery_day ? deliveryDayStartById.get(row.delivery_day) : null,
    [deliveryDayStartById],
  );
  return useEarlierStartWindow<Row>({
    rows,
    sameLineage: sameDeliveryDay,
    parentStart: deliveryDayStart,
  });
}
