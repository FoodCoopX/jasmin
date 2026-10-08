/**
 * ``useAbosColumns`` passes the tenant's onboarding mode to
 * ``useSubscriptionTerm`` as ``allowPastStart``: the Abos grid is edited by the
 * office only, so while the mode is on any Monday may be the start date.
 *
 * Boundary mocked: react-i18next, every hook the column factory reads and the
 * shared column / UI modules except the real ``LinkButton``. The term hook
 * records the options it receives.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const hookState = vi.hoisted(() => ({
  onboardingMode: false,
  termOptions: undefined as { allowPastStart?: boolean } | undefined,
}));

vi.mock("@hooks/configuration/useTenant", () => ({
  useTenant: () => ({
    getSetting: (key: string, defaultValue?: unknown) =>
      key === "onboarding_mode" ? hookState.onboardingMode : defaultValue,
  }),
}));
vi.mock("@hooks/configuration/useCurrency", () => ({
  useCurrency: () => ({ currencySymbol: "€" }),
}));
vi.mock("@hooks/configuration/useDateFormat", () => ({
  useDateFormat: () => ({
    dateFormat: "DD.MM.YYYY",
    formatDate: (value: unknown) => (value ? String(value) : null),
  }),
}));
vi.mock("@hooks/useNumberFormat", () => ({
  useNumberFormat: () => ({ format: (value: number) => String(value) }),
}));
vi.mock("@hooks/useSubscriptionTerm", () => ({
  useSubscriptionTerm: (options?: { allowPastStart?: boolean }) => {
    hookState.termOptions = options;
    return {
      allowsTrial: false,
      computeValidUntil: () => null,
      disabledValidFromDate: () => false,
    };
  },
}));
vi.mock("@hooks/columns/useActiveStatusColumn", () => ({
  useActiveStatusColumn: () => ({ key: "active_status" }),
}));
vi.mock("@hooks/columns/useSepaMandateColumn", () => ({
  useSepaMandateColumn: () => ({ key: "sepa_mandate" }),
}));
vi.mock("@hooks/columns/useTimeBoundColumns", () => ({
  useTimeBoundColumns: () => ({
    validFromColumn: { key: "valid_from", dataIndex: "valid_from" },
    validUntilColumn: { key: "valid_until", dataIndex: "valid_until" },
  }),
}));
vi.mock("../columns/useSharedAboColumns", () => ({
  useSharedAboColumns: () => ({
    displayIdColumn: { key: "display_id" },
    memberColumn: { key: "member" },
    shareTypeVariationColumn: { key: "share_type_variation" },
    quantityColumn: { key: "quantity" },
    deliveryStationDayColumn: { key: "delivery_station_day" },
  }),
}));
vi.mock("@shared/tables", () => ({
  adminConfirmationColumn: () => ({ key: "admin_confirmed" }),
}));
vi.mock("@shared/ui", async () => {
  const { LinkButton } = await vi.importActual<
    typeof import("@shared/ui/ButtonLibrary")
  >("@shared/ui/ButtonLibrary");
  return { LinkButton, StatusButton: () => null, ToolTipIcon: () => null };
});

import { useAbosColumns } from "../columns/useAbosColumns";

function renderColumns(
  paymentCycles: { value: string; label: string }[] = [],
) {
  return renderHook(() =>
    useAbosColumns({
      members: [],
      paymentCycles,
      allShareTypeVariations: [],
      variationDeliveryCycleById: new Map(),
      getDeliveryStationDaysForRow: () => [],
      getShareTypeVariationsForRow: () => [],
      getAdminStatus: () => ({ variant: "adminPending", key: "admin_pending" }),
      onOpenAdminConfirmation: () => {},
      adminStatusSorter: () => 0,
      recentlyAddedIds: new Set<string>(),
      onCancel: () => {},
      onShowLog: () => {},
      getMandateForMember: () => undefined,
      onShowSepaDetails: () => {},
    } as unknown as Parameters<typeof useAbosColumns>[0]),
  );
}

beforeEach(() => {
  hookState.onboardingMode = false;
  hookState.termOptions = undefined;
});

describe("useAbosColumns start-date rule", () => {
  it("keeps the lead time while onboarding mode is off", () => {
    const { result } = renderColumns();

    expect(result.current.columns.length).toBeGreaterThan(0);
    expect(hookState.termOptions).toEqual({ allowPastStart: false });
  });

  it("allows any Monday as the start while onboarding mode is on", () => {
    hookState.onboardingMode = true;
    renderColumns();

    expect(hookState.termOptions).toEqual({ allowPastStart: true });
  });
});

describe("useAbosColumns payment cycle", () => {
  function paymentCycleDisabled(cycleCount: number) {
    const cycles = Array.from({ length: cycleCount }, (_, index) => ({
      value: `cycle-${index}`,
      label: `Cycle ${index}`,
    }));
    const column = renderColumns(cycles).result.current.columns.find(
      (candidate: { key?: unknown }) => candidate.key === "payment_cycle_name",
    );
    return column?.disabled as (record: Record<string, unknown>) => boolean;
  }

  it("is fixed on a saved abo when only one cycle is allowed", () => {
    const disabled = paymentCycleDisabled(1);

    expect(disabled({ key: "abo-1", admin_confirmed: false })).toBe(true);
    // The new row still picks it: it has no stored cycle to save.
    expect(disabled({ key: -1 })).toBe(false);
  });

  it("stays editable with several cycles until the abo is confirmed", () => {
    const disabled = paymentCycleDisabled(2);

    expect(disabled({ key: "abo-1", admin_confirmed: false })).toBe(false);
    expect(disabled({ key: "abo-1", admin_confirmed: true })).toBe(true);
    expect(disabled({ key: -1 })).toBe(false);
  });
});

describe("useAbosColumns member link", () => {
  function renderLinkCell(record: Record<string, unknown>) {
    const column = renderColumns().result.current.columns.find(
      (candidate: { key?: unknown }) => candidate.key === "link",
    );
    const renderCell = column?.render as (
      value: unknown,
      record: Record<string, unknown>,
    ) => React.ReactNode;
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/abos"]}>
        <Routes>
          <Route path="/abos" element={<>{renderCell(undefined, record)}</>} />
          <Route path="/members/members/:id" element={<p>Member page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    return { user };
  }

  it("opens the member of a saved abo", async () => {
    const { user } = renderLinkCell({ key: "abo-1", member: "m-1" });

    const link = screen.getByRole("link", { name: "members.view_details" });
    expect(link).toHaveAttribute("href", "/members/members/m-1");
    await user.click(link);

    expect(screen.getByText("Member page")).toBeInTheDocument();
  });

  it.each([
    ["the new row", { key: -1, member: "m-1" }],
    ["a row in edit", { key: "abo-1", member: "m-1", isEditing: true }],
  ])("goes nowhere from %s", async (_, record) => {
    const { user } = renderLinkCell(record);

    const link = screen.getByText((__, element) => element?.tagName === "A");
    expect(link).not.toHaveAttribute("href");
    expect(link).toHaveAttribute("aria-disabled", "true");
    await user.click(link);

    expect(screen.queryByText("Member page")).not.toBeInTheDocument();
  });
});
