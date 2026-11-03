/**
 * Where a host application signs people in (no ``user_accounts``), a signed-out
 * visitor gets the page that hands over to the host instead of jasmin's own
 * sign-in, and jasmin's registration and password pages lead there too.
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

vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => ({ user: null, isAuthenticated: false, bootstrapping: false }),
}));
vi.mock("@shared/contexts/LocaleContext", () => ({
  useLocale: () => ({ language: "de", theme: "light" }),
}));
vi.mock("@hooks/index", () => ({
  useTheme: () => ({}),
  useErrorDateFormat: () => undefined,
}));
vi.mock("@shared/i18n", () => ({ activateLanguage: vi.fn() }));

vi.mock("@features/auth/pages/LoginPage", () => ({
  default: () => <p>login page</p>,
}));
vi.mock("@features/auth/pages/HostSignInPage", () => ({
  default: () => <p>host sign-in page</p>,
}));
vi.mock("@features/auth/pages/registration/RegistrationPage", () => ({
  default: () => <p>registration page</p>,
}));
vi.mock("@features/auth/pages/ForgotPasswordPage", () => ({
  default: () => <p>forgot password page</p>,
}));
vi.mock("@shared/layout/UserMenu", () => ({ default: () => null }));

import { TenantContext } from "@shared/contexts/TenantContext";
import JasminApp from "../JasminApp";

function openSignedOut(path: string, offersUserAccounts: boolean) {
  const value = {
    loading: false,
    tenant: { capabilities: { user_accounts: offersUserAccounts } },
  } as unknown as Parameters<typeof TenantContext.Provider>[0]["value"];
  render(
    <MemoryRouter initialEntries={[path]}>
      <TenantContext.Provider value={value}>
        <JasminApp />
      </TenantContext.Provider>
    </MemoryRouter>,
  );
}

describe("JasminApp sign-in inside a host application", () => {
  it("hands a signed-out visitor over to the host", () => {
    openSignedOut("/login", false);

    expect(screen.getByText("host sign-in page")).toBeInTheDocument();
    expect(screen.queryByText("login page")).not.toBeInTheDocument();
  });

  it("sends jasmin's registration and password pages there as well", () => {
    openSignedOut("/register", false);
    expect(screen.getByText("host sign-in page")).toBeInTheDocument();
  });

  it("sends a password reset link there as well", () => {
    openSignedOut("/forgot-password", false);
    expect(screen.getByText("host sign-in page")).toBeInTheDocument();
  });

  it("keeps jasmin's own sign-in where it has its logins", () => {
    openSignedOut("/login", true);
    expect(screen.getByText("login page")).toBeInTheDocument();
    expect(screen.queryByText("host sign-in page")).not.toBeInTheDocument();
  });

  it("keeps jasmin's own registration where it has its logins", () => {
    openSignedOut("/register", true);
    expect(screen.getByText("registration page")).toBeInTheDocument();
  });
});
