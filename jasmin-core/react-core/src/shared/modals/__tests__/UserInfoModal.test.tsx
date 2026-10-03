// UserInfoModal offers the invitation actions for the account status, and a
// caller-supplied reason — or a missing SMTP host of the tenant's own —
// disables them with a hover tooltip and an accessible description.

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const smtp = vi.hoisted(() => ({ configured: true as boolean | undefined }));

vi.mock("@shared/hooks/configuration/useTenantSmtpConfigured", () => ({
  useTenantSmtpConfigured: () => smtp.configured,
}));

// The real reason hook, over the stubbed SMTP lookup above.
vi.mock("@hooks/index", async () => {
  const { useInvitationDisabledReason } = await import(
    "@shared/hooks/configuration/useInvitationDisabledReason"
  );
  return {
    useDateFormat: () => ({
      formatDateWithFallback: (value: unknown) => String(value ?? "-"),
    }),
    useInvitationDisabledReason,
  };
});

import UserInfoModal from "../UserInfoModal";

const MEMBER_WITHOUT_USER = {
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.test",
  linked_user_info: null,
};

const MEMBER_WITH_OPEN_INVITATION = {
  ...MEMBER_WITHOUT_USER,
  linked_user_info: {
    account_status: "pending_invitation" as const,
    is_invitation_expired: false,
    invitation_expires_at: "2026-10-01T00:00:00Z",
  },
};

const MEMBER_WITH_EXPIRED_INVITATION = {
  ...MEMBER_WITHOUT_USER,
  linked_user_info: {
    account_status: "pending_invitation" as const,
    is_invitation_expired: true,
    invitation_expires_at: "2026-09-01T00:00:00Z",
  },
};

const REASON = "onboarding.mode.invitation_disabled";

beforeEach(() => {
  smtp.configured = true;
});

describe("UserInfoModal invitation actions", () => {
  it("sends an invitation for a member without a user", async () => {
    const onSendInvitation = vi.fn();
    render(
      <UserInfoModal
        isOpen
        onClose={vi.fn()}
        record={MEMBER_WITHOUT_USER}
        onSendInvitation={onSendInvitation}
      />,
    );

    const button = screen.getByRole("button", { name: "users.send_invitation" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-describedby");
    await userEvent.click(button);
    expect(onSendInvitation).toHaveBeenCalledWith(MEMBER_WITHOUT_USER);
  });

  it("disables sending with the reason as description and tooltip", async () => {
    const onSendInvitation = vi.fn();
    render(
      <UserInfoModal
        isOpen
        onClose={vi.fn()}
        record={MEMBER_WITHOUT_USER}
        onSendInvitation={onSendInvitation}
        invitationDisabledReason={REASON}
      />,
    );

    const button = screen.getByRole("button", { name: "users.send_invitation" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(REASON);

    await userEvent.hover(button.parentElement!);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(REASON);
    expect(tooltip.closest(".custom-tooltip")).not.toBeNull();
    expect(onSendInvitation).not.toHaveBeenCalled();
  });

  it("disables resending an open invitation with the reason", () => {
    render(
      <UserInfoModal
        isOpen
        onClose={vi.fn()}
        record={MEMBER_WITH_OPEN_INVITATION}
        onResendInvitation={vi.fn()}
        invitationDisabledReason={REASON}
      />,
    );

    const button = screen.getByRole("button", {
      name: "users.resend_invitation",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(REASON);
  });

  it("disables a new invitation for an expired one with the reason", () => {
    render(
      <UserInfoModal
        isOpen
        onClose={vi.fn()}
        record={MEMBER_WITH_EXPIRED_INVITATION}
        onSendInvitation={vi.fn()}
        onResendInvitation={vi.fn()}
        invitationDisabledReason={REASON}
      />,
    );

    const button = screen.getByRole("button", {
      name: "users.send_new_invitation",
    });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(REASON);
  });

  it("disables invitations without an SMTP host of the tenant's own", () => {
    smtp.configured = false;
    render(
      <UserInfoModal
        isOpen
        onClose={vi.fn()}
        record={MEMBER_WITHOUT_USER}
        onSendInvitation={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", { name: "users.send_invitation" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("users.smtp_missing_reason");
  });

  it("names the caller's reason over the missing SMTP host", () => {
    smtp.configured = false;
    render(
      <UserInfoModal
        isOpen
        onClose={vi.fn()}
        record={MEMBER_WITH_OPEN_INVITATION}
        onResendInvitation={vi.fn()}
        invitationDisabledReason={REASON}
      />,
    );

    expect(
      screen.getByRole("button", { name: "users.resend_invitation" }),
    ).toHaveAccessibleDescription(REASON);
  });

  it("keeps resending enabled without a reason", () => {
    render(
      <UserInfoModal
        isOpen
        onClose={vi.fn()}
        record={MEMBER_WITH_OPEN_INVITATION}
        onResendInvitation={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "users.resend_invitation" }),
    ).toBeEnabled();
  });
});
