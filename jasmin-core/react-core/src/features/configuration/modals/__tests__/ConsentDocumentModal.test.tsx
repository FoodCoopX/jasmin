/**
 * ``ConsentDocumentModal`` offers every consent kind the backend knows —
 * the subscription contract included — except ``coop_cancellation``, which
 * nothing asks anyone to consent to yet.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

vi.mock("react-quill-new", () => ({
  default: () => <textarea aria-label="body" />,
}));

vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  useCommissioningConsentDocumentsCreate: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  getCommissioningConsentDocumentsListQueryKey: () => ["consent-documents"],
}));

import ConsentDocumentModal from "../ConsentDocumentModal";

describe("ConsentDocumentModal", () => {
  it("offers the subscription contract but not the membership cancellation", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ConsentDocumentModal
          open
          mode="create"
          tenantLanguage="de"
          dateFormat="DD.MM.YYYY"
          onClose={() => {}}
        />
      </QueryClientProvider>,
    );

    await userEvent.click(screen.getByLabelText("consent.admin.col_kind"));

    expect(
      await screen.findByText("consent.kind.subscription_contract"),
    ).toBeInTheDocument();
    expect(screen.getByText("consent.kind.coop_contract")).toBeInTheDocument();
    expect(screen.queryByText("consent.kind.coop_cancellation")).toBeNull();
  });
});
