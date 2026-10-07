/**
 * The current-stock documentation's phone card: the article and its size, the
 * expected and the counted stock, the note, the tags saying whom the stock is
 * for, and a tap that opens the row's edit dialog. Both stock figures are
 * numbers on the wire.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { DocumentationCurrentStockMobileCard } from "../DocumentationCurrentStockMobileCard";

const EXPECTED = "commissioning.expected";
const ACTUAL = "commissioning.actual";
const PCS = "commissioning.units.pcs";
const FOR_SHARES = "commissioning.for_shares";
const FOR_RESELLERS = "commissioning.for_resellers";

function stockRow(overrides: Partial<TableRecord> = {}): TableRecord {
  return {
    key: "cs-cabbage",
    id: "cs-cabbage",
    share_article_name: "Cabbage",
    unit: "PCS",
    size: "M",
    theoretical_current_stock: 40,
    amount: 38,
    note: "Back of the cold room",
    for_shares: true,
    for_resellers: true,
    is_finalized: false,
    ...overrides,
  };
}

const onEdit = vi.fn();

beforeEach(() => {
  onEdit.mockReset();
  numberLocale.value = "de-DE";
});

function renderCard(record: TableRecord = stockRow(), editable = true) {
  return render(
    <DocumentationCurrentStockMobileCard
      record={record}
      onEdit={editable ? onEdit : undefined}
    />,
  );
}

const card = () => document.querySelector<HTMLElement>(".mobile-card-item")!;

/** The card's figures as [label, amount, unit], in the order shown. */
function figures(): string[][] {
  return Array.from(card().querySelectorAll(".flex-baseline")).map((line) => [
    line.parentElement?.querySelector(".text-muted-xs")?.textContent ?? "",
    line.firstElementChild?.textContent ?? "",
    line.querySelector(".text-secondary")?.textContent ?? "",
  ]);
}

/** The counted stock, the card's last figure. */
const actualAmount = () =>
  Array.from(card().querySelectorAll(".flex-baseline")).at(-1)!
    .firstElementChild as HTMLElement;

const tags = () =>
  Array.from(card().querySelectorAll(".mobile-card-tag")).map((tag) => tag.textContent);

describe("DocumentationCurrentStockMobileCard contents", () => {
  it("shows the article, the expected stock with its unit, then the counted stock, the note and the tags", () => {
    renderCard();

    expect(screen.getByText("Cabbage")).toBeInTheDocument();
    expect(figures()).toEqual([
      [EXPECTED, "40", PCS],
      [ACTUAL, "38", ""],
    ]);
    expect(screen.getByText("Back of the cold room")).toHaveClass("text-meta");
    expect(tags()).toEqual([FOR_SHARES, FOR_RESELLERS]);
  });

  it("shows a placeholder for no expected stock, and then the unit beside the counted one", () => {
    renderCard(stockRow({ theoretical_current_stock: null }));

    expect(figures()).toEqual([
      [EXPECTED, "–", PCS],
      [ACTUAL, "38", PCS],
    ]);
  });

  it("shows a negative expected stock", () => {
    renderCard(stockRow({ theoretical_current_stock: -5 }));

    expect(figures()[0]).toEqual([EXPECTED, "-5", PCS]);
  });

  it("shows a placeholder in the muted colour while nothing is counted", () => {
    renderCard(stockRow({ amount: null }));

    expect(figures()[1]).toEqual([ACTUAL, "–", ""]);
    expect(actualAmount()).toHaveStyle({ color: "var(--color-text-muted)" });
  });

  it("colours a counted stock green and a count of zero muted", () => {
    const { unmount } = renderCard();
    expect(actualAmount()).toHaveStyle({ color: "var(--color-success-text)" });
    unmount();

    renderCard(stockRow({ amount: 0 }));
    expect(figures()[1][1]).toBe("0");
    expect(actualAmount()).toHaveStyle({ color: "var(--color-text-muted)" });
  });

  it.each([
    [{ for_shares: true, for_resellers: false }, [FOR_SHARES]],
    [{ for_shares: false, for_resellers: true }, [FOR_RESELLERS]],
  ])("tags only whom the stock is for (%o)", (flags, expected) => {
    renderCard(stockRow(flags));

    expect(tags()).toEqual(expected);
  });

  it("shows no tags, note or size label where the row has none", () => {
    renderCard(stockRow({ for_shares: false, for_resellers: null, note: null }));

    expect(card().querySelector(".mobile-card-tag")).toBeNull();
    expect(card().querySelector(".text-meta")).toBeNull();
    expect(card().querySelector(".text-hint")).toBeNull();
  });

  it.each([
    ["S", "commissioning.small"],
    ["L", "commissioning.large"],
  ])("labels size %s after the article name", (size, label) => {
    renderCard(stockRow({ size }));

    expect(screen.getByText(label)).toHaveClass("text-hint");
  });

  it("marks a finalized row for sight and for screen readers", () => {
    renderCard(stockRow({ is_finalized: true }));

    expect(card()).toHaveClass("mobile-card-finalized");
    expect(screen.getByRole("img", { name: "commissioning.finalized" })).toBeInTheDocument();
  });

  it.skip.each([
    ["de-DE", "1.235", "1.200"],
    ["en-US", "1,235", "1,200"],
  ])(
    "shows the stock in the %s number format, as the table does",
    (locale, expected, actual) => {
      numberLocale.value = locale;
      renderCard(stockRow({ theoretical_current_stock: 1234.6, amount: 1200 }));

      expect(figures().map(([, amount]) => amount)).toEqual([expected, actual]);
    },
  );
});

describe("DocumentationCurrentStockMobileCard actions", () => {
  it("opens the row's edit dialog on a tap or Enter", async () => {
    const user = userEvent.setup();
    const record = stockRow();
    renderCard(record);

    await user.click(screen.getByText("Cabbage"));
    expect(onEdit).toHaveBeenCalledWith(record);

    card().focus();
    await user.keyboard("{Enter}");
    expect(onEdit).toHaveBeenCalledTimes(2);
  });

  it("is not a button when the row can't be edited", async () => {
    const user = userEvent.setup();
    renderCard(stockRow(), false);

    expect(card()).not.toHaveAttribute("role");
    expect(card()).not.toHaveAttribute("tabindex");
    await user.click(screen.getByText("Cabbage"));
    expect(onEdit).not.toHaveBeenCalled();
  });
});
