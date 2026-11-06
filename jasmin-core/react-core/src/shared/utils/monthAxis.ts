import dayjs, { type Dayjs } from "dayjs";

/** A continuous monthly axis plus its shared label formatter. */
export interface MonthAxis {
  /** Start-of-month dayjs points, oldest → newest. Never empty. */
  months: Dayjs[];
  /** Labels a month in the format the axis was built with. */
  labelOf: (month: Dayjs) => string;
}

/**
 * Continuous monthly axis for the dashboard time-series charts.
 *
 * Spans the selected range but ALWAYS at least the last 12 months (ending at
 * the range end) so a chart never looks sparse; the abos income/active charts
 * rely on this floor to line up. Returns the raw month list plus a label
 * formatter in ``labelFormat`` (``useDateFormat().shortMonthFormat``), so each
 * caller keeps its own per-month aggregation (income parsing, cumulative
 * running totals, per-variation sums) at the call site.
 */
export function buildMonthAxis(
  range: [Dayjs, Dayjs] | null,
  labelFormat: string,
): MonthAxis {
  const end = (range ? range[1] : dayjs()).startOf("month");
  const selStart = (range ? range[0] : dayjs().subtract(1, "year")).startOf(
    "month",
  );
  const minStart = end.subtract(11, "month");
  let cursor = selStart.isBefore(minStart) ? selStart : minStart;

  const months: Dayjs[] = [];
  while (!cursor.isAfter(end)) {
    months.push(cursor);
    cursor = cursor.add(1, "month");
  }
  return { months, labelOf: (month) => month.format(labelFormat) };
}
