/**
 * ``TenantRateLimits`` sends the caps the super-admin typed, leaving out the
 * blank fields so those keep their defaults.
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const api = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock("@shared/services/api", () => ({ default: api }));

import TenantRateLimits from "../TenantRateLimits";

const DEFAULTS = [
  {
    action: "invoice_finalization",
    display_name: "Invoice finalization",
    weekly: 300,
    per_minute: 20,
  },
  {
    action: "member_creation",
    display_name: "Member creation",
    weekly: 1000,
    per_minute: 30,
  },
];

describe("TenantRateLimits", () => {
  it("saves the typed caps and leaves blank ones to the defaults", async () => {
    api.patch.mockResolvedValue({ data: {} });
    const onSaved = vi.fn();
    render(
      <TenantRateLimits
        tenantId="t1"
        defaults={DEFAULTS}
        overrides={{ member_creation: { per_minute: 60 } }}
        onSaved={onSaved}
      />,
    );

    expect(
      screen.getByLabelText("Member creation: per minute"),
    ).toHaveValue(60);
    fireEvent.change(screen.getByLabelText("Invoice finalization: per week"), {
      target: { value: "900" },
    });
    fireEvent.click(screen.getByText("Save rate limits"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.patch).toHaveBeenCalledWith("/api/super-admin/tenants/t1/", {
      action_rate_limit_overrides: {
        invoice_finalization: { weekly: 900 },
        member_creation: { per_minute: 60 },
      },
    });
  });
});
