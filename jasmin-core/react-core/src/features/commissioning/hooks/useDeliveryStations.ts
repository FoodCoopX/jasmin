import dayjs from "dayjs";
import { useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import {
  getCommissioningDeliveryStationsListQueryOptions,
  useCommissioningDeliveryStationsList,
} from "@shared/api/generated/commissioning/commissioning";
import type {
  CommissioningDeliveryStationsListParams,
  DeliveryStation,
  ErrorResponse,
} from "@shared/api/generated/models";
import { toOptions, type Option } from "@hooks/internal/toOptions";
import { toApiDate } from "@shared/utils/apiDate";

export type DeliveryStationOption = Option<DeliveryStation>;

const deliveryStationLabel = (station: DeliveryStation) =>
  station.short_name || station.company_name || "";

/**
 * A week's stations go by the station-days running that week
 * (`active_at_date`). A past week keeps a station deactivated since, so its
 * lists can still be reprinted; this week and later ones, like the planning,
 * leave a deactivated station out, whose station-day may still be open.
 */
const stationListParams = (
  params: CommissioningDeliveryStationsListParams,
): CommissioningDeliveryStationsListParams =>
  // Before this week's Monday: any day of a past week, never one of this week.
  params.active_at_date &&
  params.active_at_date < toApiDate(dayjs().isoWeekday(1))!
    ? params
    : { is_active: true, ...params };

export const useDeliveryStations = (
  params: CommissioningDeliveryStationsListParams = {},
  { enabled }: { enabled?: boolean } = {},
) => {
  const queryParams = stationListParams(params);

  const { data, isLoading, error } = useCommissioningDeliveryStationsList(queryParams, {
    // By default the fetch waits for a ``delivery_day`` (the selector's
    // day-scoped use). Callers that want ALL active stations regardless of day
    // pass ``{ enabled: true }``.
    query: { enabled: enabled ?? params.delivery_day != null },
  });

  const deliveryStations: DeliveryStationOption[] = useMemo(
    () => toOptions(data, deliveryStationLabel),
    [data],
  );

  return {
    deliveryStations,
    loading: isLoading,
    error,
  };
};

// Module-level, so TanStack re-runs it only when a query result changes and
// the lists keep their identity between renders.
const combineStationsPerDay = (
  results: UseQueryResult<DeliveryStation[], ErrorResponse>[],
) => ({
  stationsPerDay: results.map((result) => toOptions(result.data, deliveryStationLabel)),
  loading: results.some((result) => result.isLoading),
});

/**
 * The stations of each delivery day, in the order of `deliveryDayIds` — for
 * views spanning several days, since every day serves its own stations; those
 * of the week of `activeAtDate` when given. Shares its requests with
 * `useDeliveryStations` for the same day.
 */
export const useDeliveryStationsPerDay = (
  deliveryDayIds: string[],
  activeAtDate?: string,
) =>
  useQueries({
    queries: deliveryDayIds.map((deliveryDay) =>
      getCommissioningDeliveryStationsListQueryOptions(
        stationListParams({
          delivery_day: deliveryDay,
          active_at_date: activeAtDate,
        }),
      ),
    ),
    combine: combineStationsPerDay,
  });
