/**
 * OverviewResellers: a placeholder page for the reseller overview — a heading,
 * a "coming soon" line and the page's explainer. The explainer panel stands in
 * as a stub showing its title and text.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@shared/ui", () => ({
  ExplainerText: ({ title, children }: { title?: string; children: React.ReactNode }) => (
    <section data-testid="explainer" aria-label={title}>
      {children}
    </section>
  ),
}));

import OverviewResellers from "../OverviewResellers";

describe("OverviewResellers", () => {
  it("shows the page heading and that its content is coming soon", () => {
    render(<OverviewResellers />);

    expect(screen.getByRole("heading", { level: 1, name: "OverviewResellers" })).toBeInTheDocument();
    expect(screen.getByText("OverviewResellers page content coming soon...")).toBeInTheDocument();
  });

  it("explains the page under the info title", () => {
    render(<OverviewResellers />);

    const explainer = screen.getByTestId("explainer");
    expect(explainer).toHaveAttribute("aria-label", "common.info");
    expect(explainer).toHaveTextContent("explainers.overview_resellers");
  });
});
