import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ChargeScheduleStatusEnum,
  type ChargeSchedule,
} from "@shared/api/generated/models";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock();
  return { useTenant: () => tenant };
});

// The selectors fetch their own options; the page only needs them to render.
vi.mock("@shared/selectors", () => ({
  MemberSelector: () => null,
  MonthSelector: () => null,
  YearSelector: () => null,
}));

const charges = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock(
  "@shared/api/generated/payments-—-charge-schedule/payments-—-charge-schedule",
  () => ({
    getPaymentsChargeSchedulesListQueryKey: () => ["charges"],
    paymentsChargeSchedulesRegenerateCreate: vi.fn(),
    usePaymentsChargeSchedulesList: () => ({
      data: charges.rows,
      isFetching: false,
      refetch: vi.fn(),
    }),
  }),
);

import ChargesAbos from "../ChargesAbos";

/** ``count`` members named "Member 001" …, each with two monthly charges. */
function twoChargesEach(count: number): ChargeSchedule[] {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(3, "0");
    return ["2026-10-01", "2026-11-01"].map((due): ChargeSchedule => ({
      id: `charge-${number}-${due}`,
      member: `member-${number}`,
      member_name: `Member ${number}`,
      subscription: `sub-${number}`,
      subscription_label: "Vegetables M",
      period_start: due,
      period_end: due,
      due_date: due,
      expected_amount: "20.00",
      status: ChargeScheduleStatusEnum.PLANNED,
    }));
  }).flat();
}

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ChargesAbos />
    </QueryClientProvider>,
  );
}

/** The table row holding ``text``. */
const rowWith = (text: string) => screen.getByText(text).closest("tr")!;

describe("ChargesAbos", () => {
  it("lines each member's subtotal row up with the charge rows", () => {
    charges.rows = twoChargesEach(1);
    renderPage();

    const memberCell = screen.getByText("Member 001").closest("td")!;
    expect(memberCell).toHaveAttribute("rowspan", "3");

    const subtotalCells = within(rowWith("abos.charges_subtotal_label")).getAllByRole(
      "cell",
    );
    // The label spans the four charge columns and the amount follows; the
    // member column is covered by the first charge's cell.
    expect(subtotalCells).toHaveLength(2);
    expect(subtotalCells[0]).toHaveAttribute("colspan", "4");
  });

  it("pages by member, so a member's charges never split across pages", async () => {
    charges.rows = twoChargesEach(51);
    renderPage();

    // 50 members a page: the 50th member's charges and subtotal are all here.
    expect(screen.getByText("Member 050").closest("td")).toHaveAttribute(
      "rowspan",
      "3",
    );
    expect(screen.queryByText("Member 051")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("listitem", { name: "2" }));

    expect(screen.getByText("Member 051").closest("td")).toHaveAttribute(
      "rowspan",
      "3",
    );
    expect(screen.getAllByText("abos.charges_subtotal_label")).toHaveLength(1);
  });
});
