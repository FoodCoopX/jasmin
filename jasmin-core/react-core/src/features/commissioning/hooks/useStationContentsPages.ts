import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getCommissioningPackingListStationContentsRetrieveQueryOptions } from "@shared/api/generated/commissioning/commissioning";
import type { PackingModeEnum } from "@shared/api/generated/models";
import {
  useNumberFormat,
  useShareTypeVariationSizeOptions,
  useTenant,
  useVegetableSizeOptions,
} from "@hooks/index";
import { isWeekInPast } from "@shared/utils";
import {
  buildStationContentsCards,
  marksPackingKind,
  type StationContentsPage,
} from "../utils/stationContents";
import { useStationSheetLabels } from "./useStationSheetLabels";

/** One station on one of the week's delivery days. */
export interface StationContentsSlot {
  dayNumber: number;
  stationId: string;
  stationName: string;
}

/**
 * The station notices of the given slots: one page per slot whose station has
 * shares collected that day, in the slots' order. None for no slots, and null
 * while any slot loads.
 */
export function useStationContentsPages(
  year: number,
  week: number,
  slots: StationContentsSlot[],
): StationContentsPage[] | null {
  const { t } = useTranslation();
  const { getSetting } = useTenant();
  const { format } = useNumberFormat();
  const { tints, dateLabel } = useStationSheetLabels(year, week);
  const { getShareTypeVariationSizeLabel } = useShareTypeVariationSizeOptions();
  const { getVegetableSizeLabel } = useVegetableSizeOptions();
  const packingMode = getSetting("packing_mode", "BOXES") as PackingModeEnum;
  const isPast = isWeekInPast(year, week);

  const queries = useQueries({
    queries: slots.map((slot) =>
      getCommissioningPackingListStationContentsRetrieveQueryOptions({
        year,
        delivery_week: week,
        day_number: slot.dayNumber,
        delivery_station: slot.stationId,
        is_past: isPast,
      }),
    ),
  });

  return useMemo(() => {
    if (queries.some((query) => query.isLoading)) return null;
    const labels = {
      packingMode,
      tints,
      shareSizeLabel: getShareTypeVariationSizeLabel,
      articleSizeLabel: getVegetableSizeLabel,
      // Every unit an amount can come in, grams too: the unit options offer
      // only the ones an article is planned in.
      unitLabel: (unit: string) => t(`commissioning.units.${unit}`),
      format,
    };
    return slots.flatMap((slot, index) => {
      const cards = buildStationContentsCards(
        queries[index]?.data?.shares ?? [],
        labels,
      );
      if (cards.length === 0) return [];
      return [
        {
          key: `${slot.dayNumber}-${slot.stationId}`,
          stationName: slot.stationName,
          dateLabel: dateLabel(slot.dayNumber),
          marksKind: marksPackingKind(packingMode),
          cards,
        },
      ];
    });
  }, [
    slots,
    queries,
    packingMode,
    tints,
    dateLabel,
    getShareTypeVariationSizeLabel,
    getVegetableSizeLabel,
    format,
    t,
  ]);
}
