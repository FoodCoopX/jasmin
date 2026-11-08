import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

const tenantState = vi.hoisted(() => ({
  settings: {} as Record<string, unknown> | undefined,
}));
vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  return {
    useTenant: () =>
      makeUseTenantMock({
        tenant: { settings: tenantState.settings },
        getSetting: (key: string, defaultValue?: unknown) =>
          tenantState.settings && key in tenantState.settings
            ? tenantState.settings[key]
            : defaultValue,
      }),
  };
});

import { RequireMembersAndSubscriptions } from "../RequireMembersAndSubscriptions";

function renderGuarded() {
  return render(
    <MemoryRouter>
      <RequireMembersAndSubscriptions>
        <p>members page</p>
      </RequireMembersAndSubscriptions>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  tenantState.settings = {};
});

describe("RequireMembersAndSubscriptions", () => {
  it("renders the page while subscriptions drive the share demand", () => {
    renderGuarded();

    expect(screen.getByText("members page")).toBeInTheDocument();
  });

  it("says why the page isn't available while the share amounts are imported", () => {
    tenantState.settings = { uploads_weekly_share_amount: true };

    renderGuarded();

    expect(screen.queryByText("members page")).not.toBeInTheDocument();
    expect(
      screen.getByText("auth.not_authorized.unavailable_with_imported_shares"),
    ).toBeInTheDocument();
  });

  it("renders nothing until the settings have arrived, so the page can't call its API yet", () => {
    tenantState.settings = undefined;

    const { container } = renderGuarded();

    expect(container).toBeEmptyDOMElement();
  });
});
