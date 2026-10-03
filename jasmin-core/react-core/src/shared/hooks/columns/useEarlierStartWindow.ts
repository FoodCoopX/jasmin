import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useMemo } from "react";
import type { TableRecord } from "@shared/tables/BasicEditableTable/types";
import { useOnboardingMode } from "../configuration/useOnboardingMode";
import type { EarlierStartWindow } from "./useTimeBoundColumns";

interface TimeBoundRow extends TableRecord {
  valid_from?: string;
  valid_until?: string | null;
}

interface EarlierStartWindowOptions<Row extends TimeBoundRow> {
  /** The saved rows, closed ones included: an earlier row of the same lineage
   *  sets the floor. */
  rows: Row[];
  /** Whether two rows are versions of the same thing (a weekday, a station's
   *  delivery day), whose windows may not overlap. Stable reference. */
  sameLineage: (a: Row, b: Row) => boolean;
  /** A start the row may not move before (its parent's), if any. Stable
   *  reference. */
  parentStart?: (row: Row) => string | null | undefined;
  /** Whether the row may also move later. Stable reference. */
  laterAllowed?: (row: Row) => boolean;
}

/**
 * The window a saved time-bound row's start may move back in while the
 * tenant's onboarding mode is on — ``useTimeBoundColumns``'
 * ``validFromEarlierMove``. Subscriptions that started before the tenant moved
 * to Jasmin need delivery days and station days that ran back then, and a row
 * can't be created with a past start, only moved there.
 *
 * The floor is the day after the latest earlier row of the same lineage ends
 * (the backend refuses an overlap) or the parent's start, whichever is later.
 * Outside onboarding mode, and for a new row, there is no window.
 */
export function useEarlierStartWindow<Row extends TimeBoundRow>({
  rows,
  sameLineage,
  parentStart,
  laterAllowed,
}: EarlierStartWindowOptions<Row>) {
  const onboardingMode = useOnboardingMode();
  const savedById = useMemo(
    () =>
      new Map(
        rows.filter((row) => row.id != null).map((row) => [row.id, row]),
      ),
    [rows],
  );

  return useCallback(
    (record: TableRecord): EarlierStartWindow | null => {
      if (!onboardingMode || record.key === -1) return null;
      const saved = savedById.get(record.id);
      if (!saved?.valid_from) return null;
      const savedStart = dayjs(saved.valid_from);

      let floor: Dayjs | null = null;
      for (const row of rows) {
        if (row === saved || !row.valid_until || !sameLineage(row, saved)) {
          continue;
        }
        const dayAfterEnd = dayjs(row.valid_until).add(1, "day");
        if (dayAfterEnd.isAfter(savedStart, "day")) continue;
        if (!floor || dayAfterEnd.isAfter(floor, "day")) floor = dayAfterEnd;
      }
      const parent = parentStart?.(saved);
      if (parent && (!floor || dayjs(parent).isAfter(floor, "day"))) {
        floor = dayjs(parent);
      }

      return {
        savedStart,
        floor,
        laterAllowed: laterAllowed?.(saved) ?? false,
      };
    },
    [onboardingMode, rows, savedById, sameLineage, parentStart, laterAllowed],
  );
}
