/**
 * UserProfileModal: the signed-in user's own name, edited on the profile tab.
 * The profile PATCH is the mocking boundary; the 2FA and my-data tabs are
 * stubbed, since only the profile tab is under test.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const { authPartialUpdate, gdprRequestDeletionCreate, logout, notify, updateUser } =
  vi.hoisted(() => ({
    authPartialUpdate: vi.fn(),
    gdprRequestDeletionCreate: vi.fn(),
    logout: vi.fn(),
    notify: { error: vi.fn(), success: vi.fn() },
    updateUser: vi.fn(),
  }));

vi.mock("@shared/api/generated/auth/auth", () => ({ authPartialUpdate }));
vi.mock("@shared/api/generated/gdpr/gdpr", () => ({
  gdprRequestDeletionCreate,
}));
vi.mock("@shared/utils/notify", () => ({ default: notify }));
vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: "u1",
      email: "ada@example.com",
      first_name: "Ada",
      last_name: "Lovelace",
      roles: ["member"],
    },
    logout,
    updateUser,
  }),
}));
vi.mock("@shared/profile/TwoFactorPanel", () => ({
  default: () => <div data-testid="two-factor-panel" />,
}));
vi.mock("../MyDataTab", () => ({
  default: ({ onRequestDeletion }: { onRequestDeletion: () => void }) => (
    <button type="button" onClick={onRequestDeletion}>
      request-deletion
    </button>
  ),
}));

import { TenantContext } from "@shared/contexts/TenantContext";
import UserProfileModal from "../UserProfileModal";

async function editAndSave() {
  render(<UserProfileModal open onClose={vi.fn()} />);
  await userEvent.click(await screen.findByRole("button", { name: "common.edit" }));
  for (const [label, value] of [
    ["profile.first_name", "Ada"],
    ["profile.last_name", "Byron"],
  ]) {
    const input = screen.getByLabelText(label);
    await userEvent.clear(input);
    await userEvent.type(input, value);
  }
  await userEvent.click(screen.getByRole("button", { name: "common.save" }));
}

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  authPartialUpdate.mockReset();
  gdprRequestDeletionCreate.mockReset();
  logout.mockReset();
  notify.error.mockReset();
  notify.success.mockReset();
  updateUser.mockReset();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("UserProfileModal profile save", () => {
  it("saves the name to the profile and the signed-in user", async () => {
    authPartialUpdate.mockResolvedValue({});

    await editAndSave();

    await waitFor(() => expect(notify.success).toHaveBeenCalledWith("profile.saved"));
    expect(authPartialUpdate).toHaveBeenCalledWith("u1", {
      first_name: "Ada",
      last_name: "Byron",
    });
    expect(updateUser).toHaveBeenCalledWith({
      first_name: "Ada",
      last_name: "Byron",
    });
  });

  it("tells the user a refused save failed and logs nothing to the console", async () => {
    authPartialUpdate.mockRejectedValue(new Error("Network Error"));

    await editAndSave();

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("profile.save_error"),
    );
    expect(updateUser).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("UserProfileModal profile validation", () => {
  it("leaves an empty name to the form's own message instead of a failed-save toast", async () => {
    render(<UserProfileModal open onClose={vi.fn()} />);
    await userEvent.click(await screen.findByRole("button", { name: "common.edit" }));
    await userEvent.clear(screen.getByLabelText("profile.first_name"));
    await userEvent.click(screen.getByRole("button", { name: "common.save" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "common.save" })).not.toHaveClass(
        "ant-btn-loading",
      ),
    );
    expect(authPartialUpdate).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });
});

describe("UserProfileModal deletion request", () => {
  async function requestDeletion() {
    render(<UserProfileModal open onClose={vi.fn()} initialTab="my_data" />);
    await userEvent.click(await screen.findByRole("button", { name: "request-deletion" }));
    await userEvent.click(await screen.findByRole("button", { name: "gdpr.confirm_delete" }));
  }

  it("signs the user out once the request is sent", async () => {
    gdprRequestDeletionCreate.mockResolvedValue({});

    await requestDeletion();

    await waitFor(() => expect(logout).toHaveBeenCalled());
    expect(notify.error).not.toHaveBeenCalled();
  });

  it("tells the user a refused request failed, with the server's reason", async () => {
    gdprRequestDeletionCreate.mockRejectedValue({
      isAxiosError: true,
      response: { status: 400, data: { message: "Open invoices remain" } },
    });

    await requestDeletion();

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("Open invoices remain"),
    );
    expect(logout).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("falls back to its own message when the server gives no reason", async () => {
    gdprRequestDeletionCreate.mockRejectedValue(new Error("Network Error"));

    await requestDeletion();

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("gdpr.request_deletion_failed"),
    );
  });
});

describe("UserProfileModal layout", () => {
  it("spaces the profile's action row with the shared utility", async () => {
    render(<UserProfileModal open onClose={vi.fn()} />);

    const editButton = await screen.findByRole("button", { name: "common.edit" });
    expect(editButton.parentElement).toHaveClass("mt-16");
  });

  it("spaces the deletion warning with the shared utility", async () => {
    render(<UserProfileModal open onClose={vi.fn()} initialTab="my_data" />);
    await userEvent.click(await screen.findByRole("button", { name: "request-deletion" }));

    expect(await screen.findByRole("alert")).toHaveClass("mb-16");
  });
});

describe("UserProfileModal tabs", () => {
  function renderInDeployment(capabilities: Record<string, boolean>) {
    const value = { tenant: { capabilities } } as unknown as Parameters<
      typeof TenantContext.Provider
    >[0]["value"];
    render(
      <TenantContext.Provider value={value}>
        <UserProfileModal open onClose={vi.fn()} initialTab="my_data" />
      </TenantContext.Provider>,
    );
  }

  it("shows the profile, my data and two-factor tabs on its own", async () => {
    renderInDeployment({ user_accounts: true, gdpr: true });

    for (const tab of ["profile.tab_profile", "profile.tab_my_data", "profile.tab_two_factor"]) {
      expect(await screen.findByRole("tab", { name: tab })).toBeInTheDocument();
    }
  });

  it("leaves out the account tabs where the host application owns the logins", async () => {
    renderInDeployment({ user_accounts: false, gdpr: true });

    expect(await screen.findByRole("tab", { name: "profile.tab_my_data" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "profile.tab_profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "profile.tab_two_factor" })).not.toBeInTheDocument();
  });

  it("leaves out my data where the deployment has no data-protection actions", async () => {
    renderInDeployment({ user_accounts: true, gdpr: false });

    expect(await screen.findByRole("tab", { name: "profile.tab_profile" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "profile.tab_my_data" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "request-deletion" })).not.toBeInTheDocument();
  });
});
