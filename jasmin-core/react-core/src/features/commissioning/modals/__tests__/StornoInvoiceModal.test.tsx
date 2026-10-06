/**
 * StornoInvoiceModal: the confirmation an office user goes through before a
 * finalized reseller invoice is cancelled. The modal owns the correction
 * reason; the Invoices page creates the cancellation with whatever reason the
 * modal confirms. Rendered for real (AntD Modal, Input.TextArea, Button).
 */

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import StornoInvoiceModal from "../StornoInvoiceModal";

const REASON_PLACEHOLDER = "commissioning.storno_reason_placeholder";

function renderModal({
  open = true,
  loading = false,
  invoiceLabel = "RE-2026-042",
} = {}) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  const view = render(
    <StornoInvoiceModal
      open={open}
      invoiceLabel={invoiceLabel}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />,
  );
  const rerenderWith = (props: { open: boolean; invoiceLabel?: string }) =>
    view.rerender(
      <StornoInvoiceModal
        open={props.open}
        invoiceLabel={props.invoiceLabel ?? invoiceLabel}
        loading={loading}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    );
  return { onCancel, onConfirm, rerenderWith };
}

const reasonInput = () => screen.getByPlaceholderText(REASON_PLACEHOLDER);

// The name is matched loosely: while loading, AntD prefixes the label with
// its spinner icon.
const confirmButton = () =>
  within(screen.getByRole("dialog")).getByRole("button", {
    name: /commissioning\.create_storno/,
  });

describe("StornoInvoiceModal", () => {
  it("renders nothing while closed", () => {
    renderModal({ open: false });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("names the invoice being cancelled and asks for a reason", () => {
    renderModal();

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("commissioning.storno_for_invoice", {
        exact: false,
      }),
    ).toHaveTextContent("commissioning.storno_for_invoice: RE-2026-042");
    expect(within(dialog).getByText("RE-2026-042").tagName).toBe("STRONG");
    expect(
      within(dialog).getByText("commissioning.correction_reason *"),
    ).toBeInTheDocument();
    expect(reasonInput()).toHaveValue("");
  });

  it("marks the confirm button as a destructive action", () => {
    renderModal();

    expect(confirmButton()).toHaveClass("ant-btn-dangerous");
  });

  it("keeps the confirm button disabled until a reason is typed", async () => {
    renderModal();

    expect(confirmButton()).toBeDisabled();
    await userEvent.type(reasonInput(), "Wrong unit price on line 2");

    expect(confirmButton()).toBeEnabled();
  });

  it("does not accept a reason made of whitespace only", async () => {
    const { onConfirm } = renderModal();

    await userEvent.type(reasonInput(), "   ");
    await userEvent.click(confirmButton());

    expect(confirmButton()).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("disables the confirm button again when the reason is cleared", async () => {
    renderModal();

    await userEvent.type(reasonInput(), "Duplicate invoice");
    await userEvent.clear(reasonInput());

    expect(confirmButton()).toBeDisabled();
  });

  it("confirms the cancellation with the typed reason", async () => {
    const { onConfirm, onCancel } = renderModal();

    await userEvent.type(
      reasonInput(),
      "Wrong unit price on line 2{enter}Reissued as RE-2026-043",
    );
    await userEvent.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      "Wrong unit price on line 2\nReissued as RE-2026-043",
    );
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("closes without cancelling the invoice from the cancel button", async () => {
    const { onConfirm, onCancel } = renderModal();

    await userEvent.type(reasonInput(), "Changed my mind");
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("closes without cancelling the invoice from the close icon", async () => {
    const { onConfirm, onCancel } = renderModal();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows a spinner on the confirm button and ignores clicks while the cancellation is created", async () => {
    const { onConfirm } = renderModal({ loading: true });

    await userEvent.type(reasonInput(), "Wrong customer");
    await userEvent.click(confirmButton());

    expect(confirmButton()).toHaveClass("ant-btn-loading");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("starts with an empty reason every time it opens", async () => {
    const { rerenderWith, onConfirm } = renderModal();

    await userEvent.type(reasonInput(), "Reason for the first invoice");
    rerenderWith({ open: false });
    rerenderWith({ open: true, invoiceLabel: "RE-2026-050" });

    expect(reasonInput()).toHaveValue("");
    expect(confirmButton()).toBeDisabled();
    expect(screen.getByText("RE-2026-050")).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
