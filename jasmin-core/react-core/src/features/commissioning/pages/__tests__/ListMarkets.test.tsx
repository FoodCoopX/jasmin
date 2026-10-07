/**
 * ListMarkets: a placeholder page for the farm's markets — a "coming soon"
 * line and the page's explainer. The explainer panel stands in as a stub
 * showing its title and text.
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

import ListMarkets from "../ListMarkets";

describe("ListMarkets", () => {
  it("announces the page as coming soon", () => {
    render(<ListMarkets />);

    expect(screen.getByText("coming soon...")).toBeInTheDocument();
  });

  it("explains the page under the info title", () => {
    render(<ListMarkets />);

    const explainer = screen.getByTestId("explainer");
    expect(explainer).toHaveAttribute("aria-label", "common.info");
    expect(explainer).toHaveTextContent("explainers.list_markets");
  });
});
