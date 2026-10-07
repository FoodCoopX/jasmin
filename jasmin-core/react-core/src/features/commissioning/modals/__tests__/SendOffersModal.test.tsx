/**
 * SendOffersModal: the office picks which resellers of an offer group get this
 * week's offer by email. Every reseller not yet sent to starts ticked, the
 * ones already sent to are listed apart, and the send hands the ticked ids to
 * the page, which enqueues the job. Rendered with the real AntD modal, footer
 * and checkbox list; the toasts are recorded.
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const { notify } = vi.hoisted(() => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@shared/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@shared/utils")>()),
  notify,
}));

import SendOffersModal from "../SendOffersModal";

type Reseller = { id: string; name: string; sent: boolean; sent_at: string | null };

const BIOLADEN: Reseller = { id: "res-bioladen", name: "Bioladen Mitte", sent: false, sent_at: null };
const HOFCAFE: Reseller = { id: "res-hofcafe", name: "Hofcafé", sent: false, sent_at: null };
const KANTINE: Reseller = {
  id: "res-kantine", name: "Kantine Nord", sent: true, sent_at: "2026-10-05T08:00:00Z",
};
const MARKT: Reseller = { id: "res-markt", name: "Marktstand", sent: false, sent_at: null };

const RESELLERS = [BIOLADEN, HOFCAFE, KANTINE, MARKT];

/** A rejected request as axios hands it over, carrying the server's body. */
const httpError = (status: number, data: Record<string, unknown>) =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });

let onSend: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  Object.values(notify).forEach((fn) => fn.mockReset());
  onSend = vi.fn().mockResolvedValue(undefined);
  onClose = vi.fn();
});

type Props = Partial<React.ComponentProps<typeof SendOffersModal>>;

function modal(props: Props = {}) {
  return (
    <SendOffersModal
      open
      onClose={onClose}
      resellers={RESELLERS}
      onSend={onSend as (ids: string[]) => Promise<void>}
      year={2026}
      week={42}
      offerGroupName="Gastro"
      {...props}
    />
  );
}

function renderModal(props: Props = {}) {
  const user = userEvent.setup();
  const view = render(modal(props));
  return { user, ...view };
}

const dialog = () => screen.getByRole("dialog", { name: "commissioning.send_offers_via_email" });
const sendButton = () => within(dialog()).getByRole("button", { name: /commissioning\.send \(\d+\)/ });
const cancelButton = () => within(dialog()).getByRole("button", { name: "common.cancel" });
const checkbox = (name: string) => within(dialog()).getByRole("checkbox", { name });
const selectAll = () => checkbox("common.select_all");
const pickerNames = () =>
  Array.from(dialog().querySelectorAll(".checkbox-multi-select__item")).map((item) => item.textContent);
const alreadySentBox = () => within(dialog()).queryByText(/commissioning\.already_sent/)?.parentElement ?? null;

