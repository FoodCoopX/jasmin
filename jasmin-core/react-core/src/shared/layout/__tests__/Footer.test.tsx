import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// The dialog itself is not under test here.
vi.mock("@shared/modals", () => ({ AboutModal: () => null }));

import { TenantContext } from "@shared/contexts/TenantContext";
import JasminFooter from "../Footer";

function renderFooter(capabilities: Record<string, boolean> | undefined) {
  // Only ``tenant.capabilities`` matters to the footer.
  const value = { tenant: { capabilities } } as unknown as Parameters<
    typeof TenantContext.Provider
  >[0]["value"];
  return render(
    <TenantContext.Provider value={value}>
      <JasminFooter />
    </TenantContext.Provider>,
  );
}

describe("JasminFooter", () => {
  it("opens the about dialog from its credit line", () => {
    renderFooter({ about: true });

    expect(screen.getByRole("button", { name: "about.open" })).toBeInTheDocument();
  });

  it("is left out where the host doesn't offer it", () => {
    const { container } = renderFooter({ about: false });

    expect(screen.queryByRole("button", { name: "about.open" })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });
});
