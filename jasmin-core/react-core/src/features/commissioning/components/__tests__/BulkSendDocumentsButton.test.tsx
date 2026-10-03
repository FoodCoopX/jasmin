/**
 * ``BulkSendDocumentsButton`` sends only the selected orders whose invoice or
 * delivery note is finalized, under the page's document model, and follows
 * the enqueued job in the progress drawer.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CombinedOrderOverview } from "@shared/api/generated/models";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  commissioningBulkSendDocumentsViaEmailCreate: sendMock,
}));

vi.mock("@shared/ui/JobProgressDrawer", () => ({
  JobProgressDrawer: ({
    jobId,
    onClose,
  }: {
    jobId: string | null;
    onClose: () => void;
  }) =>
    jobId ? (
      <div data-testid="job-drawer">
        {jobId}
        <button onClick={onClose}>close-drawer</button>
      </div>
    ) : null,
}));

import BulkSendDocumentsButton from "../BulkSendDocumentsButton";

const row = (
  id: string,
  finalized: { invoice?: boolean; deliveryNote?: boolean } = {},
) =>
  ({
    id,
    has_finalized_invoice: finalized.invoice ?? false,
    delivery_note_is_finalized: finalized.deliveryNote ?? false,
  }) as CombinedOrderOverview;

beforeEach(() => {
  sendMock
    .mockReset()
    .mockResolvedValue({ job_id: "job-1", kind: "invoice.bulk_send" });
});

describe("BulkSendDocumentsButton", () => {
  it("sends only the selected orders with a finalized invoice", async () => {
    render(
      <BulkSendDocumentsButton
        model="invoice"
        rows={[
          row("ord-1", { invoice: true }),
          row("ord-2", { deliveryNote: true }),
          row("ord-3", { invoice: true }),
        ]}
        selectedIds={["ord-1", "ord-2"]}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "resellers.send_via_email_resellers" }),
    );

    expect(sendMock).toHaveBeenCalledWith({ ids: ["ord-1"], model: "invoice" });
  });

  it("sends delivery notes by their own finalized flag", async () => {
    render(
      <BulkSendDocumentsButton
        model="delivery_note"
        rows={[row("ord-1", { deliveryNote: true }), row("ord-2", { invoice: true })]}
        selectedIds={["ord-1", "ord-2"]}
        onClose={vi.fn()}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "commissioning.send_delivery_notes_bulk_via_email",
      }),
    );

    expect(sendMock).toHaveBeenCalledWith({
      ids: ["ord-1"],
      model: "delivery_note",
    });
  });

  it("stays disabled while no selected order has a finalized document", () => {
    render(
      <BulkSendDocumentsButton
        model="invoice"
        rows={[row("ord-1"), row("ord-2", { invoice: true })]}
        selectedIds={["ord-1"]}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "resellers.send_via_email_resellers" }),
    ).toBeDisabled();
  });

  it("follows the enqueued job in the drawer and reports its close", async () => {
    const onClose = vi.fn();
    render(
      <BulkSendDocumentsButton
        model="invoice"
        rows={[row("ord-1", { invoice: true })]}
        selectedIds={["ord-1"]}
        onClose={onClose}
      />,
    );

    await userEvent.click(
      screen.getByRole("button", { name: "resellers.send_via_email_resellers" }),
    );
    expect(await screen.findByTestId("job-drawer")).toHaveTextContent("job-1");

    await userEvent.click(screen.getByRole("button", { name: "close-drawer" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("job-drawer")).not.toBeInTheDocument();
  });
});