describe("SendOffersModal contents", () => {
  it("shows the week, year and group, and ticks every reseller not yet sent to", () => {
    renderModal();

    expect(dialog()).toHaveTextContent("commissioning.send_offers_description (Gastro)");
    expect(pickerNames()).toEqual(["Bioladen Mitte", "Hofcafé", "Marktstand"]);
    expect(checkbox("Bioladen Mitte")).toBeChecked();
    expect(checkbox("Hofcafé")).toBeChecked();
    expect(checkbox("Marktstand")).toBeChecked();
    expect(selectAll()).toBeChecked();
    expect(sendButton()).toHaveTextContent("commissioning.send (3)");
    expect(sendButton()).toBeEnabled();
  });

  it("lists the resellers already sent to apart, without a checkbox", () => {
    renderModal();

    const box = alreadySentBox();
    expect(box).toHaveTextContent("commissioning.already_sent (1):");
    expect(within(box!).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Kantine Nord"]);
    expect(within(dialog()).queryByRole("checkbox", { name: "Kantine Nord" })).not.toBeInTheDocument();
  });

  it("leaves the group out of the description when it has no name", () => {
    renderModal({ offerGroupName: undefined });

    expect(dialog()).toHaveTextContent("commissioning.send_offers_description");
    expect(dialog()).not.toHaveTextContent("(Gastro)");
  });

  it("says every offer is out and offers no send when all resellers have had it", async () => {
    const { user } = renderModal({ resellers: [{ ...BIOLADEN, sent: true }, KANTINE] });

    expect(within(dialog()).getByText("commissioning.all_offers_already_sent")).toBeInTheDocument();
    expect(within(dialog()).queryByRole("checkbox")).not.toBeInTheDocument();
    expect(alreadySentBox()).toHaveTextContent("commissioning.already_sent (2):");
    expect(sendButton()).toHaveTextContent("commissioning.send (0)");
    expect(sendButton()).toBeDisabled();

    await user.click(sendButton());

    expect(onSend).not.toHaveBeenCalled();
  });

  it("shows no already-sent box when nobody has been sent to", () => {
    renderModal({ resellers: [BIOLADEN, HOFCAFE] });

    expect(alreadySentBox()).toBeNull();
  });

  it("renders nothing while closed", () => {
    renderModal({ open: false });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("SendOffersModal selection and sending", () => {
  it("sends every unsent reseller's id, announces the queued job and closes", async () => {
    const { user } = renderModal();

    await user.click(sendButton());

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith(["res-bioladen", "res-hofcafe", "res-markt"]);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(notify.info).toHaveBeenCalledWith("commissioning.offers_send_queued");
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("sends only the resellers left ticked", async () => {
    const { user } = renderModal();

    await user.click(checkbox("Hofcafé"));

    expect(sendButton()).toHaveTextContent("commissioning.send (2)");
    expect(selectAll()).not.toBeChecked();
    expect(selectAll().closest(".ant-checkbox")).toHaveClass("ant-checkbox-indeterminate");

    await user.click(sendButton());

    expect(onSend).toHaveBeenCalledWith(["res-bioladen", "res-markt"]);
  });

  it("clears and refills the whole selection from select all", async () => {
    const { user } = renderModal();

    await user.click(selectAll());

    expect(checkbox("Bioladen Mitte")).not.toBeChecked();
    expect(sendButton()).toHaveTextContent("commissioning.send (0)");
    expect(sendButton()).toBeDisabled();

    await user.click(sendButton());
    expect(onSend).not.toHaveBeenCalled();

    await user.click(checkbox("Marktstand"));
    await user.click(selectAll());

    expect(sendButton()).toHaveTextContent("commissioning.send (3)");
    await user.click(sendButton());
    expect(onSend).toHaveBeenCalledWith(["res-bioladen", "res-hofcafe", "res-markt"]);
  });

  it("shows a spinner on the send and locks cancel while the request runs", async () => {
    let finish: () => void = () => {};
    onSend.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
    const { user } = renderModal();

    await user.click(sendButton());

    await waitFor(() => expect(sendButton()).toHaveClass("ant-btn-loading"));
    expect(cancelButton()).toBeDisabled();
    expect(onClose).not.toHaveBeenCalled();

    finish();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it("shows the server's reason when the send fails and stays open with the selection", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    onSend.mockRejectedValue(
      httpError(400, { code: "offers.no_offers", message: "There are no offers for week 42." }),
    );
    const { user } = renderModal();

    await user.click(checkbox("Marktstand"));
    await user.click(sendButton());

    await waitFor(() => expect(notify.error).toHaveBeenCalledTimes(1));
    expect(notify.error).toHaveBeenCalledWith("There are no offers for week 42.");
    expect(notify.info).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).toBeInTheDocument();
    expect(sendButton()).not.toHaveClass("ant-btn-loading");
    expect(sendButton()).toHaveTextContent("commissioning.send (2)");
    expect(cancelButton()).toBeEnabled();
  });

  it("falls back to its own message when the failure carries no reason", async () => {
    onSend.mockRejectedValue({});
    const { user } = renderModal();

    await user.click(sendButton());

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("commissioning.failed_to_send_offers"),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from cancel without sending", async () => {
    const { user } = renderModal();

    await user.click(cancelButton());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("SendOffersModal reopening", () => {
  it("keeps the office's unticks while the page re-renders with a fresh list", async () => {
    const { user, rerender } = renderModal();

    await user.click(checkbox("Hofcafé"));
    rerender(modal({ resellers: RESELLERS.map((reseller) => ({ ...reseller })) }));

    expect(checkbox("Hofcafé")).not.toBeChecked();
    expect(sendButton()).toHaveTextContent("commissioning.send (2)");
  });

  it("ticks every unsent reseller again when it reopens, by the list it reopens with", async () => {
    const { user, rerender } = renderModal();

    await user.click(checkbox("Hofcafé"));
    rerender(modal({ open: false }));
    // Bioladen has had its offer since.
    rerender(modal({ open: true, resellers: [{ ...BIOLADEN, sent: true }, HOFCAFE, KANTINE, MARKT] }));

    await waitFor(() => expect(sendButton()).toHaveTextContent("commissioning.send (2)"));
    expect(pickerNames()).toEqual(["Hofcafé", "Marktstand"]);
    expect(checkbox("Hofcafé")).toBeChecked();
    await user.click(sendButton());
    expect(onSend).toHaveBeenCalledWith(["res-hofcafe", "res-markt"]);
  });
});
