import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useDateFormat } from "@hooks/index";
import { useShareTypes } from "@hooks/useShareTypes";
import {
  activeAtDateForWeek,
  dateForWeekDayNumber,
  getDayName,
} from "@shared/utils";

/**
 * What the sheets printed for a station — the pickup list and the members'
 * notice — say alike: the delivery day as a date line, and which tint each
 * share type gets. A share type's tint is its place among the farm's share
 * types (in share-option order), so it keeps its colour on both sheets and
 * from week to week.
 */
export function useStationSheetLabels(year: number, week: number) {
  const { t } = useTranslation();
  const { formatDate } = useDateFormat();
  const { shareTypes } = useShareTypes({
    active_at_date: activeAtDateForWeek(year, week),
  });

  const tints = useMemo(
    () =>
      Object.fromEntries(
        shareTypes.map((shareType, index) => [shareType.value, index]),
      ) as Record<string, number>,
    [shareTypes],
  );

  const dateLabel = useCallback(
    (dayNumber: number) =>
      `${getDayName(dayNumber, t)}, ${formatDate(
        dateForWeekDayNumber(year, week, dayNumber),
      )} · ${t("commissioning.KW")} ${week}`,
    [t, formatDate, year, week],
  );

  return { tints, dateLabel };
}
