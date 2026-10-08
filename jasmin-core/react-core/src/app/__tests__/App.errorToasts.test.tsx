/**
 * The app-wide toasts for a failed query or mutation that does not report its
 * own error. The tenant app is replaced by a probe that runs one failing query
 * and one failing mutation through the app's real QueryClient.
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

vi.mock("@shared/i18n", () => ({
  default: { t: (key: string) => key },
}));

const { notifyMock } = vi.hoisted(() => ({
  notifyMock: { error: vi.fn() },
}));
vi.mock("@shared/utils", () => ({ notify: notifyMock }));

const { passThrough } = vi.hoisted(() => ({
  passThrough: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock("@shared/contexts/AuthContext", () => ({ AuthProvider: passThrough }));
vi.mock("@shared/contexts/LocaleContext", () => ({
  LocaleProvider: passThrough,
}));
vi.mock("@shared/contexts/TenantContext", () => ({
  TenantProvider: passThrough,
  isPlatformDomain: () => false,
}));
vi.mock("@shared/auth/StepUpProvider", () => ({
  StepUpProvider: passThrough,
}));
vi.mock("@shared/ui/ErrorBoundary", () => ({ default: passThrough }));
vi.mock("@shared/ui", () => ({
  LiveAnnouncer: () => null,
  NewVersionBanner: () => null,
  OfflineBanner: () => null,
}));
vi.mock("@tanstack/react-query-devtools", () => ({
  ReactQueryDevtools: () => null,
}));

// Neither request answers with a server message, so the toast falls back to
// the app's own wording.
function FailingRequests() {
  const failedQuery = useQuery({
    queryKey: ["failing-probe"],
    queryFn: () => Promise.reject({}),
    retry: false,
  });
  const { mutate } = useMutation({ mutationFn: () => Promise.reject({}) });
  return (
    <>
      {failedQuery.isError && <p>query failed</p>}
      <button type="button" onClick={() => mutate()}>
        run mutation
      </button>
    </>
  );
}
vi.mock("../JasminApp", () => ({ default: () => <FailingRequests /> }));
vi.mock("../SuperAdminApp", () => ({ default: () => null }));

import App from "../App";

beforeEach(() => {
  notifyMock.error.mockReset();
});

describe("App error toasts", () => {
  it("reports a failed load and a failed action in the user's language", async () => {
    render(<App />);

    await screen.findByText("query failed");
    expect(notifyMock.error).toHaveBeenCalledWith("common.error_loading_data");

    await userEvent.click(
      await screen.findByRole("button", { name: "run mutation" }),
    );
    await waitFor(() =>
      expect(notifyMock.error).toHaveBeenLastCalledWith("common.action_failed"),
    );
  });
});
