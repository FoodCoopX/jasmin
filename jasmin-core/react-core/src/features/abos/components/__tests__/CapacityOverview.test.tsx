// Capacity overview: it lists the sizes and station days running in the
// chosen range, and a range with no fetched week shows every row as
// "unknown". The window is the union of the variations' and the station days'
// weeks, so station days arriving later can bring the range into the window
// while the variations stay the same array — and the variation rows then have
// to be evaluated, not left on "unknown".

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import dayjs from "dayjs";

import type { DeliveryStationDayOption } from "@hooks/useDeliveryStationDays";
import type { ShareTypeVariationOption } from "@hooks/useAllShareTypeVariations";
import { termWeekKeys } from "@shared/utils/weekRange";
import { CapacityOverview } from "../CapacityOverview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@hooks/index", () => ({
  useDateFormat: () => ({
    dateFormat: "DD.MM.YYYY",
    formatDateForAPI: (date: dayjs.Dayjs) => date.format("YYYY-MM-DD"),
  }),
  useDateRangePresets: () => [],
}));

vi.mock("@shared/tables", () => ({
  READ_ONLY_PERMISSION: {},
  EditableTable: ({
    columns,
    initialData,
  }: {
    columns: {
      key: string;
      dataIndex: string;
      render?: (value: unknown, record: Record<string, unknown>) => unknown;
    }[];
    initialData: Record<string, unknown>[];
  }) => (
    <div>
      {initialData.map((row) => (
        <div key={String(row.id)} data-testid={`row-${row.id}`}>
          {columns.map((column) => (
            <div key={column.key}>
              {(column.render
                ? column.render(row[column.dataIndex], row)
                : String(row[column.dataIndex] ?? "")) as React.ReactNode}
            </div>
          ))}
        </div>
      ))}
    </div>
  ),
}));

const variations = [
  {
    value: "v1", label: "Vegetable box", capacity: 10, capacity_by_week: {},
    valid_from: "2020-01-06", valid_until: null,
  },
] as unknown as ShareTypeVariationOption[];

/** A station day whose capacity weeks cover the overview's default range
 *  (today through a year ahead). */
function stationDayCoveringTheRange(): DeliveryStationDayOption {
  const weeks = termWeekKeys(dayjs(), dayjs().add(1, "year"));
  return {
    value: "d1",
    label: "Market hall, Tuesday",
    valid_from: "2020-01-06",
    valid_until: null,
    capacity: 5,
    capacity_by_week: Object.fromEntries(
      weeks.map((week) => [week, { occupied: 0, free: 5 }]),
    ),
  } as unknown as DeliveryStationDayOption;
}

describe("CapacityOverview", () => {
  it("evaluates the variation rows once station days bring the range into the window", async () => {
    const { rerender } = render(
      <CapacityOverview variations={variations} stationDays={[]} />,
    );
    await userEvent.click(screen.getByText(/abos\.capacities_overview/));

    expect(
      within(screen.getByTestId("row-variation-v1")).getByText(
        "abos.capacity_status_unknown",
      ),
    ).toBeInTheDocument();

    rerender(
      <CapacityOverview
        variations={variations}
        stationDays={[stationDayCoveringTheRange()]}
      />,
    );

    const variationRow = screen.getByTestId("row-variation-v1");
    expect(
      within(variationRow).queryByText("abos.capacity_status_unknown"),
    ).not.toBeInTheDocument();
    expect(
      within(variationRow).getByText("abos.capacity_status_ok"),
    ).toBeInTheDocument();
  });

  it("lists only the sizes and station days running in the range", async () => {
    const isoDate = (date: dayjs.Dayjs) => date.format("YYYY-MM-DD");
    render(
      <CapacityOverview
        variations={[
          ...variations,
          {
            value: "v-ended", label: "Ended box", capacity: 10, capacity_by_week: {},
            valid_from: "2020-01-06", valid_until: isoDate(dayjs().subtract(1, "month")),
          },
          {
            value: "v-later", label: "Later box", capacity: 10, capacity_by_week: {},
            valid_from: isoDate(dayjs().add(2, "year")), valid_until: null,
          },
        ] as unknown as ShareTypeVariationOption[]}
        stationDays={[
          stationDayCoveringTheRange(),
          {
            ...stationDayCoveringTheRange(),
            value: "d-ended",
            valid_until: isoDate(dayjs().subtract(1, "month")),
          },
        ]}
      />,
    );
    await userEvent.click(screen.getByText(/abos\.capacities_overview/));

    expect(screen.getByTestId("row-variation-v1")).toBeInTheDocument();
    expect(screen.queryByTestId("row-station_day-d-ended")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-variation-v-ended")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-variation-v-later")).not.toBeInTheDocument();
    expect(screen.getByTestId("row-station_day-d1")).toBeInTheDocument();
  });
});
