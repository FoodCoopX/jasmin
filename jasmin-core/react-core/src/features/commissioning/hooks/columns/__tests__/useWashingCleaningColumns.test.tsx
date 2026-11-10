/**
 * useWashingCleaningColumns: the wash, clean and long-term-storage checkboxes
 * of an order, offer or planning line, the first two only where the farm shows
 * washing and cleaning.
 */
import { renderHook } from "@testing-library/react";
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

// Whether the farm shows washing and cleaning, per test.
const shownWorkDays = vi.hoisted(() => ({ showsWashing: true, showsCleaning: true }));
vi.mock("@hooks/index", () => ({
  useWashingCleaningVisibility: () => shownWorkDays,
}));

import { useWashingCleaningColumns } from "../useWashingCleaningColumns";

const columnKeys = () =>
  renderHook(() => useWashingCleaningColumns()).result.current.washingCleaningColumns.map(
    (column) => column.key,
  );

beforeEach(() => {
  shownWorkDays.showsWashing = true;
  shownWorkDays.showsCleaning = true;
});

describe("useWashingCleaningColumns", () => {
  it("offers washing, cleaning and the long-term storage", () => {
    expect(columnKeys()).toEqual(["washing", "cleaning", "comes_from_long_term_storage"]);
  });

  it("leaves out washing on a farm that hides it", () => {
    shownWorkDays.showsWashing = false;

    expect(columnKeys()).toEqual(["cleaning", "comes_from_long_term_storage"]);
  });

  it("keeps only the long-term storage on a farm that hides washing and cleaning", () => {
    shownWorkDays.showsWashing = false;
    shownWorkDays.showsCleaning = false;

    expect(columnKeys()).toEqual(["comes_from_long_term_storage"]);
  });
});
