/**
 * ``InvoiceSendStatus``: when an invoice (and its storno, once cancelled) went
 * to the reseller and to accounting, and the office's send / send-again
 * buttons. Boundary mocked: the generated hooks (``mutate`` replays the
 * server's answer through the ``onSuccess`` the component passed in) and
 * ``notify``.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    formatDateTime: (value: string) => `at ${value}`,
  }),
}));

type MutationOptions = {
  mutation: { onSuccess: (data: { sent: boolean }) => void };
};
const apiMocks = vi.hoisted(() => ({
  sendToReseller: vi.fn(),
  sendToAccounting: vi.fn(),
  answer: { sent: true },
  storno: undefined as object | undefined,
}));
vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  getCommissioningInvoicesRetrieveQueryKey: (id: string) => ["invoice", id],
  getCommissioningOrdersOverviewListQueryKey: () => ["orders-overview"],
  useCommissioningInvoicesRetrieve: (
    _id: string,
    options: { query: { enabled: boolean } },
  ) => ({ data: options.query.enabled ? apiMocks.storno : undefined }),
  useCommissioningInvoicesSendToResellerCreate: (options: MutationOptions) => ({
    isPending: false,
    mutate: (variables: unknown) => {
      apiMocks.sendToReseller(variables);
      options.mutation.onSuccess(apiMocks.answer);
    },
  }),
  useCommissioningInvoicesSendToAccountingCreate: (options: MutationOptions) => ({
    isPending: false,
    mutate: (variables: unknown) => {
      apiMocks.sendToAccounting(variables);
      options.mutation.onSuccess(apiMocks.answer);
    },
  }),
}));

const notifyMocks = vi.hoisted(() => ({
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@shared/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/utils")>()),
  notify: notifyMocks,
}));

import InvoiceSendStatus from "../InvoiceSendStatus";

const INVOICE_ID = "invoice-7";
const FINALIZED_WITH_PDF = {
  id: INVOICE_ID,
  is_finalized: true,
  file: "/media/invoices/rechnung.pdf",
  has_been_sent_to_reseller_at: null,
  has_been_sent_to_accounting_at: null,
  cancelled_by_invoice: null,
};

function renderStatus(invoice: object, canSend = true) {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <InvoiceSendStatus
        invoiceId={INVOICE_ID}
        invoice={invoice}
        canSend={canSend}
      />
    </QueryClientProvider>,
  );
  return { invalidate };
}

// A button's name is its icon's label plus its text, so match on the text at
// the end; anchoring keeps "..._reseller" apart from "..._reseller_again".
const nameEndingWith = (key: string) =>
  new RegExp(`${key.replaceAll(".", "\\.")}$`);
const button = (key: string) =>
  screen.getByRole("button", { name: nameEndingWith(key) });

beforeEach(() => {
  apiMocks.sendToReseller.mockReset();
  apiMocks.sendToAccounting.mockReset();
  apiMocks.answer = { sent: true };
  apiMocks.storno = undefined;
  notifyMocks.success.mockReset();
  notifyMocks.warning.mockReset();
});

describe("InvoiceSendStatus", () => {
  it("sends to the reseller and refreshes the invoice and the invoices list", () => {
    const { invalidate } = renderStatus(FINALIZED_WITH_PDF);

    fireEvent.click(button("commissioning.invoice_send_to_reseller"));

    expect(apiMocks.sendToReseller).toHaveBeenCalledWith({ id: INVOICE_ID });
    expect(apiMocks.sendToAccounting).not.toHaveBeenCalled();
    expect(notifyMocks.success).toHaveBeenCalledWith(
      "commissioning.invoice_sent",
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["invoice", INVOICE_ID],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["orders-overview"] });
  });

  it("sends to accounting from its own button", () => {
    renderStatus(FINALIZED_WITH_PDF);

    fireEvent.click(button("commissioning.invoice_send_to_accounting"));

    expect(apiMocks.sendToAccounting).toHaveBeenCalledWith({ id: INVOICE_ID });
    expect(apiMocks.sendToReseller).not.toHaveBeenCalled();
  });

  it("warns when the email did not go out", () => {
    apiMocks.answer = { sent: false };
    renderStatus(FINALIZED_WITH_PDF);

    fireEvent.click(button("commissioning.invoice_send_to_reseller"));

    expect(notifyMocks.warning).toHaveBeenCalledWith(
      "commissioning.invoice_send_failed",
    );
    expect(notifyMocks.success).not.toHaveBeenCalled();
  });

  it("offers to send again once a document has gone out", () => {
    renderStatus({
      ...FINALIZED_WITH_PDF,
      has_been_sent_to_reseller_at: "2026-06-02T10:00:00Z",
    });

    expect(screen.getByText("at 2026-06-02T10:00:00Z")).toBeInTheDocument();
    expect(
      button("commissioning.invoice_send_to_reseller_again"),
    ).toBeInTheDocument();
    expect(
      button("commissioning.invoice_send_to_accounting"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: nameEndingWith("commissioning.invoice_send_to_reseller"),
      }),
    ).toBeNull();
  });

  it("shows and sends a cancelled invoice's storno, which has no screen of its own", () => {
    apiMocks.storno = {
      id: "storno-1",
      invoice_number: "ST-3",
      is_finalized: true,
      file: "/media/invoices/storno.pdf",
      has_been_sent_to_reseller_at: null,
      has_been_sent_to_accounting_at: "2026-06-03T09:00:00Z",
    };
    renderStatus({ ...FINALIZED_WITH_PDF, cancelled_by_invoice: "storno-1" });

    expect(screen.getByText("ST-3")).toBeInTheDocument();
    expect(
      button("commissioning.storno_send_to_accounting_again"),
    ).toBeInTheDocument();
    fireEvent.click(button("commissioning.storno_send_to_reseller"));

    expect(apiMocks.sendToReseller).toHaveBeenCalledWith({ id: "storno-1" });
    expect(notifyMocks.success).toHaveBeenCalledWith(
      "commissioning.storno_sent",
    );
  });

  it.each([
    ["for a viewer who may not send", FINALIZED_WITH_PDF, false],
    ["before the PDF is uploaded", { ...FINALIZED_WITH_PDF, file: null }, true],
    [
      "before the invoice is finalized",
      { ...FINALIZED_WITH_PDF, is_finalized: false },
      true,
    ],
  ])("offers no send %s", (_case, invoice, canSend) => {
    renderStatus(invoice, canSend);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
