/**
 * The "Meine Daten" consents list: a consent replaced by a newer signature is
 * labelled as such rather than as a withdrawal, and "view text" opens the
 * document in the language the member consented in, which can differ from
 * the page's.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@shared/contexts/LocaleContext", () => ({
  useLocale: () => ({ language: "en" }),
}));

vi.mock("@hooks/index", () => ({
  useDateFormat: () => ({
    formatDateWithFallback: (value?: string | null) => value ?? "—",
  }),
}));

const myDataMock = vi.hoisted(() => ({ consents: [] as unknown[] }));
vi.mock("@shared/api/generated/gdpr/gdpr", () => ({
  useGdprMyDataRetrieve: () => ({ data: { consents: myDataMock.consents } }),
  getGdprMyDataRetrieveQueryKey: () => ["my-data"],
}));

const currentDocumentMock = vi.hoisted(() => vi.fn());
vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  useCommissioningConsentDocumentsCurrentRetrieve: (...args: unknown[]) =>
    currentDocumentMock(...args),
  useCommissioningConsentsRevokeCreate: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

import ConsentsSection from "../ConsentsSection";

function renderSection(consents: unknown[]) {
  myDataMock.consents = consents;
  currentDocumentMock.mockReset().mockReturnValue({
    data: { title: "SEPA-Lastschriftmandat", body: "Mandatstext", version: "v1" },
    isLoading: false,
    error: null,
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConsentsSection />
    </QueryClientProvider>,
  );
}

const SUPERSEDED = {
  id: "consent-old",
  kind: "sepa",
  document_version: "v1",
  document_locale: "de",
  consented_at: "2026-03-01T10:00:00Z",
  ip_address: null,
  user_agent: "",
  revoked_at: "2026-03-02T10:00:00Z",
  revoked_reason: "superseded",
};

describe("ConsentsSection", () => {
  it("labels a superseded consent as replaced and a withdrawal as revoked", () => {
    renderSection([
      SUPERSEDED,
      {
        ...SUPERSEDED,
        id: "consent-withdrawn",
        revoked_at: "2026-03-05T10:00:00Z",
        revoked_reason: "moved away",
      },
    ]);

    expect(screen.getByText(/gdpr\.consent_superseded_at/)).toHaveTextContent(
      "gdpr.consent_superseded_at: 2026-03-02T10:00:00Z",
    );
    expect(screen.getByText(/gdpr\.consent_revoked_at/)).toHaveTextContent(
      "gdpr.consent_revoked_at: 2026-03-05T10:00:00Z",
    );
  });

  it("opens the text in the language the member consented in", () => {
    renderSection([{ ...SUPERSEDED, revoked_at: null, revoked_reason: "" }]);

    fireEvent.click(screen.getByText("gdpr.view_consent_text"));

    // The page is in English; the member consented to the German text.
    expect(currentDocumentMock).toHaveBeenCalledWith(
      { kind: "sepa", locale: "de" },
      expect.anything(),
    );
  });
});
