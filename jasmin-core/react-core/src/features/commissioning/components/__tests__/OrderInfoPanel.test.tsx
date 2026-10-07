/**
 * OrderInfoPanel: the head of a reseller's order for one day — its number,
 * gross total and note, then the delivery note and the invoice built from it,
 * each with the step the office takes next: create, finalize or delete, view
 * the details, and download the PDF once finalized. Rendered with the real
 * BulkActionButton; the generated bulk-document client is the mocking
 * boundary and answers as the backend's bulk views do. The PDF buttons are
 * another screen's concern and stand in as stubs showing the document id.
 */

import { act, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BulkDocumentResultRow, BulkOperationResponse } from "@shared/api/generated/models";
import type { OrderState } from "@features/commissioning/hooks/useOrdersData";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const { notify, api } = vi.hoisted(() => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  api: { create: vi.fn(), finalize: vi.fn(), destroy: vi.fn() },
}));

vi.mock("@shared/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/utils")>()),
  notify,
}));

vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  commissioningBulkCreateDocumentsFromOrdersCreate: (payload: unknown) => api.create(payload),
  commissioningBulkFinalizeDocumentsCreate: (payload: unknown) => api.finalize(payload),
  commissioningBulkDeleteDocumentsCreate: (payload: unknown) => api.destroy(payload),
}));

vi.mock("@features/commissioning/pdfs", () => ({
  DeliveryNotePDFButtons: ({ deliveryNoteId }: { deliveryNoteId: string | null }) => (
    <button type="button">{`Delivery note PDF ${deliveryNoteId}`}</button>
  ),
  InvoicePDFButtons: ({ invoiceId }: { invoiceId: string | null }) => (
    <button type="button">{`Invoice PDF ${invoiceId}`}</button>
  ),
}));

import { OrderInfoPanel } from "../OrderInfoPanel";

// ── Fixtures ────────────────────────────────────────────────────────────────

const EMPTY: OrderState = {
  orderId: null,
  orderNumber: null,
  usedOrderNumberPrefix: null,
  isOrderFinalized: false,
  deliveryNoteId: null,
  deliveryNoteNumber: null,
  deliveryNotePrefix: null,
  isDeliveryNoteFinalized: false,
  invoiceId: null,
  invoiceNumber: null,
  invoicePrefix: null,
  hasInvoice: false,
  hasFinalizedInvoice: false,
};

// An order saved, but nothing issued from it yet.
const ORDERED: OrderState = { ...EMPTY, orderId: "order-77", orderNumber: 77, usedOrderNumberPrefix: "B" };

// A draft delivery note.
const NOTED: OrderState = {
  ...ORDERED, deliveryNoteId: "dn-31", deliveryNoteNumber: 31, deliveryNotePrefix: "LS",
};

const NOTE_FINALIZED: OrderState = { ...NOTED, isOrderFinalized: true, isDeliveryNoteFinalized: true };

// A draft invoice on the finalized delivery note.
const INVOICED: OrderState = {
  ...NOTE_FINALIZED, invoiceId: "inv-12", invoiceNumber: 12, invoicePrefix: "RE", hasInvoice: true,
};

const INVOICE_FINALIZED: OrderState = { ...INVOICED, hasFinalizedInvoice: true };

const success = (model: string, row: Partial<BulkDocumentResultRow>): BulkOperationResponse => ({
  model, total_processed: 1, successful: 1, failed: 0,
  results: [{
    order_id: "order-77", order_number: "B-77", delivery_note_id: "dn-31", delivery_note_number: "LS-31",
    success: true, ...row,
  }],
  errors: [],
});

const partial = (model: string, error: string): BulkOperationResponse => ({
  model, total_processed: 1, successful: 0, failed: 1, results: [],
  errors: [{ id: "order-77", error }],
});

/** A rejected request as axios hands it over, carrying the server's body. */
const httpError = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });

