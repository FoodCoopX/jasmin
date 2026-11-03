import { useMemo } from "react";
import { useDateFormat, useFiscalYearRangeState } from "@hooks/index";

/**
 * The date range of a weekly statistics page, the tenant's current fiscal year
 * to start with, and the ``start_date`` / ``end_date`` params it asks the API
 * for. ``range`` is null only while the picker holds no complete range, so the
 * page's query waits on it.
 */
export function useStatisticsRange() {
  const { formatDateForAPI } = useDateFormat();
  const [range, setRange] = useFiscalYearRangeState();
  const params = useMemo(
    () => ({
      start_date: range ? (formatDateForAPI(range[0]) ?? "") : "",
      end_date: range ? (formatDateForAPI(range[1]) ?? "") : "",
    }),
    [range, formatDateForAPI],
  );
  return { range, setRange, params };
}
