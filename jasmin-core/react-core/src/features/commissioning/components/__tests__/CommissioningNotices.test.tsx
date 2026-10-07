/**
 * The notices commissioning pages show above their content:
 * ImportSharesModeBanner (only while the farm takes weekly share demand from
 * the CSV import), FinalizedNotice (the locked-document line with the
 * finalization time in the farm's date and time format) and
 * NoVariationColumnsBanner (a week without share-type variations).
 */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const tenantSettings = vi.hoisted(() => ({
  values: {} as Record<string, unknown>,
}));
vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock({
    getSetting: (key: string, defaultValue?: unknown) =>
      key in tenantSettings.values ? tenantSettings.values[key] : defaultValue,
  });
  return { useTenant: () => tenant };
});

import FinalizedNotice from "../FinalizedNotice";
import ImportSharesModeBanner from "../ImportSharesModeBanner";
import NoVariationColumnsBanner from "../NoVariationColumnsBanner";

beforeEach(() => {
  tenantSettings.values = {};
});

describe("ImportSharesModeBanner", () => {
  const renderBanner = (messageKey?: string) =>
    render(
      <MemoryRouter>
        <ImportSharesModeBanner messageKey={messageKey} />
      </MemoryRouter>,
    );

  it("renders nothing while subscriptions drive the share demand", () => {
    const { container } = renderBanner();

    expect(container).toBeEmptyDOMElement();
  });

  it("explains the import mode and links to the share import", () => {
    tenantSettings.values = { uploads_weekly_share_amount: true };

    renderBanner();

    expect(screen.getByRole("alert")).toHaveTextContent("common.import_shares_mode_banner");
    expect(
      screen.getByRole("link", { name: "common.import_shares_mode_banner_link" }),
    ).toHaveAttribute("href", "/commissioning/import-shares");
  });

  it("shows the page's own message when it passes one", () => {
    tenantSettings.values = { uploads_weekly_share_amount: true };

    renderBanner("commissioning.pickup_list_unavailable_in_import_mode");

    expect(screen.getByRole("alert")).toHaveTextContent(
      "commissioning.pickup_list_unavailable_in_import_mode",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent(
      /common\.import_shares_mode_banner(?!_link)/,
    );
  });
});

describe("FinalizedNotice", () => {
  it("follows the label with the finalization time in the farm's default format", () => {
    const { container } = render(
      <FinalizedNotice label="Finalized on " at="2026-10-05T14:07:00" />,
    );

    expect(container.firstChild).toHaveClass("finalized-notice");
    expect(container.firstChild).toHaveTextContent("Finalized on 05.10.2026 14:07");
  });

  it("uses the farm's own date and time format", () => {
    tenantSettings.values = { date_format: "YYYY-MM-DD", time_format: "hh:mm A" };

    render(<FinalizedNotice label="Locked since " at="2026-10-05T14:07:00" />);

    expect(screen.getByText("Locked since 2026-10-05 02:07 PM")).toBeInTheDocument();
  });
});

describe("NoVariationColumnsBanner", () => {
  it("names the missing configuration as a warning", () => {
    const { container } = render(<NoVariationColumnsBanner />);

    expect(container.firstChild).toHaveClass("past-warning-message");
    expect(screen.getByText("commissioning.no_variation_columns_title").tagName).toBe("STRONG");
    expect(container).toHaveTextContent(
      "commissioning.no_variation_columns_title commissioning.no_variation_columns_message",
    );
  });
});
