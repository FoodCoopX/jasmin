/**
 * The harvest documentation's phone card: the article and its size, the
 * expected harvest (theoretical plus additional) and the actual harvest, the
 * note, and a tap that opens the row's edit dialog. The expected amounts are
 * numbers on the wire, the actual harvest a decimal string.
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

import { DocumentationHarvestMobileCard } from "../DocumentationHarvestMobileCard";

const EXPECTED = "commissioning.expected";
const ACTUAL = "commissioning.actual";
const KG = "commissioning.units.kg";

function harvestRow(overrides: Partial<TableRecord> = {}): TableRecord {
  return {
    key: "dh-carrots",
    id: "dh-carrots",
    share_article_name: "Carrots",
    unit: "KG",
    size: "M",
    theoretical_harvest_amount: 12,
    additional_theoretical_harvest_amount: 3,
    harvest_amount: "14.000",
    note: "Washed already",
    is_finalized: false,
    ...overrides,
  };
}

const onEdit = vi.fn();

beforeEach(() => {
  onEdit.mockReset();
  numberLocale.value = "de-DE";
});

interface CardOptions {
  record?: TableRecord;
  isLongTermStorage?: boolean;
  editable?: boolean;
}

function renderCard({
  record = harvestRow(),
  isLongTermStorage = false,
  editable = true,
}: CardOptions = {}) {
  return render(
    <DocumentationHarvestMobileCard
      record={record}
      onEdit={editable ? onEdit : undefined}
      isLongTermStorage={isLongTermStorage}
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

/** The actual amount, the card's last figure. */
const actualAmount = () =>
  Array.from(card().querySelectorAll(".flex-baseline")).at(-1)!
    .firstElementChild as HTMLElement;

describe("DocumentationHarvestMobileCard contents", () => {
  it("shows the article, the expected harvest with its unit, then the actual harvest, and the note", () => {
    renderCard();

    expect(screen.getByText("Carrots")).toBeInTheDocument();
    expect(figures()).toEqual([
      [EXPECTED, "15,00", KG],
      [ACTUAL, "14,00", ""],
    ]);
    expect(screen.getByText("Washed already")).toHaveClass("text-meta");
  });

  it("adds the additional expected harvest to the theoretical one", () => {
    renderCard({
      record: harvestRow({
        theoretical_harvest_amount: null,
        additional_theoretical_harvest_amount: 4,
      }),
    });

    expect(figures()[0]).toEqual([EXPECTED, "4,00", KG]);
  });

  it("shows a placeholder for no expected harvest, and then the unit beside the actual one", () => {
    renderCard({
      record: harvestRow({
        theoretical_harvest_amount: 0,
        additional_theoretical_harvest_amount: null,
      }),
    });

    expect(figures()).toEqual([
      [EXPECTED, "–", KG],
      [ACTUAL, "14,00", KG],
    ]);
  });

  it("leaves the expected harvest out for a long-term storage", () => {
    renderCard({ isLongTermStorage: true });

    expect(figures()).toEqual([[ACTUAL, "14,00", KG]]);
    expect(screen.queryByText(EXPECTED)).not.toBeInTheDocument();
  });

  it("shows a placeholder in the muted colour while nothing is harvested", () => {
    renderCard({ record: harvestRow({ harvest_amount: null }) });

    expect(figures()[1]).toEqual([ACTUAL, "–", ""]);
    expect(actualAmount()).toHaveClass("is-actual");
    expect(actualAmount()).not.toHaveClass("has-amount");
  });

  it("colours a harvested amount green and a zero harvest muted", () => {
    const { unmount } = renderCard();
    expect(actualAmount()).toHaveClass("is-actual", "has-amount");
    unmount();

    renderCard({ record: harvestRow({ harvest_amount: "0.000" }) });
    expect(actualAmount()).toHaveClass("is-actual");
    expect(actualAmount()).not.toHaveClass("has-amount");
  });

  it("shows no note line for a row without a note", () => {
    renderCard({ record: harvestRow({ note: "" }) });

    expect(card().querySelector(".text-meta")).toBeNull();
  });

  it.each([
    ["S", "commissioning.small"],
    ["L", "commissioning.large"],
  ])("labels size %s after the article name", (size, label) => {
    renderCard({ record: harvestRow({ size }) });

    expect(screen.getByText(label)).toHaveClass("text-hint");
  });

  it("shows no size label for the default size M", () => {
    renderCard();

    expect(card().querySelector(".text-hint")).toBeNull();
  });

  it("marks a finalized row for sight and for screen readers", () => {
    renderCard({ record: harvestRow({ is_finalized: true }) });

    expect(card()).toHaveClass("mobile-card-finalized");
    expect(screen.getByRole("img", { name: "commissioning.finalized" })).toBeInTheDocument();
  });

  it("does not mark an open row as finalized", () => {
    renderCard();

    expect(card()).not.toHaveClass("mobile-card-finalized");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it.each([
    ["de-DE", "15,75", "14,50", "0,30"],
    ["en-US", "15.75", "14.50", "0.30"],
  ])(
    "shows the amounts in the %s number format at the unit's precision",
    (locale, expected, actual, summed) => {
      numberLocale.value = locale;
      const { unmount } = renderCard({
        record: harvestRow({
          theoretical_harvest_amount: 12.5,
          additional_theoretical_harvest_amount: 3.25,
          harvest_amount: "14.500",
        }),
      });
      expect(figures().map(([, amount]) => amount)).toEqual([expected, actual]);
      unmount();

      renderCard({
        record: harvestRow({
          theoretical_harvest_amount: 0.1,
          additional_theoretical_harvest_amount: 0.2,
        }),
      });
      expect(figures()[0][1]).toBe(summed);
    },
  );
});

describe("DocumentationHarvestMobileCard actions", () => {
  it("opens the row's edit dialog on a tap, Enter or Space", async () => {
    const user = userEvent.setup();
    const record = harvestRow();
    renderCard({ record });

    expect(card()).toHaveAttribute("role", "button");
    await user.click(screen.getByText("Carrots"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(record);

    card().focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onEdit).toHaveBeenCalledTimes(3);
  });

  it("is not a button when the row can't be edited", async () => {
    const user = userEvent.setup();
    renderCard({ editable: false });

    expect(card()).not.toHaveAttribute("role");
    expect(card()).not.toHaveAttribute("tabindex");
    await user.click(screen.getByText("Carrots"));
    expect(onEdit).not.toHaveBeenCalled();
  });
});
