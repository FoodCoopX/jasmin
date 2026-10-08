/**
 * EmailLog: the tenant's log of every outbound email, filterable by
 * recipient, purpose and status. The purpose filter offers the purposes the
 * log holds — template slugs for most sends, purposes of their own for the
 * reseller invoices and delivery notes, the accounting copies and test sends —
 * so each of them can be found. The generated notifications client is the
 * mocking boundary, each hook a real TanStack query around a spy.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EmailLog as EmailLogRow } from "@shared/api/generated/models";

// ``t`` shows the interpolated template of a test send, so its label can be
// told apart from the template's own.
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: unknown) =>
      options && typeof options === "object" && "template" in options
        ? `${key}(${String((options as { template: unknown }).template)})`
        : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock: make } = await import("@/test/tenantMock");
  const tenant = make();
  return { useTenant: () => tenant };
});

const api = vi.hoisted(() => ({
  logs: vi.fn(),
  purposes: vi.fn(),
}));

vi.mock("@shared/api/generated/notifications/notifications", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    useNotificationsEmailLogsList: (params: unknown) =>
      useQuery({
        queryKey: ["email_logs", params],
        queryFn: () => api.logs(params),
      }),
    useNotificationsEmailLogsPurposes: () =>
      useQuery({
        queryKey: ["email_logs_purposes"],
        queryFn: () => api.purposes(),
      }),
  };
});

import EmailLog from "../EmailLog";

function logRow(id: number, purpose: string, recipient: string): EmailLogRow {
  return {
    id,
    recipient,
    subject: `Subject ${id}`,
    template: "commissioning.invoice",
    purpose,
    status: "sent",
    error: "",
    related_object_type: "",
    related_object_id: "",
    created_at: "2026-10-05T10:00:00+02:00",
    sent_at: "2026-10-05T10:00:01+02:00",
    delivered_at: null,
  };
}

const LOG = [
  logRow(1, "invoice:reseller", "reseller@example.org"),
  logRow(2, "commissioning.offer", "offer@example.org"),
  logRow(3, "test:commissioning.offer", "office@example.org"),
];

const PURPOSES = [
  "commissioning.offer",
  "delivery_note:reseller",
  "invoice:accounting",
  "invoice:reseller",
  "test:commissioning.offer",
  "test:smtp",
];

const LABELS = {
  offer: "email_matrix.commissioning.offer",
  deliveryNote: "email_matrix.purposes.delivery_note_reseller",
  accounting: "email_matrix.purposes.invoice_accounting",
  invoice: "email_matrix.purposes.invoice_reseller",
  testOffer: "email_matrix.purposes.test_send(email_matrix.commissioning.offer)",
  testSmtp: "email_matrix.purposes.test_smtp",
};

beforeEach(() => {
  api.logs.mockReset().mockImplementation(async (params: { purpose?: string }) =>
    LOG.filter((row) => !params.purpose || row.purpose === params.purpose),
  );
  api.purposes.mockReset().mockResolvedValue({ purposes: PURPOSES });
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <EmailLog />
    </QueryClientProvider>,
  );
}

function purposeCells(): string[] {
  const table = document.querySelector(".ant-table") as HTMLElement;
  const rows = within(table).getAllByRole("row").slice(1);
  return rows.map((row) => within(row).getAllByRole("cell")[3]?.textContent ?? "");
}

async function openPurposeFilter() {
  await userEvent.click(screen.getByRole("combobox", { name: "email_matrix.purpose" }));
}

function offeredPurposes(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option",
    ),
  ).map((option) => option.textContent ?? "");
}

describe("EmailLog purpose filter", () => {
  it("offers every purpose the log holds, invoices, delivery notes and test sends among them", async () => {
    renderPage();
    await waitFor(() => expect(api.purposes).toHaveBeenCalled());

    await openPurposeFilter();

    await waitFor(() => expect(offeredPurposes()).toHaveLength(PURPOSES.length));
    expect([...offeredPurposes()].sort()).toEqual(Object.values(LABELS).sort());
  });

  it("finds the reseller invoices once the user picks them", async () => {
    renderPage();
    await waitFor(() => expect(purposeCells()).toHaveLength(3));

    await openPurposeFilter();
    await waitFor(() => expect(offeredPurposes()).toContain(LABELS.invoice));
    const option = Array.from(
      document.querySelectorAll<HTMLElement>(".ant-select-item-option"),
    ).find((candidate) => candidate.textContent === LABELS.invoice)!;
    await userEvent.click(option);

    await waitFor(() => expect(purposeCells()).toEqual([LABELS.invoice]));
    expect(api.logs).toHaveBeenLastCalledWith({ purpose: "invoice:reseller" });
  });

  it("names each logged purpose in the table, test sends after their template", async () => {
    renderPage();

    await waitFor(() => expect(purposeCells()).toHaveLength(3));
    expect([...purposeCells()].sort()).toEqual(
      [LABELS.invoice, LABELS.offer, LABELS.testOffer].sort(),
    );
  });

  it("offers no purposes while the log holds none", async () => {
    api.purposes.mockResolvedValue({ purposes: [] });
    renderPage();
    await waitFor(() => expect(api.purposes).toHaveBeenCalled());

    await openPurposeFilter();

    expect(offeredPurposes()).toEqual([]);
  });
});
