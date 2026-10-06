/**
 * Pages a link in an email opens must open whatever the visitor's session —
 * the signed-in layouts would otherwise redirect to the user's start page and
 * the token in the link would be lost.
 */
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

const session = vi.hoisted(() => ({
  auth: {
    user: null as null | { roles: string[]; member_id?: string },
    isAuthenticated: false,
    bootstrapping: false,
  },
}));
vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => session.auth,
}));
vi.mock("@shared/contexts/LocaleContext", () => ({
  useLocale: () => ({ language: "de", theme: "light" }),
}));
vi.mock("@hooks/index", () => ({
  useTheme: () => ({}),
  useErrorDateFormat: () => undefined,
}));
vi.mock("@shared/i18n", () => ({ activateLanguage: vi.fn() }));

vi.mock("@features/public/pages/DeletionConfirmPage", () => ({
  default: () => <p>deletion confirmation page</p>,
}));
vi.mock("@features/public/pages/WaitingListOfferPage", () => ({
  default: () => <p>waiting-list offer page</p>,
}));
vi.mock("@features/members/pages/MemberDetail", () => ({
  default: () => <p>member page</p>,
}));
vi.mock("@features/auth/pages/LoginPage", () => ({
  default: () => <p>login page</p>,
}));
vi.mock("@shared/layout/UserMenu", () => ({ default: () => null }));

import JasminApp from "../JasminApp";

function openLink(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <JasminApp />
    </MemoryRouter>,
  );
}

describe("JasminApp email links", () => {
  it("opens the deletion confirmation for a signed-out visitor", () => {
    session.auth = { user: null, isAuthenticated: false, bootstrapping: false };

    openLink("/gdpr/confirm-deletion/token-1");

    expect(screen.getByText("deletion confirmation page")).toBeInTheDocument();
  });

  it("opens the deletion confirmation for a signed-in member", () => {
    session.auth = {
      user: { roles: ["member"], member_id: "m-1" },
      isAuthenticated: true,
      bootstrapping: false,
    };

    openLink("/gdpr/confirm-deletion/token-1");

    expect(screen.getByText("deletion confirmation page")).toBeInTheDocument();
    expect(screen.queryByText("member page")).not.toBeInTheDocument();
  });

  it("opens a waiting-list offer for a signed-in member", () => {
    session.auth = {
      user: { roles: ["member"], member_id: "m-1" },
      isAuthenticated: true,
      bootstrapping: false,
    };

    openLink("/waiting-list-offer/token-2");

    expect(screen.getByText("waiting-list offer page")).toBeInTheDocument();
  });
});
