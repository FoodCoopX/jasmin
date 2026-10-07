/**
 * The bulk packing list's phone card: the article and its size, the total
 * amount at its unit's precision in the farm's number format, and the note.
 * The list is read-only, so the card is never a button.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TableRecord } from "@shared/tables/BasicEditableTable/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const numberLocale = vi.hoisted(() => ({ value: "de-DE" }));
vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock({
    getSetting: (key: string, defaultValue?: unknown) =>
      key === "number_locale" ? numberLocale.value : defaultValue,
  });
  return { useTenant: () => tenant };
});

import { PackingListBulkMobileCard } from "../PackingListBulkMobileCard";

const TOTAL = "commissioning.total_amount";

function bulkRow(overrides: Partial<TableRecord> = {}): TableRecord {
  return {
    key: "pb-potatoes",
    id: "pb-potatoes",
    share_article_name: "Potatoes",
    unit: "KG",
    size: "M",
    total_amount: "1234.5",
    note: "Sort out the green ones",
    ...overrides,
  };
}

beforeEach(() => {
  numberLocale.value = "de-DE";
});

const card = () => document.querySelector<HTMLElement>(".mobile-card-item")!;

/** The total as [label, amount, unit]. */
function total(): string[] {
  const line = card().querySelector(".flex-baseline")!;
  return [
    line.parentElement?.querySelector(".text-muted-xs")?.textContent ?? "",
    line.firstElementChild?.textContent ?? "",
    line.querySelector(".text-secondary")?.textContent ?? "",
  ];
}

describe("PackingListBulkMobileCard", () => {
  it("shows the article, its total amount with the unit, and the note", () => {
    render(<PackingListBulkMobileCard record={bulkRow()} />);

    expect(screen.getByText("Potatoes")).toBeInTheDocument();
    expect(total()).toEqual([TOTAL, "1.234,50", "commissioning.units.kg"]);
    expect(screen.getByText("Sort out the green ones")).toHaveClass("text-meta");
  });

  it.each([
    ["de-DE", "KG", "1234.5", "1.234,50"],
    ["de-DE", "PCS", "12", "12,0"],
    ["de-DE", "BUNCH", 7.25, "7,3"],
    ["en-US", "KG", "1234.5", "1,234.50"],
    ["en-US", "PCS", "12", "12.0"],
    ["en-US", "BUNCH", 7.25, "7.3"],
  ])(
    "writes the total in the %s format at the precision of %s",
    (locale, unit, amount, expected) => {
      numberLocale.value = locale;
      render(<PackingListBulkMobileCard record={bulkRow({ unit, total_amount: amount })} />);

      expect(total()[1]).toBe(expected);
    },
  );

  it("shows zero as an amount", () => {
    render(<PackingListBulkMobileCard record={bulkRow({ total_amount: 0 })} />);

    expect(total()[1]).toBe("0,00");
  });

  it.each([null, undefined, ""])("shows a placeholder for a missing total (%o)", (amount) => {
    render(<PackingListBulkMobileCard record={bulkRow({ total_amount: amount })} />);

    expect(total()[1]).toBe("–");
  });

  it.each([
    ["S", "commissioning.small"],
    ["L", "commissioning.large"],
  ])("labels size %s after the article name", (size, label) => {
    render(<PackingListBulkMobileCard record={bulkRow({ size })} />);

    expect(screen.getByText(label)).toHaveClass("text-hint");
  });

  it("shows no size label for size M and no note line without a note", () => {
    render(<PackingListBulkMobileCard record={bulkRow({ note: "" })} />);

    expect(card().querySelector(".text-hint")).toBeNull();
    expect(card().querySelector(".text-meta")).toBeNull();
  });

  it("is not a button", () => {
    render(<PackingListBulkMobileCard record={bulkRow()} />);

    expect(card()).not.toHaveAttribute("role");
    expect(card()).not.toHaveAttribute("tabindex");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
