/**
 * LinkButton: an icon-only link to another page that looks like the button
 * library's small square buttons. It is one link, named by its label, that
 * navigates inside the app without reloading.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

import { LinkButton } from "../ButtonLibrary";

function renderAt(element: React.ReactElement) {
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={["/list"]}>
      <Routes>
        <Route path="/list" element={element} />
        <Route path="/members/:id" element={<p>Member page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return { user };
}

describe("LinkButton", () => {
  it("is a single link named by its tooltip, with no button inside", () => {
    renderAt(<LinkButton to="/members/m-1" tooltip="Show member" />);

    const link = screen.getByRole("link", { name: "Show member" });
    expect(link).toHaveAttribute("href", "/members/m-1");
    expect(link).toHaveClass("ant-btn", "small-squared-button");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("takes the variant's label when no tooltip is given or it is empty", () => {
    renderAt(
      <>
        <LinkButton to="/members/m-1" />
        <LinkButton to="/members/m-2" tooltip="" />
      </>,
    );

    expect(screen.getAllByRole("link", { name: "button_library.view" })).toHaveLength(2);
  });

  it("opens the page inside the app", async () => {
    const { user } = renderAt(<LinkButton to="/members/m-1" tooltip="Show member" />);

    await user.click(screen.getByRole("link", { name: "Show member" }));

    expect(screen.getByText("Member page")).toBeInTheDocument();
  });

  it("goes nowhere while disabled", async () => {
    const { user } = renderAt(
      <LinkButton to="/members/m-1" tooltip="Show member" disabled />,
    );

    const link = screen.getByText((_, element) => element?.tagName === "A");
    expect(link).not.toHaveAttribute("href");
    expect(link).toHaveAttribute("aria-disabled", "true");
    await user.click(link);

    expect(screen.queryByText("Member page")).not.toBeInTheDocument();
  });
});
