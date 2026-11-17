// The external time-tracking system's card: each field saves on its own once
// it is left, the token is never shown, and a stored one can be removed.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const stable = vi.hoisted(() => ({
  tenantRow: { id: "tenant-1" } as Record<string, unknown>,
  mutate: vi.fn(),
  isPending: false,
}));

vi.mock("@hooks/index", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock({ tenant: stable.tenantRow });
  return { useTenant: () => tenant };
});

vi.mock("@shared/api/generated/tenants/tenants", () => ({
  useTenantsTenantsPartialUpdate: () => ({
    mutate: stable.mutate,
    isPending: stable.isPending,
  }),
}));

import HrSystemSettingsCard from "../HrSystemSettingsCard";

const SWITCH = "settings.hr_system.uses_hr_system";
const EMPLOYEES = "settings.hr_system.hr_system_employees_url";
const TOKEN = "settings.hr_system.api_token";
const STORED_URL = "https://hr.example.com/api/employees";

/** The PATCH body of the n-th save. */
function saved(call: number) {
  const [variables] = stable.mutate.mock.calls[call];
  return variables;
}

beforeEach(() => {
  for (const key of Object.keys(stable.tenantRow)) {
    if (key !== "id") delete stable.tenantRow[key];
  }
  stable.mutate.mockReset();
  stable.isPending = false;
});

describe("HrSystemSettingsCard", () => {
  it("asks for addresses and a token only once the system is switched on", async () => {
    const user = userEvent.setup();
    render(<HrSystemSettingsCard />);

    expect(screen.queryByLabelText(EMPLOYEES)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(TOKEN)).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: SWITCH }));

    expect(saved(0)).toEqual({
      id: "tenant-1",
      data: { uses_hr_system: true },
    });
  });

  it("shows the stored addresses and saves a changed one when it is left", async () => {
    stable.tenantRow.uses_hr_system = true;
    stable.tenantRow.hr_system_employees_url = STORED_URL;
    const user = userEvent.setup();
    render(<HrSystemSettingsCard />);

    const field = screen.getByLabelText(EMPLOYEES);
    expect(field).toHaveValue(STORED_URL);

    await user.clear(field);
    await user.type(field, "https://hr.example.com/v2/staff");
    expect(stable.mutate).not.toHaveBeenCalled();
    await user.tab();

    expect(saved(0)).toEqual({
      id: "tenant-1",
      data: { hr_system_employees_url: "https://hr.example.com/v2/staff" },
    });
  });

  it("suggests the shape of each address while it is empty", () => {
    stable.tenantRow.uses_hr_system = true;
    stable.tenantRow.hr_system_employees_url = "";
    render(<HrSystemSettingsCard />);

    expect(screen.getByLabelText(EMPLOYEES)).toHaveAttribute(
      "placeholder",
      "settings.hr_system.hr_system_employees_url_placeholder",
    );
    expect(
      screen.getByLabelText("settings.hr_system.hr_system_absences_url"),
    ).toHaveAttribute(
      "placeholder",
      "settings.hr_system.hr_system_absences_url_placeholder",
    );
  });

  it("saves nothing when an address is left unchanged", async () => {
    stable.tenantRow.uses_hr_system = true;
    stable.tenantRow.hr_system_employees_url = STORED_URL;
    const user = userEvent.setup();
    render(<HrSystemSettingsCard />);

    await user.click(screen.getByLabelText(EMPLOYEES));
    await user.tab();

    expect(stable.mutate).not.toHaveBeenCalled();
  });

  it("never shows a stored token, only that one is stored", () => {
    stable.tenantRow.uses_hr_system = true;
    stable.tenantRow.has_hr_system_api_token = true;
    render(<HrSystemSettingsCard />);

    const field = screen.getByLabelText(TOKEN);
    expect(field).toHaveValue("");
    expect(field).toHaveAttribute("placeholder", "settings.secret_stored");
  });

  it("sends a typed token whole, once the field is left, and empties it", async () => {
    stable.tenantRow.uses_hr_system = true;
    const user = userEvent.setup();
    render(<HrSystemSettingsCard />);
    const field = screen.getByLabelText(TOKEN);
    expect(field).toHaveAttribute("placeholder", "settings.secret_missing");

    await user.type(field, "hr-new-token");
    expect(stable.mutate).not.toHaveBeenCalled();
    await user.tab();

    expect(saved(0)).toEqual({
      id: "tenant-1",
      data: { hr_system_api_token: "hr-new-token" },
    });
    expect(field).toHaveValue("");
  });

  it("removes a stored token", async () => {
    stable.tenantRow.uses_hr_system = true;
    stable.tenantRow.has_hr_system_api_token = true;
    const user = userEvent.setup();
    render(<HrSystemSettingsCard />);

    await user.click(
      screen.getByRole("button", { name: "settings.secret_remove" }),
    );

    expect(saved(0)).toEqual({
      id: "tenant-1",
      data: { hr_system_api_token: null },
    });
  });
});
