import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

import { TenantContext } from "@shared/contexts/TenantContext";
import { RequireCapability } from "../RequireCapability";

type TenantState = {
  loading: boolean;
  tenant: { capabilities?: Record<string, boolean> } | null;
};

function renderGuarded(state: TenantState, fallback?: React.ReactNode) {
  const value = state as unknown as Parameters<
    typeof TenantContext.Provider
  >[0]["value"];
  return render(
    <MemoryRouter>
      <TenantContext.Provider value={value}>
        <RequireCapability name="user_accounts" fallback={fallback}>
          <p>users page</p>
        </RequireCapability>
      </TenantContext.Provider>
    </MemoryRouter>,
  );
}

describe("RequireCapability", () => {
  it("renders the page where the deployment offers it", () => {
    renderGuarded({
      loading: false,
      tenant: { capabilities: { user_accounts: true } },
    });

    expect(screen.getByText("users page")).toBeInTheDocument();
  });

  it("says the page isn't available here instead of rendering it", () => {
    renderGuarded({
      loading: false,
      tenant: { capabilities: { user_accounts: false } },
    });

    expect(screen.queryByText("users page")).not.toBeInTheDocument();
    expect(
      screen.getByText("auth.not_authorized.unavailable_here"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "auth.not_authorized.back_home" }),
    ).toBeInTheDocument();
  });

  it("shows a given fallback instead of the unavailable view", () => {
    renderGuarded(
      { loading: false, tenant: { capabilities: { user_accounts: false } } },
      <p>sign in elsewhere</p>,
    );

    expect(screen.getByText("sign in elsewhere")).toBeInTheDocument();
    expect(screen.queryByText("users page")).not.toBeInTheDocument();
  });

  it("renders nothing while the tenant is still loading, so the page can't call its API yet", () => {
    const { container } = renderGuarded({ loading: true, tenant: null });

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the page from a backend that sends no capabilities", () => {
    renderGuarded({ loading: false, tenant: {} });

    expect(screen.getByText("users page")).toBeInTheDocument();
  });
});
