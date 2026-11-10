/**
 * useOrderColumns: the offer line's "still available" cell, the crate table's
 * price, discount and note cells on a line holding deposit crates, and the work
 * days a saved line carries. The column hooks it composes and the shared
 * formatting hooks are stubbed.
 */
import { render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const crateColumns = vi.hoisted(() => [
  { key: "crate_type_name", dataIndex: "crate_type_name" },
  { key: "amount", dataIndex: "amount" },
  { key: "price_per_unit", dataIndex: "price_per_unit" },
  { key: "rabatt", dataIndex: "rabatt" },
]);

// What the crate columns were last asked for.
const cratesRequest = vi.hoisted(() => ({ options: undefined as unknown }));

vi.mock("@features/commissioning/hooks", () => ({
  useCratesColumns: (options: { showNote?: boolean } = {}) => {
    cratesRequest.options = options;
    const { showNote = true } = options;
    return {
      cratesColumns: showNote
        ? [...crateColumns, { key: "note", dataIndex: "note" }]
        : crateColumns,
      crates: [],
    };
  },
  useOfferOptions: () => ({ offers: [] }),
  useOfferTiers: () => [1],
  useShareArticleColumn: () => ({
    shareArticleColumn: { key: "share_article", dataIndex: "share_article" },
    handleUnitChange: vi.fn(),
    handleAmountChange: vi.fn(),
  }),
  useWashingCleaningColumns: () => ({ washingCleaningColumns: [] }),
}));
// Whether the farm shows washing and cleaning, per test.
const shownWorkDays = vi.hoisted(() => ({ showsWashing: true, showsCleaning: true }));
vi.mock("@hooks/index", () => ({
  useWashingCleaningVisibility: () => shownWorkDays,
  useCurrency: () => ({ currencySymbol: "€", formatCurrency: String }),
  useNoteColumn: () => ({ noteColumn: { key: "note", dataIndex: "note" } }),
  useNumberFormat: () => ({
    format: (value: number, digits: number) => value.toFixed(digits),
  }),
  useUnitOptions: () => ({ getUnitLabel: String }),
}));
vi.mock("../useAmountUnitSizeColumns", () => ({
  useAmountUnitSizeColumns: () => ({ amountUnitSizeColumns: [] }),
}));

import { useOrderColumns } from "../useOrderColumns";

function availableCell(value: unknown) {
  const { result } = renderHook(() =>
    useOrderColumns({
      params: { year: 2026, delivery_week: 40, day_number: 2, reseller: "r1" },
      dataCrates: [],
    }),
  );
  const column = result.current.columnsOffers.find(
    (col) => col.key === "offer_available_amount",
  );
  const cell = column?.render?.(value, { key: "1" }, 0) as ReactNode;
  render(<>{cell}</>);
  return screen.getByText(/commissioning\.pu/);
}

describe("useOrderColumns still-available cell", () => {
  it("marks an offer with nothing left, small", () => {
    const cell = availableCell(0);

    expect(cell).toHaveClass("amount-none-left", "text-xs");
    expect(cell).not.toHaveAttribute("style");
  });

  it("marks an offer with some left, small", () => {
    const cell = availableCell(3);

    expect(cell).toHaveClass("amount-left", "text-xs");
    expect(cell).not.toHaveAttribute("style");
  });

  it("counts a missing amount as nothing left", () => {
    expect(availableCell(null)).toHaveClass("amount-none-left");
  });
});

describe("useOrderColumns crate prices", () => {
  it("prices a picked crate at the order's week, as its articles", () => {
    renderHook(() =>
      useOrderColumns({
        params: { year: 2026, delivery_week: 40, day_number: 2, reseller: "r1" },
        dataCrates: [],
      }),
    );

    // The Saturday of ISO week 40 of 2026.
    expect(cratesRequest.options).toEqual({ priceDate: "2026-10-03" });
  });
});

describe("useOrderColumns crate cells", () => {
  function crateCellDisabled(key: string, record: Record<string, unknown>) {
    const { result } = renderHook(() =>
      useOrderColumns({
        params: { year: 2026, delivery_week: 40, day_number: 2, reseller: "r1" },
        dataCrates: [],
      }),
    );
    const column = result.current.filteredColumnsCrates.find(
      (col) => col.key === key,
    );
    const disabled = column?.disabled;
    return typeof disabled === "function" ? disabled(record as never) : Boolean(disabled);
  }

  it.each(["price_per_unit", "rabatt"])(
    "locks %s on a line holding deposit crates",
    (key) => {
      expect(crateCellDisabled(key, { key: "1", offer_bound_amount: 4 })).toBe(true);
    },
  );

  it.each(["price_per_unit", "rabatt"])(
    "leaves %s editable on a line of added crates and a new line",
    (key) => {
      expect(crateCellDisabled(key, { key: "1", offer_bound_amount: 0 })).toBe(false);
      expect(crateCellDisabled(key, { key: -1 })).toBe(false);
    },
  );

  it("leaves the amount editable on a line holding deposit crates", () => {
    expect(crateCellDisabled("amount", { key: "1", offer_bound_amount: 4 })).toBe(
      false,
    );
  });

  it("shows the note column", () => {
    const { result } = renderHook(() =>
      useOrderColumns({
        params: { year: 2026, delivery_week: 40, day_number: 2, reseller: "r1" },
        dataCrates: [],
      }),
    );
    expect(
      result.current.filteredColumnsCrates.map((col) => col.key),
    ).toContain("note");
  });

  it("locks the note on a line holding only deposit crates", () => {
    expect(
      crateCellDisabled("note", { key: "1", amount: 4, offer_bound_amount: 4 }),
    ).toBe(true);
  });

  it("leaves the note editable while added crates remain, and on other lines", () => {
    expect(
      crateCellDisabled("note", { key: "1", amount: 6, offer_bound_amount: 4 }),
    ).toBe(false);
    expect(
      crateCellDisabled("note", { key: "1", amount: 4, offer_bound_amount: 0 }),
    ).toBe(false);
    expect(crateCellDisabled("note", { key: -1 })).toBe(false);
  });
});

describe("useOrderColumns saving an order line", () => {
  const ORDER_DAYS = { harvesting_day: 1, packing_day: 2, washing_day: null, cleaning_day: null };

  beforeEach(() => {
    shownWorkDays.showsWashing = true;
    shownWorkDays.showsCleaning = true;
  });

  function savedLine() {
    const { result } = renderHook(() =>
      useOrderColumns({
        params: { year: 2026, delivery_week: 40, day_number: 2, reseller: "r1" },
        dataCrates: [],
      }),
    );
    const save = result.current.createCustomSave(2026, 40, 2, "r1", ORDER_DAYS, [], () => null);
    // A row carries the order's days as the table loaded them, empty ones too.
    const line = save({ share_article: "sa-carrots", amount: 2, size: "M", washing_day: null, cleaning_day: null });
    // What the JSON body sends.
    return JSON.parse(JSON.stringify(line)) as Record<string, unknown>;
  }

  it("carries every work day of the order", () => {
    expect(savedLine()).toMatchObject(ORDER_DAYS);
  });

  it("leaves out washing and cleaning on a farm that hides them, so a new order takes their defaults", () => {
    shownWorkDays.showsWashing = false;
    shownWorkDays.showsCleaning = false;

    const line = savedLine();
    expect(line).toMatchObject({ harvesting_day: 1, packing_day: 2 });
    expect(line).not.toHaveProperty("washing_day");
    expect(line).not.toHaveProperty("cleaning_day");
  });
});
