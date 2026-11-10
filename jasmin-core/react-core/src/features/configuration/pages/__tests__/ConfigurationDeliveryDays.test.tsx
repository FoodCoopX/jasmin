/**
 * ConfigurationDeliveryDays: the weekdays shares and orders are delivered on.
 * Rendered through the real EditableTable and time-bound column hooks; the
 * generated commissioning client is the mocking boundary, its list hooks real
 * TanStack queries around spies.
 *
 * Nothing these tests check depends on today's date, so the clock runs free.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SharesDeliveryDay } from "@shared/api/generated/models";
import { TenantContext } from "@shared/contexts/TenantContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
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

// What the deployment offers, per test; a capability left unset is offered.
const deployment = { capabilities: {} as Record<string, boolean> };

// ``useRoles`` is real; it reads the roles of the signed-in user from here.
vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { roles: ["office"] } }),
}));

vi.mock("@shared/contexts/ModalContext", () => ({
  useModal: () => ({ isModalMode: false }),
}));

const api = vi.hoisted(() => ({
  listShareDays: vi.fn(),
  createShareDay: vi.fn(),
}));

vi.mock("@shared/api/generated/commissioning/commissioning", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const shareDaysKey = (params?: unknown) => [
    "/api/commissioning/shares_delivery_days/",
    ...(params ? [params] : []),
  ];
  const orderDaysKey = () => ["/api/commissioning/orders_delivery_days/"];
  return {
    getCommissioningSharesDeliveryDaysListQueryKey: shareDaysKey,
    getCommissioningOrdersDeliveryDaysListQueryKey: orderDaysKey,
    useCommissioningSharesDeliveryDaysList: (params?: unknown) =>
      useQuery({ queryKey: shareDaysKey(params), queryFn: () => api.listShareDays(params) }),
    useCommissioningOrdersDeliveryDaysList: () =>
      useQuery({ queryKey: orderDaysKey(), queryFn: async () => [] }),
    commissioningSharesDeliveryDaysCreate: (day: unknown) => api.createShareDay(day),
    commissioningSharesDeliveryDaysPartialUpdate: vi.fn(),
    commissioningSharesDeliveryDaysDestroy: vi.fn(),
    commissioningOrdersDeliveryDaysCreate: vi.fn(),
    commissioningOrdersDeliveryDaysPartialUpdate: vi.fn(),
    commissioningOrdersDeliveryDaysDestroy: vi.fn(),
  };
});

import ConfigurationDeliveryDays from "../ConfigurationDeliveryDays";

const WEDNESDAY: SharesDeliveryDay = {
  id: "day-wednesday",
  day_number: 2,
  valid_from: "2026-01-05",
  valid_until: null,
  default_harvesting_day: 1,
  default_packing_day: 2,
  default_washing_day: 1,
  default_cleaning_day: 1,
  default_get_current_stock_day: 1,
  number_of_tours: 2,
  can_be_deleted: false,
} as SharesDeliveryDay;

// Not in use yet, so the office could delete it.
const FRIDAY: SharesDeliveryDay = {
  ...WEDNESDAY,
  id: "day-friday",
  day_number: 4,
  can_be_deleted: true,
} as SharesDeliveryDay;

const TOURS = "configuration.number_of_tours";

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const tenantContext = { tenant: deployment } as unknown as Parameters<
    typeof TenantContext.Provider
  >[0]["value"];
  render(
    <QueryClientProvider client={queryClient}>
      <TenantContext.Provider value={tenantContext}>
        <ConfigurationDeliveryDays />
      </TenantContext.Provider>
    </QueryClientProvider>,
  );
}

function editingRow(): HTMLElement {
  const row = screen.getByRole("button", { name: "table.save" }).closest("tr");
  if (!row) throw new Error("No row is being edited");
  return row;
}

/** The cell of ``row`` under the share days' column whose title starts so. */
function cellOf(row: HTMLElement, columnTitle: string): HTMLElement {
  const table = row.closest("table");
  const titles = Array.from(table?.querySelectorAll("thead th") ?? []).map(
    (th) => th.textContent ?? "",
  );
  const index = titles.findIndex((title) => title.startsWith(columnTitle));
  const cell = row.querySelectorAll<HTMLElement>(":scope > td")[index];
  if (index < 0 || !cell) throw new Error(`No column titled ${columnTitle}`);
  return cell;
}

