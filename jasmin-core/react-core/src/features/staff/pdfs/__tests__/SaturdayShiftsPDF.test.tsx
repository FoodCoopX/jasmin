/**
 * SaturdayShiftsPDF: every employee, and beside them the dates of their
 * Saturday shifts.
 */
import { render, screen } from "@testing-library/react";
import type { TFunction } from "i18next";
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

vi.mock("@react-pdf/renderer", async (importOriginal) => {
  const { pdfDomPrimitives } = await import(
    "@features/commissioning/pdfs/__tests__/pdfDomPrimitives"
  );
  return {
    ...(await importOriginal<typeof import("@react-pdf/renderer")>()),
    ...pdfDomPrimitives(),
  };
});

import SaturdayShiftsPDF from "../SaturdayShiftsPDF";

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key) as unknown as TFunction;

const ROWS = [
  {
    id: "emp-anna",
    name: "Anna",
    saturdays: [
      { date: "17.01.", absent: false },
      { date: "11.04.", absent: true },
    ],
  },
  { id: "emp-ben", name: "Ben", saturdays: [] },
];

const rowOf = (name: string) =>
  screen.getByText(name).closest("[data-wrap='false']")?.textContent;

describe("SaturdayShiftsPDF", () => {
  it("prints the year and each employee with their Saturdays", () => {
    render(<SaturdayShiftsPDF year={2026} rows={ROWS} t={t} />);

    expect(
      screen.getByText('staff.saturday_shifts_pdf_title {"year":2026}'),
    ).toBeInTheDocument();
    expect(rowOf("Anna")).toBe("Anna17.01., 11.04. (staff.absent_mark)");
  });

  it("prints a dash for an employee without a Saturday shift", () => {
    render(<SaturdayShiftsPDF year={2026} rows={ROWS} t={t} />);

    expect(rowOf("Ben")).toBe("Ben–");
  });
});
