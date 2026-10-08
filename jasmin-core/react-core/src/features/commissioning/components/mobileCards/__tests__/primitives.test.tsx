/**
 * The shared building blocks of the commissioning phone cards. Their layout
 * lives in primitives.css; what a caller chooses per card — whether it can be
 * tapped, a title's right-hand content, a metric's emphasis, colour and
 * minimum width — reaches it as a modifier class or a custom property.
 */
import { render, screen } from "@testing-library/react";
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

import {
  MobileCard,
  MobileCardMetric,
  MobileCardMetricsRow,
  MobileCardTags,
} from "../primitives";

describe("MobileCard", () => {
  it("is a commissioning card, marked clickable only with a tap handler", () => {
    const { unmount } = render(
      <MobileCard onClick={() => {}}>Leeks</MobileCard>,
    );
    expect(screen.getByText("Leeks")).toHaveClass(
      "mobile-card-item",
      "commissioning-mobile-card",
      "is-clickable",
    );
    unmount();

    render(<MobileCard>Leeks</MobileCard>);
    expect(screen.getByText("Leeks")).toHaveClass("commissioning-mobile-card");
    expect(screen.getByText("Leeks")).not.toHaveClass("is-clickable");
  });
});

describe("MobileCardMetric", () => {
  it("shows a primary value in its default colour and no minimum width", () => {
    render(<MobileCardMetric label="Total" value="12,50" unit="kg" />);

    const value = screen.getByText("12,50");
    expect(value).toHaveClass("mobile-card-metric-value");
    expect(value).not.toHaveClass("is-secondary", "has-color");
    expect(value.style.getPropertyValue("--mobile-card-metric-color")).toBe("");
    expect(value.closest(".mobile-card-metric")).not.toHaveClass(
      "has-min-width",
    );
  });

  it("passes a secondary emphasis, a colour token and a minimum width on", () => {
    render(
      <MobileCardMetric
        value="3"
        emphasis="secondary"
        color="var(--color-success-text)"
        minWidth={64}
      />,
    );

    const value = screen.getByText("3");
    expect(value).toHaveClass("is-secondary", "has-color");
    expect(value.style.getPropertyValue("--mobile-card-metric-color")).toBe(
      "var(--color-success-text)",
    );
    const metric = value.closest<HTMLElement>(".mobile-card-metric")!;
    expect(metric).toHaveClass("has-min-width");
    expect(
      metric.style.getPropertyValue("--mobile-card-metric-min-width"),
    ).toBe("64px");
  });
});

describe("MobileCardMetricsRow and MobileCardTags", () => {
  it("lay the metrics and the tags out by class", () => {
    render(
      <>
        <MobileCardMetricsRow>
          <span>metric</span>
        </MobileCardMetricsRow>
        <MobileCardTags tags={["For shares"]} />
      </>,
    );

    expect(screen.getByText("metric").parentElement).toHaveClass(
      "mobile-card-metrics-row",
    );
    expect(screen.getByText("For shares").parentElement).toHaveClass(
      "mobile-card-tags",
    );
  });

  it("renders no tag row without tags", () => {
    render(<MobileCardTags tags={[]} />);

    expect(document.querySelector(".mobile-card-tags")).toBeNull();
  });
});
