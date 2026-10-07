/**
 * ExportCsvPricesShareArticle: the prices every article has on a date the
 * office picks, as CSV. The share article list exports every article's prices;
 * the extra articles list only the extras'. The date dialog it renders is a
 * stub that loads the rows for one date, and the generated price list hook is
 * the mocking boundary: it records what it was asked for.
 */

import { render } from "@testing-library/react";
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

const api = vi.hoisted(() => ({ priceListParams: [] as unknown[] }));
vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  useCommissioningShareArticleNetPricesList: (params: unknown) => {
    api.priceListParams.push(params);
    return { data: [], isLoading: false };
  },
}));

vi.mock("../useSharePriceCsvColumns", () => ({ useSharePriceCsvColumns: () => [] }));

// The date dialog, with the office having loaded Monday 5 October 2026.
vi.mock("../ExportCsvAtDateModal", () => ({
  default: function DateDialogStub({ useRows }: { useRows: (date: string | null) => unknown }) {
    useRows("2026-10-05");
    return null;
  },
}));

import ExportCsvPricesShareArticle from "../ExportCsvPricesShareArticle";

beforeEach(() => {
  api.priceListParams = [];
});

describe("ExportCsvPricesShareArticle", () => {
  it("asks for every article's prices on the date", () => {
    render(<ExportCsvPricesShareArticle open onClose={() => {}} />);

    expect(api.priceListParams.at(-1)).toEqual({ active_at_date: "2026-10-05" });
  });

  it("asks for the extras' prices only when exporting the extras", () => {
    render(<ExportCsvPricesShareArticle open onClose={() => {}} extrasOnly />);

    expect(api.priceListParams.at(-1)).toEqual({ active_at_date: "2026-10-05", is_extra: true });
  });
});
