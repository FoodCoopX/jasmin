/**
 * RelatedDayInfo: the label and the dates of the days related to the selected
 * one (e.g. the delivery days a harvest day serves), each the weekday and date
 * in the selected ISO week in the farm's date format, unless the page formats
 * the days itself.
 */

import { render } from "@testing-library/react";
import dayjs from "dayjs";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const tenantSettings = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
}));
vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock({
    getSetting: (key: string, defaultValue?: unknown) =>
      key in tenantSettings.values ? tenantSettings.values[key] : defaultValue,
  });
  return { useTenant: () => tenant };
});

import RelatedDayInfo from "../RelatedDayInfo";

// ISO week 41 of 2026 runs from Monday 5 October to Sunday 11 October.
const weekdayDate = (isoDate: string, format: string) =>
  dayjs(isoDate).format(`dddd, ${format}`);

beforeEach(() => {
  tenantSettings.values = {};
});

describe("RelatedDayInfo", () => {
  it("dates each day number (0 = Monday) in the selected week, slash-separated", () => {
    const { container } = render(
      <RelatedDayInfo
        label="Delivery days: "
        relatedDayNumbers={[1, 4]}
        selectedWeek={41}
        selectedYear={2026}
      />,
    );

    expect(container).toHaveTextContent(
      `Delivery days: ${weekdayDate("2026-10-06", "DD.MM.YYYY")} / ${weekdayDate("2026-10-09", "DD.MM.YYYY")}`,
    );
    expect(container).toHaveTextContent("06.10.2026");
    expect(container).toHaveTextContent("09.10.2026");
  });

  it("uses the farm's date format", () => {
    tenantSettings.values = { date_format: "MM/DD/YYYY" };

    const { container } = render(
      <RelatedDayInfo
        label="Harvest: "
        relatedDayNumbers={[6]}
        selectedWeek={41}
        selectedYear={2026}
      />,
    );

    expect(container).toHaveTextContent(`Harvest: ${weekdayDate("2026-10-11", "MM/DD/YYYY")}`);
    expect(container).toHaveTextContent("10/11/2026");
  });

  it("lets the page format the days itself", () => {
    const formatDate = vi.fn((day: number) => `day ${day}`);

    const { container } = render(
      <RelatedDayInfo
        label="Packing: "
        relatedDayNumbers={[0, 2]}
        selectedWeek={41}
        selectedYear={2026}
        formatDate={formatDate}
      />,
    );

    expect(container).toHaveTextContent("Packing: day 0 / day 2");
  });

  it("shows only the label when there are no related days", () => {
    const { container } = render(
      <RelatedDayInfo label="Delivery days: " relatedDayNumbers={[]} selectedWeek={41} selectedYear={2026} />,
    );

    expect(container.textContent).toBe("Delivery days: ");
  });
});