async function startNewShareDay() {
  await screen.findAllByText("configuration.acronym_wednesday");
  const [shareDaysAdd] = screen.getAllByRole("button", { name: /table\.add_record/ });
  await userEvent.click(shareDaysAdd);
}

/** The rows of the share delivery days, the page's first table. */
const shareDayRows = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(".ant-table-tbody")[0]?.querySelectorAll<HTMLElement>(
      ":scope > tr.ant-table-row",
    ) ?? [],
  );

beforeEach(() => {
  deployment.capabilities = {};
  tenantSettings.values = {};
  api.listShareDays.mockReset().mockResolvedValue([WEDNESDAY, FRIDAY]);
  api.createShareDay.mockReset().mockImplementation(async (day: SharesDeliveryDay) => ({
    ...day,
    id: "day-new",
  }));
});

describe("ConfigurationDeliveryDays new delivery day", () => {
  it("starts a new delivery day with one tour", async () => {
    renderPage();
    await startNewShareDay();

    expect(within(editingRow()).getByLabelText(TOURS)).toHaveValue("1");
  });

  it("refuses to save a new delivery day without a number of tours", async () => {
    renderPage();
    await startNewShareDay();

    await userEvent.clear(within(editingRow()).getByLabelText(TOURS));
    await userEvent.click(screen.getByRole("button", { name: "table.save" }));

    expect(await within(cellOf(editingRow(), TOURS)).findByText("table.required")).toBeInTheDocument();
    expect(api.createShareDay).not.toHaveBeenCalled();
  });
});

describe("ConfigurationDeliveryDays where the host brings the delivery days", () => {
  beforeEach(() => {
    deployment.capabilities = { delivery_stations: false };
  });

  it("adds and deletes no share delivery day", async () => {
    renderPage();
    await screen.findAllByText("configuration.acronym_wednesday");

    // The one add button left belongs to the order days.
    expect(screen.getAllByRole("button", { name: /table\.add_record/ })).toHaveLength(1);
    for (const row of shareDayRows()) {
      expect(within(row).queryByRole("button", { name: "table.delete" })).not.toBeInTheDocument();
    }
  });

  it("keeps a share delivery day's weekday and validity, and lets the office set its tours", async () => {
    renderPage();
    await screen.findAllByText("configuration.acronym_wednesday");

    await userEvent.click(within(shareDayRows()[1]).getByRole("button", { name: "table.edit" }));

    const row = editingRow();
    expect(within(row).queryByLabelText("configuration.valid_from")).not.toBeInTheDocument();
    expect(within(row).queryByLabelText("configuration.valid_until")).not.toBeInTheDocument();
    expect(within(row).queryByLabelText("configuration.delivery_day")).not.toBeInTheDocument();
    expect(within(row).getByLabelText(TOURS)).toBeEnabled();
  });
});

describe("ConfigurationDeliveryDays on a farm that hides washing and cleaning", () => {
  it("shows the washing and cleaning days on both tables by default", async () => {
    renderPage();
    await screen.findAllByText("configuration.acronym_wednesday");

    expect(screen.getAllByText("configuration.default_washing_day").length).toBeGreaterThan(0);
    expect(screen.getAllByText("configuration.default_cleaning_day").length).toBeGreaterThan(0);
  });

  it("leaves them out of both tables", async () => {
    tenantSettings.values = { show_washing: false, show_cleaning: false };
    renderPage();
    await screen.findAllByText("configuration.acronym_wednesday");

    expect(screen.queryByText("configuration.default_washing_day")).not.toBeInTheDocument();
    expect(screen.queryByText("configuration.default_cleaning_day")).not.toBeInTheDocument();
    expect(screen.getAllByText("configuration.default_harvesting_day").length).toBeGreaterThan(0);
  });
});
