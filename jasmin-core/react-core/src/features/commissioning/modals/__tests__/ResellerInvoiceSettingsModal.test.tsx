/**
 * ResellerInvoiceSettingsModal: the invoice-related fields of one reseller
 * (identity numbers, IBAN, invoice address, invoice email, payment terms and
 * early-payment discount), saved with a partial update. Rendered for real —
 * AntD form, the shared EditFormModal and useModalMutation — with only the
 * generated client and the toast helper mocked.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Reseller } from "@shared/api/generated/models";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const { notifyMock, partialUpdateMock } = vi.hoisted(() => ({
  notifyMock: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
  partialUpdateMock: vi.fn(),
}));

vi.mock("@shared/utils/notify", () => ({ default: notifyMock }));

vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  commissioningResellersPartialUpdate: partialUpdateMock,
}));

import ResellerInvoiceSettingsModal from "../ResellerInvoiceSettingsModal";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeReseller(overrides: Partial<Reseller> = {}): Reseller {
  return {
    id: "res-1",
    company_name: "Acme Grocers GmbH",
    first_name: "Ada",
    last_name: "Acres",
    invoice_name: "Acme Grocers Accounts",
    invoice_name2: "c/o Bookkeeping",
    invoice_address: "Market Street 1",
    invoice_plz: "12345",
    invoice_city: "Berlin",
    invoice_via_email: true,
    invoice_email: "invoices@acme.test",
    customer_number: 1042,
    filial_number: 3,
    uid: "DE123456789",
    iban_stored: true,
    iban_masked: "DE89 **** **** **** **** 00",
    payment_terms_in_days: 14,
    early_payment_discount_percent: "2.50",
    early_payment_discount_days: 7,
    ...overrides,
  } as Reseller;
}

function renderModal(reseller: Reseller | null = makeReseller()) {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  render(
    <ResellerInvoiceSettingsModal
      open
      reseller={reseller}
      onClose={onClose}
      onSaved={onSaved}
    />,
  );
  return { onClose, onSaved };
}

const field = (label: string) =>
  screen.getByLabelText(label) as HTMLInputElement;

// The name is matched loosely: while saving, AntD prefixes the label with
// its loading icon.
async function save() {
  await userEvent.click(screen.getByRole("button", { name: /common\.save/ }));
}

beforeEach(() => {
  partialUpdateMock.mockReset();
  Object.values(notifyMock).forEach((fn) => fn.mockReset());
});

// ── Rendering ───────────────────────────────────────────────────────────────

describe("ResellerInvoiceSettingsModal rendering", () => {
  it("renders nothing without a reseller", () => {
    renderModal(null);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each([
    ["the invoice name", {}, "Acme Grocers Accounts"],
    ["the company name", { invoice_name: "" }, "Acme Grocers GmbH"],
    [
      "the person's name",
      { invoice_name: "", company_name: "" },
      "Ada Acres",
    ],
  ])("titles the modal with %s", (_case, overrides, expected) => {
    renderModal(makeReseller(overrides as Partial<Reseller>));

    expect(
      within(screen.getByRole("dialog")).getByText(
        `resellers.invoice_settings_title ${expected}`,
      ),
    ).toBeInTheDocument();
  });

  it("prefills the reseller's invoice settings", async () => {
    renderModal();

    await waitFor(() =>
      expect(field("resellers.customer_number")).toHaveValue("1042"),
    );
    expect(field("resellers.filial_number")).toHaveValue("3");
    expect(field("resellers.uid")).toHaveValue("DE123456789");
    expect(field("resellers.invoice_name")).toHaveValue("Acme Grocers Accounts");
    expect(field("resellers.invoice_name2")).toHaveValue("c/o Bookkeeping");
    expect(field("resellers.invoice_address")).toHaveValue("Market Street 1");
    expect(field("resellers.invoice_plz")).toHaveValue("12345");
    expect(field("resellers.invoice_city")).toHaveValue("Berlin");
    expect(field("resellers.invoice_email")).toHaveValue("invoices@acme.test");
    expect(field("resellers.payment_terms_in_days")).toHaveValue("14");
    expect(field("resellers.early_payment_discount_percent")).toHaveValue(
      "2.50",
    );
    expect(field("resellers.early_payment_discount_days")).toHaveValue("7");
    expect(
      screen.getByRole("switch", { name: "resellers.invoice_via_email" }),
    ).toBeChecked();
  });

  it("leaves the IBAN empty and names the stored, masked IBAN instead", async () => {
    renderModal();

    const iban = field("resellers.iban");
    await waitFor(() =>
      expect(field("resellers.uid")).toHaveValue("DE123456789"),
    );
    expect(iban).toHaveValue("");
    expect(iban).toHaveAttribute("placeholder", "resellers.iban_type_to_change");
    expect(
      screen.getByText("resellers.iban_stored: DE89 **** **** **** **** 00"),
    ).toBeInTheDocument();
  });

  it("gives no stored-IBAN hint when the reseller has no IBAN", () => {
    renderModal(makeReseller({ iban_stored: false, iban_masked: "" }));

    expect(field("resellers.iban")).not.toHaveAttribute("placeholder");
    expect(screen.queryByText(/resellers\.iban_stored/)).not.toBeInTheDocument();
  });
});

// ── Saving ──────────────────────────────────────────────────────────────────

describe("ResellerInvoiceSettingsModal saving", () => {
  it("saves the settings with a partial update that leaves the stored IBAN alone", async () => {
    const updated = makeReseller({ payment_terms_in_days: 30 });
    partialUpdateMock.mockResolvedValue(updated);
    const { onClose, onSaved } = renderModal();
    await waitFor(() =>
      expect(field("resellers.uid")).toHaveValue("DE123456789"),
    );

    await save();

    await waitFor(() => expect(partialUpdateMock).toHaveBeenCalledTimes(1));
    const [id, payload] = partialUpdateMock.mock.calls[0];
    expect(id).toBe("res-1");
    expect(payload).toEqual({
      customer_number: 1042,
      filial_number: 3,
      uid: "DE123456789",
      invoice_name: "Acme Grocers Accounts",
      invoice_name2: "c/o Bookkeeping",
      invoice_address: "Market Street 1",
      invoice_plz: "12345",
      invoice_city: "Berlin",
      invoice_via_email: true,
      invoice_email: "invoices@acme.test",
      payment_terms_in_days: 14,
      early_payment_discount_percent: "2.50",
      early_payment_discount_days: 7,
    });
    expect(payload).not.toHaveProperty("iban");
    expect(notifyMock.success).toHaveBeenCalledWith(
      "resellers.invoice_settings_saved",
    );
    expect(onSaved).toHaveBeenCalledWith(updated);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("switches a reseller to paper invoices", async () => {
    partialUpdateMock.mockResolvedValue(makeReseller({ invoice_via_email: false }));
    renderModal();
    const emailSwitch = await screen.findByRole("switch", {
      name: "resellers.invoice_via_email",
    });
    await waitFor(() => expect(emailSwitch).toBeChecked());

    await userEvent.click(emailSwitch);
    await save();

    await waitFor(() => expect(partialUpdateMock).toHaveBeenCalledTimes(1));
    expect(partialUpdateMock.mock.calls[0][1]).toMatchObject({
      invoice_via_email: false,
    });
  });

  it("sends a newly typed IBAN", async () => {
    partialUpdateMock.mockResolvedValue(makeReseller());
    renderModal();

    await userEvent.type(field("resellers.iban"), "DE89370400440532013000");
    await save();

    await waitFor(() => expect(partialUpdateMock).toHaveBeenCalledTimes(1));
    expect(partialUpdateMock.mock.calls[0][1]).toMatchObject({
      iban: "DE89370400440532013000",
    });
  });

  it("sends changed payment terms, with the discount percent as a decimal string", async () => {
    partialUpdateMock.mockResolvedValue(makeReseller());
    renderModal();
    await waitFor(() =>
      expect(field("resellers.payment_terms_in_days")).toHaveValue("14"),
    );

    await userEvent.clear(field("resellers.payment_terms_in_days"));
    await userEvent.type(field("resellers.payment_terms_in_days"), "30");
    await userEvent.clear(field("resellers.early_payment_discount_percent"));
    await userEvent.type(
      field("resellers.early_payment_discount_percent"),
      "3.75",
    );
    await save();

    await waitFor(() => expect(partialUpdateMock).toHaveBeenCalledTimes(1));
    expect(partialUpdateMock.mock.calls[0][1]).toMatchObject({
      payment_terms_in_days: 30,
      early_payment_discount_percent: "3.75",
      early_payment_discount_days: 7,
    });
  });

  it("refuses to save an invalid invoice email", async () => {
    renderModal();
    await waitFor(() =>
      expect(field("resellers.invoice_email")).toHaveValue(
        "invoices@acme.test",
      ),
    );

    await userEvent.clear(field("resellers.invoice_email"));
    await userEvent.type(field("resellers.invoice_email"), "not-an-email");
    await save();

    expect(await screen.findByText("common.invalid_email")).toBeInTheDocument();
    expect(partialUpdateMock).not.toHaveBeenCalled();
  });

  it("shows the server's message and stays open when saving fails", async () => {
    partialUpdateMock.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          code: "validation_error",
          message: "Customer number 1042 is already in use.",
        },
      },
    });
    const { onClose, onSaved } = renderModal();
    await waitFor(() =>
      expect(field("resellers.uid")).toHaveValue("DE123456789"),
    );

    await save();

    await waitFor(() =>
      expect(notifyMock.error).toHaveBeenCalledWith(
        "Customer number 1042 is already in use.",
      ),
    );
    expect(notifyMock.success).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("falls back to the modal's own message when the failure carries none", async () => {
    partialUpdateMock.mockRejectedValue({ isAxiosError: true, response: {} });
    renderModal();

    await save();

    await waitFor(() =>
      expect(notifyMock.error).toHaveBeenCalledWith(
        "resellers.invoice_settings_save_error",
      ),
    );
  });

  it("blocks a second save and the cancel button while a save is in flight", async () => {
    let resolveSave: (value: Reseller) => void = () => {};
    partialUpdateMock.mockReturnValue(
      new Promise<Reseller>((resolve) => {
        resolveSave = resolve;
      }),
    );
    const { onClose } = renderModal();

    await save();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "common.cancel" })).toBeDisabled(),
    );
    await save();
    resolveSave(makeReseller());
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(partialUpdateMock).toHaveBeenCalledTimes(1);
  });

  it("closes without saving on cancel", async () => {
    const { onClose } = renderModal();

    await userEvent.click(screen.getByRole("button", { name: "common.cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(partialUpdateMock).not.toHaveBeenCalled();
  });
});
