/**
 * ``ConsentWithdrawalAlert`` shows the office when a member withdrew a
 * consent, and lets it mark the review done; members never see it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Member } from "@shared/api/generated/models";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@hooks/index", () => ({
  useTimeFormat: () => ({
    formatDateTimeWithFallback: (value?: string | null) => value ?? "—",
  }),
}));

const viewer = vi.hoisted(() => ({ isOffice: true }));
vi.mock("@shared/auth", () => ({
  useRoles: () => ({ isOffice: viewer.isOffice }),
}));

const review = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  useCommissioningMembersMarkConsentReviewedCreate: () => ({
    mutate: review.mutate,
    isPending: false,
  }),
  getCommissioningMembersRetrieveQueryKey: (id: string) => ["member", id],
  getCommissioningMembersListQueryKey: () => ["members"],
}));

import ConsentWithdrawalAlert from "../ConsentWithdrawalAlert";

function renderAlert(member: Partial<Member>) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ConsentWithdrawalAlert member={{ id: "m1", ...member } as Member} />
    </QueryClientProvider>,
  );
}

describe("ConsentWithdrawalAlert", () => {
  beforeEach(() => {
    viewer.isOffice = true;
    review.mutate.mockReset();
  });

  it("lets the office mark the review of a withdrawn consent done", () => {
    renderAlert({ consent_withdrawn_at: "2026-09-30T10:00:00Z" });

    expect(screen.getByText("consent.review.title")).toBeInTheDocument();
    fireEvent.click(screen.getByText("consent.review.mark_done"));

    expect(review.mutate).toHaveBeenCalledWith({ id: "m1" });
  });

  it("shows nothing while no consent is withdrawn", () => {
    renderAlert({ consent_withdrawn_at: null });

    expect(screen.queryByText("consent.review.title")).toBeNull();
  });

  it("shows nothing to a member", () => {
    viewer.isOffice = false;
    renderAlert({ consent_withdrawn_at: "2026-09-30T10:00:00Z" });

    expect(screen.queryByText("consent.review.title")).toBeNull();
  });
});
