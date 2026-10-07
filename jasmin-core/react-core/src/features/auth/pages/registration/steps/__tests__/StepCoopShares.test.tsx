/**
 * Registration step 1 (cooperative shares): under the generic intro it shows
 * the tenant's own explanation of its shares, when the office has written one,
 * and it takes a whole number of shares. The tenant sets no number format, so
 * the count is typed the German way, with a decimal comma.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { StepProps } from "../../types";

const state = vi.hoisted(() => ({ tenant: {} as Record<string, unknown> }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@hooks/index", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  return {
    useTenant: () => makeUseTenantMock({ tenant: state.tenant }),
    useCurrency: () => ({ formatCurrency: (value: number) => `${value} €` }),
  };
});

// The share count field reads the tenant's number format straight from useTenant.
vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  return { useTenant: () => makeUseTenantMock({ tenant: state.tenant }) };
});

vi.mock("@shared/consent/useCurrentConsentDoc", () => ({
  useCurrentConsentDoc: () => ({ doc: null, isLoading: false }),
}));

import StepCoopShares from "../StepCoopShares";

const props: StepProps = {
  data: {} as StepProps["data"],
  update: vi.fn(),
  next: vi.fn(),
  back: vi.fn(),
};

beforeEach(() => {
  vi.mocked(props.update).mockReset();
  vi.mocked(props.next).mockReset();
});

describe("StepCoopShares", () => {
  beforeEach(() => {
    state.tenant = {
      min_number_coop_shares: 3,
      max_number_coop_shares: 10,
      value_one_coop_share: 100,
    };
  });

  it("shows the tenant's explanation under the intro", () => {
    state.tenant.info_sentence_about_coop_shares =
      "Shares are paid back when you leave.";

    render(<StepCoopShares {...props} />);

    expect(
      screen.getByText("Shares are paid back when you leave."),
    ).toBeInTheDocument();
  });

  it("adds nothing when the tenant has written none", () => {
    state.tenant.info_sentence_about_coop_shares = "   ";

    const { container } = render(<StepCoopShares {...props} />);

    expect(screen.getByText("auth.registration.coop.intro")).toBeInTheDocument();
    expect(container.querySelector(".text-preline")).toBeNull();
  });

  it("rounds a typed fraction to a whole number of shares", async () => {
    const user = userEvent.setup();
    render(<StepCoopShares {...props} />);
    const count = screen.getByLabelText("auth.registration.coop.shares_label");

    await user.clear(count);
    await user.type(count, "3,5");
    await user.click(
      screen.getByRole("button", { name: "auth.registration.actions.next" }),
    );

    expect(count).toHaveValue("4");
    expect(props.update).toHaveBeenCalledWith(
      expect.objectContaining({ coop_shares_count: 4 }),
    );
    expect(props.next).toHaveBeenCalledTimes(1);
  });
});
