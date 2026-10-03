/**
 * ``MemberConsentsCard`` loads only the member's own consent records, and
 * tells a consent replaced by a newer signature apart from a withdrawal:
 * re-signing the SEPA mandate closes the earlier consent with the
 * ``superseded`` reason, and that row must not read as "revoked".
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@hooks/index", () => ({
  useTimeFormat: () => ({
    formatDateTimeWithFallback: (value?: string | null) => value ?? "—",
  }),
}));

const consentsMock = vi.hoisted(() => ({
  records: [] as unknown[],
  params: undefined as unknown,
}));
vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  useCommissioningConsentsList: (params: unknown) => {
    consentsMock.params = params;
    return { data: consentsMock.records, isLoading: false, error: null };
  },
  useCommissioningConsentsRevokeCreate: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  getCommissioningConsentsListQueryKey: () => ["consents"],
  getCommissioningMembersRetrieveQueryKey: () => ["member"],
}));

vi.mock("@shared/consent/downloadConsentPdf", () => ({
  downloadConsentPdf: vi.fn(),
}));

import MemberConsentsCard from "../MemberConsentsCard";

const MEMBER_ID = "member-1";
const SEPA_DOCUMENT = { kind: "sepa", title: "SEPA-Mandat", version: "v1" };

function renderCard(records: unknown[]) {
  consentsMock.records = records;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemberConsentsCard memberId={MEMBER_ID} />
    </QueryClientProvider>,
  );
}

describe("MemberConsentsCard", () => {
  it("asks the server for this member's consents only", () => {
    renderCard([]);

    expect(consentsMock.params).toEqual({ member: MEMBER_ID });
  });

  it("labels a superseded consent as replaced, and a withdrawal as revoked with its reason", () => {
    renderCard([
      {
        id: "consent-old",
        member: MEMBER_ID,
        is_active: false,
        consented_at: "2026-03-01T10:00:00Z",
        revoked_at: "2026-03-02T10:00:00Z",
        revoked_reason: "superseded",
        document: SEPA_DOCUMENT,
      },
      {
        id: "consent-withdrawn",
        member: MEMBER_ID,
        is_active: false,
        consented_at: "2026-03-02T10:00:00Z",
        revoked_at: "2026-03-05T10:00:00Z",
        revoked_reason: "moved away",
        document: SEPA_DOCUMENT,
      },
    ]);

    expect(screen.getByText(/consent\.superseded_at/)).toHaveTextContent(
      "consent.superseded_at: 2026-03-02T10:00:00Z",
    );
    expect(screen.getByText(/consent\.revoked_at/)).toHaveTextContent(
      "consent.revoked_at: 2026-03-05T10:00:00Z — moved away",
    );
    // The token itself is never shown as a reason.
    expect(screen.queryByText(/— superseded/)).toBeNull();
  });
});
