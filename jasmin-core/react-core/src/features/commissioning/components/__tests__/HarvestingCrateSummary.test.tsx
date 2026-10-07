/**
 * HarvestingCrateSummary: the harvesting crates a week needs, under the
 * harvesting list — a small table on desktop, a card on the phone that only
 * shows once the list has rows.
 */

import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CrateSummaryEntry } from "@features/commissioning/hooks/useHarvestingListData";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import HarvestingCrateSummary from "../HarvestingCrateSummary";

const CRATES: CrateSummaryEntry[] = [
  { key: "Euro crate", crate_name: "Euro crate", quantity: 14 },
  { key: "Small crate", crate_name: "Small crate", quantity: 3 },
];

describe("HarvestingCrateSummary on desktop", () => {
  it("lists each crate with the number needed under a header carrying the tooltip", () => {
    render(
      <HarvestingCrateSummary crateSummary={CRATES} isMobile={false} showMobileCard={false} />,
    );

    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers[0]).toHaveTextContent("commissioning.needed_harvesting_crates");
    expect(
      within(headers[0]).getByLabelText("tooltip.needed_harvesting_crates"),
    ).toBeInTheDocument();
    expect(headers[1]).toHaveTextContent("commissioning.quantity");

    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) =>
        within(row).getAllByRole("cell").map((cell) => cell.textContent),
      );
    expect(rows).toEqual([
      ["Euro crate", "14"],
      ["Small crate", "3"],
    ]);
  });

  it("shows the empty hint when no crate is needed", () => {
    render(<HarvestingCrateSummary crateSummary={[]} isMobile={false} showMobileCard />);

    expect(screen.getByRole("table")).toHaveTextContent("table.no_data");
  });
});

describe("HarvestingCrateSummary on the phone", () => {
  it("renders nothing until the list is ready to show the card", () => {
    const { container } = render(
      <HarvestingCrateSummary crateSummary={CRATES} isMobile showMobileCard={false} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("shows a card listing each crate and its number, without a table", () => {
    render(<HarvestingCrateSummary crateSummary={CRATES} isMobile showMobileCard />);

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByText("commissioning.needed_harvesting_crates")).toBeInTheDocument();
    expect(screen.getByText("Euro crate").parentElement).toHaveTextContent("Euro crate14");
    expect(screen.getByText("Small crate").parentElement).toHaveTextContent("Small crate3");
  });

  it("says there is no data when no crate is needed", () => {
    render(<HarvestingCrateSummary crateSummary={[]} isMobile showMobileCard />);

    expect(screen.getByText("table.no_data")).toBeInTheDocument();
  });
});
