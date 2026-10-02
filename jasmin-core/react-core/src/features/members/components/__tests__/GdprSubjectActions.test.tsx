import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  isAdmin: true,
  eraseMember: vi.fn(),
  eraseReseller: vi.fn(),
  exportMember: vi.fn(),
  exportReseller: vi.fn(),
  downloadBlob: vi.fn(),
  notify: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@shared/auth", () => ({
  useRoles: () => ({ isAdmin: state.isAdmin }),
}));

vi.mock("@shared/utils", () => ({
  downloadBlob: (...args: unknown[]) => state.downloadBlob(...args),
  notify: state.notify,
}));

vi.mock("@shared/api/generated/gdpr/gdpr", () => ({
  gdprAdminMembersSubjectAccessRetrieve: (id: string) => state.exportMember(id),
  gdprAdminResellersSubjectAccessRetrieve: (id: string) =>
    state.exportReseller(id),
  useGdprAdminMembersEraseCreate: () => ({
    mutateAsync: state.eraseMember,
    isPending: false,
  }),
  useGdprAdminResellersEraseCreate: () => ({
    mutateAsync: state.eraseReseller,
    isPending: false,
  }),
  getGdprAdminPendingDeletionsRetrieveQueryKey: () => ["pending"],
  getGdprAdminDecidedDeletionsListQueryKey: () => ["decided"],
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import GdprSubjectActions from "../GdprSubjectActions";

function renderActions(onErased = vi.fn()) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <GdprSubjectActions
        subject={{ kind: "member", id: "MeMbEr000001" }}
        onErased={onErased}
      />
    </QueryClientProvider>,
  );
  return onErased;
}

// jsdom's Blob has no text(); FileReader reads it.
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.readAsText(blob);
  });
}

async function chooseChannelAndErase(channelLabel: string) {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: /gdpr.office_actions.erase/ }),
  );
  await user.click(
    screen.getByLabelText("gdpr.office_actions.channel_label"),
  );
  await user.click(await screen.findByText(channelLabel));
  await user.click(
    screen.getByRole("button", { name: "gdpr.office_actions.erase_confirm" }),
  );
}

beforeEach(() => {
  state.isAdmin = true;
  state.eraseMember.mockReset();
  state.eraseReseller.mockReset();
  state.exportMember.mockReset();
  state.downloadBlob.mockReset();
  state.notify.success.mockReset();
  state.notify.error.mockReset();
});

describe("GdprSubjectActions", () => {
  it("is not offered to anyone but an admin", () => {
    state.isAdmin = false;

    renderActions();

    expect(
      screen.queryByRole("button", { name: /gdpr.office_actions.export/ }),
    ).not.toBeInTheDocument();
  });

  it("downloads the member's personal data as JSON", async () => {
    state.exportMember.mockResolvedValue({ subject: { member_id: "x" } });
    renderActions();

    await userEvent.click(
      screen.getByRole("button", { name: /gdpr.office_actions.export/ }),
    );

    await waitFor(() => expect(state.downloadBlob).toHaveBeenCalledOnce());
    expect(state.exportMember).toHaveBeenCalledWith("MeMbEr000001");
    const [blob, filename] = state.downloadBlob.mock.calls[0];
    expect(filename).toBe("personal-data-member-MeMbEr000001.json");
    expect(JSON.parse(await readBlob(blob as Blob))).toEqual({
      subject: { member_id: "x" },
    });
  });

  it("erases with the channel the person asked through", async () => {
    state.eraseMember.mockResolvedValue({ request_id: "r", state: "executed" });
    const onErased = renderActions();

    await chooseChannelAndErase("gdpr.channel.letter");

    await waitFor(() => expect(onErased).toHaveBeenCalledOnce());
    expect(state.eraseMember).toHaveBeenCalledWith({
      memberId: "MeMbEr000001",
      data: { channel: "letter" },
    });
    expect(state.notify.success).toHaveBeenCalledWith(
      "gdpr.office_actions.erased",
    );
  });

  it("lists what still blocks the erasure", async () => {
    state.eraseMember.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          code: "gdpr.retention_active",
          message: "Cannot anonymize",
          details: {
            reasons: ["1 open CoopShare(s)"],
            request_id: "r",
          },
        },
      },
    });
    const onErased = renderActions();

    await chooseChannelAndErase("gdpr.channel.phone");

    expect(
      await screen.findByText("gdpr.office_actions.blocked_title"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 open CoopShare(s)")).toBeInTheDocument();
    expect(onErased).not.toHaveBeenCalled();
    expect(state.notify.error).not.toHaveBeenCalled();
  });

  it("needs a channel before it erases", async () => {
    renderActions();

    await userEvent.click(
      screen.getByRole("button", { name: /gdpr.office_actions.erase/ }),
    );

    expect(
      screen.getByRole("button", { name: "gdpr.office_actions.erase_confirm" }),
    ).toBeDisabled();
  });
});
