import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

vi.mock("@hooks/index", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock();
  return { useTenant: () => tenant };
});

const gdpr = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("@shared/api/generated/gdpr/gdpr", async () => {
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useGdprConfirmDeletionCreate: () =>
      useMutation({
        mutationFn: ({ token }: { token: string }) => gdpr.confirm(token),
      }),
  };
});

import DeletionConfirmPage from "../DeletionConfirmPage";

function renderPage() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
    >
      <MemoryRouter initialEntries={["/gdpr/confirm-deletion/token-1"]}>
        <Routes>
          <Route
            path="/gdpr/confirm-deletion/:token"
            element={<DeletionConfirmPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DeletionConfirmPage", () => {
  beforeEach(() => {
    gdpr.confirm.mockReset();
  });

  it("asks before confirming, so opening the link alone confirms nothing", () => {
    renderPage();

    expect(screen.getByText("gdpr.confirm_page_title")).toBeInTheDocument();
    expect(gdpr.confirm).not.toHaveBeenCalled();
  });

  it("confirms the request and says the office reviews it next", async () => {
    gdpr.confirm.mockResolvedValue({ message: "Confirmation received.", state: "pending_admin" });
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: "gdpr.confirm_page_button" }),
    );

    expect(gdpr.confirm).toHaveBeenCalledWith("token-1");
    expect(
      await screen.findByText("gdpr.confirm_page_confirmed_text"),
    ).toBeInTheDocument();
  });

  it("says why a link no longer works", async () => {
    gdpr.confirm.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: { code: "gdpr.deletion_token_expired", message: "The confirmation link has expired." },
      },
    });
    renderPage();

    await userEvent.click(
      screen.getByRole("button", { name: "gdpr.confirm_page_button" }),
    );

    expect(
      await screen.findByText("gdpr.confirm_page_failed_title"),
    ).toBeInTheDocument();
    // The code's own text, from the real error catalogue (German fallback).
    expect(
      screen.getByText(/Bestätigungslink zur Löschung ist abgelaufen/),
    ).toBeInTheDocument();
  });
});
