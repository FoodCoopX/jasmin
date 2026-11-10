/**
 * MissingWorkDaysBanner: the red banner over the commissioning pages while a
 * delivery day running today or later lacks a harvesting, packing, washing or
 * cleaning day. The generated delivery-day list hook is the mocking boundary.
 *
 * The clock is frozen on Monday 9 November 2026: a delivery day starting after
 * it is named with its start.
 */

import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SharesDeliveryDay } from "@shared/api/generated/models";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    // Interpolated values follow the key, so a test can read what was filled in.
    t: (key: string, values?: unknown) =>
      values && typeof values === "object"
        ? `${key} ${Object.values(values).join(" | ")}`
        : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Per-test tenant settings over the mock's own.
const tenantSettings = vi.hoisted(() => ({ values: {} as Record<string, unknown> }));
vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const base = makeUseTenantMock();
  const tenant = {
    ...base,
    getSetting: (key: string, defaultValue?: unknown) =>
      key in tenantSettings.values
        ? tenantSettings.values[key]
        : base.getSetting(key, defaultValue),
  };
  return { useTenant: () => tenant };
});

// ``useRoles`` is real; it reads the roles of the signed-in user from here.
const auth = vi.hoisted(() => ({ roles: ["admin"] as string[] }));
vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { roles: auth.roles } }),
}));

const deliveryDays = vi.hoisted(() => ({
  rows: [] as SharesDeliveryDay[],
  params: [] as unknown[],
}));
vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  useCommissioningSharesDeliveryDaysList: (params: unknown) => {
    deliveryDays.params.push(params);
    return { data: deliveryDays.rows };
  },
}));

import MissingWorkDaysBanner from "../MissingWorkDaysBanner";

const deliveryDay = (overrides: Partial<SharesDeliveryDay>): SharesDeliveryDay =>
  ({
    id: "day-wednesday",
    day_number: 2,
    valid_from: "2026-01-05",
    valid_until: null,
    default_harvesting_day: 1,
    default_packing_day: 2,
    default_washing_day: 1,
    default_cleaning_day: 1,
    default_get_current_stock_day: null,
    ...overrides,
  }) as SharesDeliveryDay;

function renderBanner() {
  render(
    <MemoryRouter>
      <MissingWorkDaysBanner />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 9, 12, 0));
  auth.roles = ["admin"];
  tenantSettings.values = {};
  deliveryDays.rows = [];
  deliveryDays.params = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("MissingWorkDaysBanner", () => {
  it("asks for the delivery days running today or later", () => {
    renderBanner();

    expect(deliveryDays.params).toContainEqual({ active_at_date_or_future: "2026-11-09" });
  });

  it("shows nothing while every delivery day has its work days", () => {
    deliveryDays.rows = [deliveryDay({})];
    renderBanner();

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names each delivery day lacking work days and what it lacks, a later one with its start", () => {
    deliveryDays.rows = [
      deliveryDay({ default_harvesting_day: null, default_packing_day: null }),
      deliveryDay({ id: "day-friday", day_number: 4 }),
      deliveryDay({
        id: "day-saturday-next",
        day_number: 5,
        valid_from: "2026-11-16",
        default_cleaning_day: null,
      }),
    ];
    renderBanner();

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("commissioning.missing_work_days.title");
    const lines = Array.from(banner.querySelectorAll("li")).map((line) => line.textContent);
    expect(lines).toEqual([
      "commissioning.missing_work_days.day common.weekday_wednesday | 05.01.2026 | " +
        "configuration.default_harvesting_day, configuration.default_packing_day",
      "commissioning.missing_work_days.day_from common.weekday_saturday | 16.11.2026 | " +
        "configuration.default_cleaning_day",
    ]);
  });

  it("asks for no washing or cleaning day on a farm that hides them", () => {
    tenantSettings.values = { show_washing: false, show_cleaning: false };
    deliveryDays.rows = [
      deliveryDay({ default_washing_day: null, default_cleaning_day: null }),
      deliveryDay({
        id: "day-friday",
        day_number: 4,
        default_cleaning_day: null,
        default_packing_day: null,
      }),
    ];
    renderBanner();

    const lines = Array.from(screen.getByRole("alert").querySelectorAll("li")).map(
      (line) => line.textContent,
    );
    expect(lines).toEqual([
      "commissioning.missing_work_days.day common.weekday_friday | 05.01.2026 | " +
        "configuration.default_packing_day",
    ]);
  });

  it("links an admin to the delivery days", () => {
    deliveryDays.rows = [deliveryDay({ default_washing_day: null })];
    renderBanner();

    expect(
      screen.getByRole("link", { name: "commissioning.missing_work_days.link" }),
    ).toHaveAttribute("href", "/configuration/time-management");
  });

  it("tells everyone else who can set them", () => {
    auth.roles = ["office"];
    deliveryDays.rows = [deliveryDay({ default_washing_day: null })];
    renderBanner();

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "commissioning.missing_work_days.ask_admin",
    );
  });
});