const callbacks = {
  fetchData: vi.fn(),
  handleFinalizeDeliveryNotesSuccess: vi.fn(),
  handleFinalizeInvoicesSuccess: vi.fn(),
  handleCreateInvoiceSuccess: vi.fn(),
  onOpenDeliveryNoteModal: vi.fn(),
  onOpenInvoiceModal: vi.fn(),
  onOrderNoteChange: vi.fn(),
};

beforeEach(() => {
  Object.values(notify).forEach((fn) => fn.mockReset());
  Object.values(callbacks).forEach((fn) => fn.mockReset());
  api.create.mockReset().mockImplementation(async ({ model }: { model: string }) =>
    model === "invoice"
      ? success("invoice", { delivery_note_id: "dn-31", invoice_id: "inv-12" })
      : success("delivery_note", { delivery_note_id: "dn-31" }),
  );
  api.finalize.mockReset().mockImplementation(async ({ model }: { model: string }) =>
    success(model, model === "invoice" ? { invoice_id: "inv-12" } : { delivery_note_id: "dn-31" }),
  );
  api.destroy.mockReset().mockImplementation(async ({ model }: { model: string }) => success(model, {}));
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** The panel as the orders page holds it, owning the note it edits. */
function Panel({ orderState, initialNote }: { orderState: OrderState; initialNote: string }) {
  const [note, setNote] = useState(initialNote);
  return (
    <OrderInfoPanel
      orderState={orderState}
      formattedOrderNumber={orderState.orderNumber ? `B-${orderState.orderNumber}` : ""}
      totalSum="128,40 €"
      {...callbacks}
      orderNote={note}
      onOrderNoteChange={(next) => {
        callbacks.onOrderNoteChange(next);
        setNote(next);
      }}
    />
  );
}

function renderPanel(orderState: OrderState, initialNote = "") {
  const user = userEvent.setup();
  render(<Panel orderState={orderState} initialNote={initialNote} />);
  return { user };
}

/** The panel row whose label starts with ``labelKey``. */
function row(labelKey: string): HTMLElement {
  const found = Array.from(document.querySelectorAll<HTMLElement>(".order-info > .order-row")).find((each) =>
    each.querySelector(".order-label")?.textContent?.startsWith(labelKey),
  );
  if (!found) throw new Error(`No row labelled ${labelKey}`);
  return found;
}
const value = (labelKey: string) => row(labelKey).querySelector<HTMLElement>(".order-value")!;
const hasRow = (labelKey: string) =>
  Array.from(document.querySelectorAll(".order-label")).some((label) => label.textContent?.startsWith(labelKey));

const ORDER = "resellers.order_number";
const TOTAL = "resellers.total_sum_brutto";
const NOTE = "commissioning.note";
const DELIVERY_NOTE = "resellers.delivery_note_number";
const INVOICE = "resellers.invoice_number";

const button = (labelKey: string, name: string) => within(row(labelKey)).getByRole("button", { name });
const buttonNames = (labelKey: string) =>
  within(row(labelKey))
    .queryAllByRole("button")
    .map((each) => each.textContent)
    .filter((name) => name !== "");

// ── Order, total and markers ────────────────────────────────────────────────

describe("OrderInfoPanel order and total", () => {
  it("shows the order number and gross total, each marked not finalized for a screen reader", () => {
    renderPanel(ORDERED);

    expect(value(ORDER)).toHaveTextContent("commissioning.not_finalizedB-77");
    expect(value(TOTAL)).toHaveTextContent("commissioning.not_finalized128,40 €");
    expect(value(ORDER).querySelector(".icon-check-success")).toBeNull();
  });

  it("ticks the order number and total once the order is finalized", () => {
    renderPanel(NOTE_FINALIZED);

    expect(value(ORDER)).toHaveTextContent("commissioning.finalizedB-77");
    expect(value(TOTAL)).toHaveTextContent("commissioning.finalized128,40 €");
    expect(value(ORDER).querySelector(".icon-check-success")).not.toBeNull();
    expect(value(TOTAL).querySelector(".icon-check-success")).not.toBeNull();
  });

  it("shows placeholders and no document action that could run before an order exists", async () => {
    const { user } = renderPanel(EMPTY);

    expect(hasRow(NOTE)).toBe(false);
    expect(value(DELIVERY_NOTE)).toHaveTextContent("commissioning.not_finalized----");
    expect(value(INVOICE)).toHaveTextContent("commissioning.not_finalized----");
    expect(buttonNames(DELIVERY_NOTE)).toEqual(["commissioning.create_delivery_note"]);
    expect(button(DELIVERY_NOTE, "commissioning.create_delivery_note")).toBeDisabled();
    expect(button(INVOICE, "commissioning.create_invoice")).toBeDisabled();

    await user.click(button(DELIVERY_NOTE, "commissioning.create_delivery_note"));

    expect(api.create).not.toHaveBeenCalled();
  });
});

// ── Note ────────────────────────────────────────────────────────────────────

describe("OrderInfoPanel note", () => {
  const noteDisplay = () => within(row(NOTE)).getByRole("button");
  const noteInput = () => within(row(NOTE)).getByRole("textbox");

  it("shows a dash for an order without a note", () => {
    renderPanel(ORDERED);

    expect(noteDisplay()).toHaveTextContent("—");
    expect(within(row(NOTE)).queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("opens the note for editing on a click and passes every change up", async () => {
    const { user } = renderPanel(ORDERED, "Ring twice");

    expect(noteDisplay()).toHaveTextContent("Ring twice");
    await user.click(noteDisplay());

    expect(noteInput()).toHaveFocus();
    expect(noteInput()).toHaveValue("Ring twice");
    expect(noteInput()).toHaveAttribute("maxlength", "500");
    await user.type(noteInput(), ", back door");

    expect(callbacks.onOrderNoteChange).toHaveBeenLastCalledWith("Ring twice, back door");
    expect(noteInput()).toHaveValue("Ring twice, back door");
  });

  it("closes the note on Enter without adding a line break", async () => {
    const { user } = renderPanel(ORDERED, "Ring twice");

    await user.click(noteDisplay());
    await user.keyboard("{Enter}");

    expect(within(row(NOTE)).queryByRole("textbox")).not.toBeInTheDocument();
    expect(noteDisplay()).toHaveTextContent("Ring twice");
    expect(callbacks.onOrderNoteChange).not.toHaveBeenCalled();
  });

  it("closes the note when the cursor leaves it", async () => {
    const { user } = renderPanel(ORDERED);

    await user.click(noteDisplay());
    await user.type(noteInput(), "Cold store");
    await user.click(row(TOTAL));

    expect(within(row(NOTE)).queryByRole("textbox")).not.toBeInTheDocument();
    expect(noteDisplay()).toHaveTextContent("Cold store");
  });

  it.each(["{Enter}", " "])("opens the note from the keyboard with %s", async (key) => {
    const { user } = renderPanel(ORDERED);

    noteDisplay().focus();
    await user.keyboard(key);

    expect(noteInput()).toHaveFocus();
    expect(noteInput()).toHaveValue("");
  });
});

// ── Delivery note ───────────────────────────────────────────────────────────

describe("OrderInfoPanel delivery note", () => {
  it("creates the order's delivery note and reloads the order", async () => {
    const { user } = renderPanel(ORDERED);

    expect(buttonNames(DELIVERY_NOTE)).toEqual(["commissioning.create_delivery_note"]);
    await user.click(button(DELIVERY_NOTE, "commissioning.create_delivery_note"));

    await waitFor(() => expect(callbacks.fetchData).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledTimes(1);
    expect(api.create).toHaveBeenCalledWith({ ids: ["order-77"], model: "delivery_note" });
    expect(callbacks.handleCreateInvoiceSuccess).not.toHaveBeenCalled();
  });

  it("offers the details, finalizing and deleting of a draft delivery note", async () => {
    const { user } = renderPanel(NOTED);

    expect(value(DELIVERY_NOTE)).toHaveTextContent("commissioning.not_finalizedLS-31");
    expect(buttonNames(DELIVERY_NOTE)).toEqual([
      "commissioning.view_details_delivery_note",
      "commissioning.finalize_delivery_note",
      "commissioning.delete_delivery_note",
    ]);
    expect(button(DELIVERY_NOTE, "commissioning.delete_delivery_note")).toHaveClass("ant-btn-dangerous");

    await user.click(button(DELIVERY_NOTE, "commissioning.view_details_delivery_note"));

    expect(callbacks.onOpenDeliveryNoteModal).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenInvoiceModal).not.toHaveBeenCalled();
  });

  it("finalizes the delivery note and hands the response to the page", async () => {
    const { user } = renderPanel(NOTED);

    await user.click(button(DELIVERY_NOTE, "commissioning.finalize_delivery_note"));

    await waitFor(() => expect(callbacks.handleFinalizeDeliveryNotesSuccess).toHaveBeenCalledTimes(1));
    expect(api.finalize).toHaveBeenCalledWith({ ids: ["order-77"], model: "delivery_note" });
    expect(callbacks.handleFinalizeDeliveryNotesSuccess).toHaveBeenCalledWith(
      success("delivery_note", { delivery_note_id: "dn-31" }),
      ["order-77"],
    );
    expect(callbacks.fetchData).not.toHaveBeenCalled();
  });

  it("deletes the draft delivery note and reloads the order", async () => {
    const { user } = renderPanel(NOTED);

    await user.click(button(DELIVERY_NOTE, "commissioning.delete_delivery_note"));

    await waitFor(() => expect(callbacks.fetchData).toHaveBeenCalledTimes(1));
    expect(api.destroy).toHaveBeenCalledWith({ ids: ["order-77"], model: "delivery_note" });
  });

  it("offers the PDF of a finalized delivery note and nothing that would change it", () => {
    renderPanel(NOTE_FINALIZED);

    expect(value(DELIVERY_NOTE)).toHaveTextContent("commissioning.finalizedLS-31");
    expect(value(DELIVERY_NOTE).querySelector(".icon-check-success")).not.toBeNull();
    expect(buttonNames(DELIVERY_NOTE)).toEqual([
      "commissioning.view_details_delivery_note",
      "Delivery note PDF dn-31",
    ]);
  });

  it("shows the number without a prefix when the tenant sets none", () => {
    renderPanel({ ...NOTED, deliveryNotePrefix: null });

    expect(value(DELIVERY_NOTE)).toHaveTextContent("commissioning.not_finalized-31");
  });

  it("warns about an order the server skipped and still hands its answer to the page", async () => {
    api.finalize.mockResolvedValue(partial("delivery_note", "Cannot finalize an empty delivery note"));
    const { user } = renderPanel(NOTED);

    await user.click(button(DELIVERY_NOTE, "commissioning.finalize_delivery_note"));

    await waitFor(() => expect(callbacks.handleFinalizeDeliveryNotesSuccess).toHaveBeenCalledTimes(1));
    expect(notify.warning).toHaveBeenCalledTimes(1);
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("shows the server's reason when deleting fails and leaves the order as it is", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.destroy.mockRejectedValue(httpError(400, { code: "required_field_missing", message: "ids is required." }));
    const { user } = renderPanel(NOTED);

    await user.click(button(DELIVERY_NOTE, "commissioning.delete_delivery_note"));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith("ids is required."));
    expect(callbacks.fetchData).not.toHaveBeenCalled();
    expect(button(DELIVERY_NOTE, "commissioning.delete_delivery_note")).toBeEnabled();
  });

  it("locks the button while the request runs", async () => {
    let finish: (body: BulkOperationResponse) => void = () => {};
    api.finalize.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { user } = renderPanel(NOTED);

    await user.click(button(DELIVERY_NOTE, "commissioning.finalize_delivery_note"));

    const finalizeButton = () =>
      within(row(DELIVERY_NOTE)).getByRole("button", { name: /commissioning\.finalize_delivery_note/ });
    await waitFor(() => expect(finalizeButton()).toHaveClass("ant-btn-loading"));
    await user.click(finalizeButton());
    expect(api.finalize).toHaveBeenCalledTimes(1);

    await act(async () => finish(success("delivery_note", {})));
    await waitFor(() => expect(callbacks.handleFinalizeDeliveryNotesSuccess).toHaveBeenCalledTimes(1));
  });
});

// ── Invoice ─────────────────────────────────────────────────────────────────

describe("OrderInfoPanel invoice", () => {
  it("lets the office create the invoice only once a delivery note exists", () => {
    renderPanel(ORDERED);

    expect(buttonNames(INVOICE)).toEqual(["commissioning.create_invoice"]);
    expect(button(INVOICE, "commissioning.create_invoice")).toBeDisabled();
  });

  it("creates the invoice from the delivery note and hands the response to the page", async () => {
    const { user } = renderPanel(NOTE_FINALIZED);

    expect(value(INVOICE)).toHaveTextContent("commissioning.not_finalized----");
    await user.click(button(INVOICE, "commissioning.create_invoice"));

    await waitFor(() => expect(callbacks.handleCreateInvoiceSuccess).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith({ ids: ["order-77"], model: "invoice" });
    expect(callbacks.handleCreateInvoiceSuccess).toHaveBeenCalledWith(
      success("invoice", { delivery_note_id: "dn-31", invoice_id: "inv-12" }),
      ["order-77"],
    );
    expect(callbacks.fetchData).not.toHaveBeenCalled();
  });

  it("offers the details, finalizing and deleting of a draft invoice", async () => {
    const { user } = renderPanel(INVOICED);

    expect(value(INVOICE)).toHaveTextContent("commissioning.not_finalizedRE-12");
    expect(buttonNames(INVOICE)).toEqual([
      "commissioning.view_details_invoice",
      "commissioning.finalize_invoice",
      "commissioning.delete_invoice",
    ]);

    await user.click(button(INVOICE, "commissioning.view_details_invoice"));

    expect(callbacks.onOpenInvoiceModal).toHaveBeenCalledTimes(1);
    expect(callbacks.onOpenDeliveryNoteModal).not.toHaveBeenCalled();
  });

  it("finalizes the invoice and hands the response to the page", async () => {
    const { user } = renderPanel(INVOICED);

    await user.click(button(INVOICE, "commissioning.finalize_invoice"));

    await waitFor(() => expect(callbacks.handleFinalizeInvoicesSuccess).toHaveBeenCalledTimes(1));
    expect(api.finalize).toHaveBeenCalledWith({ ids: ["order-77"], model: "invoice" });
    expect(callbacks.handleFinalizeInvoicesSuccess).toHaveBeenCalledWith(
      success("invoice", { invoice_id: "inv-12" }),
      ["order-77"],
    );
  });

  it("deletes the draft invoice and reloads the order", async () => {
    const { user } = renderPanel(INVOICED);

    await user.click(button(INVOICE, "commissioning.delete_invoice"));

    await waitFor(() => expect(callbacks.fetchData).toHaveBeenCalledTimes(1));
    expect(api.destroy).toHaveBeenCalledWith({ ids: ["order-77"], model: "invoice" });
  });

  it("offers the PDF of a finalized invoice and nothing that would change it", () => {
    renderPanel(INVOICE_FINALIZED);

    expect(value(INVOICE)).toHaveTextContent("commissioning.finalizedRE-12");
    expect(buttonNames(INVOICE)).toEqual(["commissioning.view_details_invoice", "Invoice PDF inv-12"]);
    expect(buttonNames(DELIVERY_NOTE)).toEqual([
      "commissioning.view_details_delivery_note",
      "Delivery note PDF dn-31",
    ]);
  });

  it("shows the server's reason when creating the invoice fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.create.mockRejectedValue(
      httpError(429, { code: "finalization_quota_exceeded", message: "Too many finalizations today." }),
    );
    const { user } = renderPanel(NOTE_FINALIZED);

    await user.click(button(INVOICE, "commissioning.create_invoice"));

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith("Too many finalizations today."));
    expect(callbacks.handleCreateInvoiceSuccess).not.toHaveBeenCalled();
  });
});
