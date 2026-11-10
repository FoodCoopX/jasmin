import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { CommissioningShareTypeVariationsListParams } from "@shared/api/generated/models";
import { isoWeekRangeLabel, mondayOfIsoWeek, toApiDate } from "@shared/utils";
import {
  useShareTypeVariations,
  type ShareTypeVariationOption,
} from "./useShareTypeVariations";

export interface YearShareTypeVariation {
  variation: ShareTypeVariationOption;
  /** The weeks of the year it runs in, e.g. "KW 27–52"; empty when it runs
   *  all year. */
  weeksLabel: string;
}

/**
 * The physical sizes of a share option that run in any week of ISO year
 * `year`: a size replaced during the year and the one replacing it each get a
 * column, labelled with the weeks they cover.
 */
export function useYearShareTypeVariations(
  year: number,
  shareOption: CommissioningShareTypeVariationsListParams["share_option"],
): YearShareTypeVariation[] {
  const { t } = useTranslation();
  const firstMonday = toApiDate(mondayOfIsoWeek(year, 1))!;
  const lastSunday = toApiDate(mondayOfIsoWeek(year + 1, 1).subtract(1, "day"))!;

  const filters = useMemo<CommissioningShareTypeVariationsListParams>(
    () => ({
      physical: true,
      active_at_date: firstMonday,
      include_future: true,
      share_option: shareOption,
    }),
    [firstMonday, shareOption],
  );
  const { shareTypeVariations } = useShareTypeVariations(filters);

  return useMemo(
    () =>
      shareTypeVariations
        .filter((variation) => variation.valid_from <= lastSunday)
        .map((variation) => {
          // ISO dates compare as strings.
          const from =
            variation.valid_from > firstMonday ? variation.valid_from : firstMonday;
          const until =
            variation.valid_until && variation.valid_until < lastSunday
              ? variation.valid_until
              : lastSunday;
          const runsAllYear = from === firstMonday && until === lastSunday;
          return {
            variation,
            weeksLabel: runsAllYear
              ? ""
              : isoWeekRangeLabel(from, until, t("commissioning.KW")),
          };
        }),
    [shareTypeVariations, firstMonday, lastSunday, t],
  );
}
