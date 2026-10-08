/**
 * The forecast's phone card: the article and its size with the forecast amount
 * beside it, where it grows, the note and whom it is for. The amount is a
 * decimal string on the wire.
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

import { ForecastMobileCard } from "../ForecastMobileCard";

function forecastRow(overrides: Partial<TableRecord> = {}): TableRecord {
  return {
    key: "fc-pumpkins",
    id: "fc-pumpkins",
    share_article_name: "Pumpkins",
    unit: "PCS",
    size: "M",
    amount: "1250.00",
    plot_name: null,
    bed_number: null,
    note: "",
    is_finalized: false,
    ...overrides,
  };
}

beforeEach(() => {
  numberLocale.value = "de-DE";
});

/** The amount and unit shown beside the article name. */
const amountText = () =>
  screen.queryByText(/commissioning\.units\.pcs$/)?.textContent ?? null;

describe("ForecastMobileCard amount", () => {
  it.each([
    ["de-DE", "1.250 commissioning.units.pcs"],
    ["en-US", "1,250 commissioning.units.pcs"],
  ])("shows the amount in the %s number format, as the forecast table does", (locale, shown) => {
    numberLocale.value = locale;
    render(<ForecastMobileCard record={forecastRow()} />);

    expect(amountText()).toBe(shown);
  });

  it("sets the amount in bold on the right of the title", () => {
    render(<ForecastMobileCard record={forecastRow()} />);

    const amount = screen.getByText(/commissioning\.units\.pcs$/);
    expect(amount).toHaveClass("forecast-card-amount");
    expect(amount.closest(".mobile-card-title")).toHaveClass("has-right-slot");
  });

  it.each([null, "0.00"])("shows no amount for %s", (amount) => {
    render(<ForecastMobileCard record={forecastRow({ amount })} />);

    expect(amountText()).toBeNull();
    expect(document.querySelector(".mobile-card-title")).not.toHaveClass(
      "has-right-slot",
    );
  });
});
