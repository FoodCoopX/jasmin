import dayjs from "dayjs";
import { describe, expect, it } from "vitest";

import {
  MAX_STATISTICS_RANGE_YEARS,
  isOutsideStatisticsRange,
} from "../statisticsRange";

// The server's cap, in days: apps/commissioning/views/statistic_views.py
// (_MAX_REPORT_SPAN_YEARS * 366).
const SERVER_CAP_DAYS = MAX_STATISTICS_RANGE_YEARS * 366;

const start = dayjs("2021-01-04");
const end = dayjs("2026-01-04");

describe("isOutsideStatisticsRange", () => {
  it("disables nothing while the panel has no bound yet", () => {
    expect(isOutsideStatisticsRange(dayjs("1990-01-01"), null)).toBe(false);
    expect(isOutsideStatisticsRange(dayjs("2099-01-01"), undefined)).toBe(
      false,
    );
    expect(isOutsideStatisticsRange(dayjs("2099-01-01"), [null, null])).toBe(
      false,
    );
  });

  it("keeps the full span selectable from a picked start", () => {
    const last = start.add(MAX_STATISTICS_RANGE_YEARS, "year");
    expect(isOutsideStatisticsRange(last, [start, null])).toBe(false);
    expect(isOutsideStatisticsRange(last.add(1, "day"), [start, null])).toBe(
      true,
    );
  });

  it("keeps the full span selectable back from a picked end", () => {
    const first = end.subtract(MAX_STATISTICS_RANGE_YEARS, "year");
    expect(isOutsideStatisticsRange(first, [null, end])).toBe(false);
    expect(
      isOutsideStatisticsRange(first.subtract(1, "day"), [null, end]),
    ).toBe(true);
  });

  it("never allows a span the server would refuse", () => {
    const widest = start.add(MAX_STATISTICS_RANGE_YEARS, "year");
    expect(widest.diff(start, "day")).toBeLessThanOrEqual(SERVER_CAP_DAYS);
  });

  it("refuses a decade-wide range", () => {
    expect(isOutsideStatisticsRange(dayjs("2015-01-01"), [null, end])).toBe(
      true,
    );
  });
});
