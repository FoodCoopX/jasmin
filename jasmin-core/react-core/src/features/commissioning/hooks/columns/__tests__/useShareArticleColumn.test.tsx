import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("../../useShareArticles", () => ({
  useShareArticles: () => ({ shareArticles: [] }),
}));

import { useShareArticleColumn } from "../useShareArticleColumn";

// A reseller line's form: tiers at 1 and 5 PU, one PU per unit.
const lineForm = (values: Record<string, unknown>) => {
  const fields: Record<string, unknown> = { amount_per_pu: "1", ...values };
  return {
    fields,
    getFieldValue: (name: string) => fields[name],
    setFieldValue: (name: string, value: unknown) => {
      fields[name] = value;
    },
    setFieldsValue: (patch: Record<string, unknown>) => {
      Object.assign(fields, patch);
    },
  };
};

const typeAmount = (typed: string, form: ReturnType<typeof lineForm>) => {
  const { result } = renderHook(() =>
    useShareArticleColumn({ autofillContext: "reseller", finalTiers: [1, 5] }),
  );
  result.current.handleAmountChange(typed, {}, form);
};

describe("useShareArticleColumn amount handler", () => {
  it("prices a line by the tier its amount reaches", () => {
    const form = lineForm({ price_1: "2.00", price_2: "1.80" });

    typeAmount("6", form);

    expect(form.fields.price_per_unit).toBe(1.8);
  });

  it("reads an amount typed with a decimal comma", () => {
    const form = lineForm({ price_1: "2.00", price_2: "1.80" });

    typeAmount("5,5", form);

    expect(form.fields.price_per_unit).toBe(1.8);
  });

  it("keeps the price of a saved line, which has no tier prices", () => {
    const form = lineForm({ price_per_unit: "3.50" });

    typeAmount("12", form);

    expect(form.fields.price_per_unit).toBe("3.50");
  });

  it("keeps a typed price when the article has no tier prices", () => {
    const form = lineForm({
      price_per_unit: "4.20",
      price_1: 0,
      price_2: 0,
      price_3: 0,
    });

    typeAmount("2", form);

    expect(form.fields.price_per_unit).toBe("4.20");
  });
});
