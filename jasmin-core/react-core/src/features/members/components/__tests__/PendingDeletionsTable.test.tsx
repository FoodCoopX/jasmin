import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AdminPendingDeletion } from "@shared/api/generated/models";

const rows = vi.hoisted(() => ({ pending: [] as AdminPendingDeletion[] }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object" && "channel" in options
        ? `${key}:${String((options as { channel: string }).channel)}`
        : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@hooks/index", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock();
  return {
    useTenant: () => tenant,
    useTimeFormat: () => ({ formatDateTime: (value: string) => value }),
  };
});

vi.mock("@shared/api/generated/gdpr/gdpr", () => ({
  useGdprAdminPendingDeletionsRetrieve: () => ({
    data: { pending: rows.pending },
    isFetching: false,
  }),
  useGdprAdminApproveDeletionCreate: () => ({
    mutate: vi.fn(),
    variables: undefined,
  }),
  getGdprAdminPendingDeletionsRetrieveQueryKey: () => ["pending"],
  getGdprAdminDecidedDeletionsListQueryKey: () => ["decided"],
}));

import PendingDeletionsTable from "../PendingDeletionsTable";

function row(overrides: Partial<AdminPendingDeletion>): AdminPendingDeletion {
  return {
    id: "r1",
    requested_email: "self@example.com",
    subject_label: "self@example.com",
    member_id: null,
    reseller_id: null,
    channel: "self_service",
    requested_at: "2026-10-01T10:00:00Z",
    email_confirmed_at: "2026-10-01T10:05:00Z",
    current_user_email: "self@example.com",
    blockers: [],
    ...overrides,
  };
}

describe("PendingDeletionsTable", () => {
  it("names the member an office-filed request is for and how they asked", () => {
    rows.pending = [
      row({}),
      row({
        id: "r2",
        requested_email: "",
        subject_label: "Paula Paper (#1042)",
        member_id: "MeMbEr000001",
        channel: "letter",
        email_confirmed_at: null,
        current_user_email: null,
        blockers: ["1 open CoopShare(s)"],
      }),
    ];

    render(
      <QueryClientProvider client={new QueryClient()}>
        <PendingDeletionsTable onRejectRequested={vi.fn()} />
      </QueryClientProvider>,
    );

    expect(screen.getAllByText("self@example.com")).toHaveLength(1);
    expect(screen.getByText("Paula Paper (#1042)")).toBeInTheDocument();
    // Only the office-filed row says it was filed, and how.
    expect(
      screen.getAllByText("gdpr.filed_by_office:gdpr.channel.letter"),
    ).toHaveLength(1);
    expect(screen.getByText("1 open CoopShare(s)")).toBeInTheDocument();
  });
});
