/**
 * ConfigurationCommissioning: which commissioning settings the office gets.
 * The settings page that renders and saves them is a stub that keeps the
 * settings it was handed.
 */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SettingsCategory } from "@features/configuration/components/SettingsRenderer";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// What the deployment offers, per test; a name left out is offered.
const capabilities = vi.hoisted(() => ({}) as Record<string, boolean>);
// Whether the farm imports its share amounts, buys produce in and sells to
// resellers, per test.
const farm = vi.hoisted(() => ({
  importsShareAmounts: false,
  hasPurchases: true,
  sellsToResellers: true,
}));
vi.mock("@hooks/index", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock({
    getSetting: (key: string, fallback?: unknown) => {
      if (key === "uploads_weekly_share_amount") return farm.importsShareAmounts;
      if (key === "has_purchases") return farm.hasPurchases;
      if (key === "sells_to_resellers") return farm.sellsToResellers;
      return fallback;
    },
  });
  return {
    useCapability: (name: string) => capabilities[name] ?? true,
    useTenant: () => tenant,
  };
});

const shown = vi.hoisted(() => ({ settings: [] as SettingsCategory[] }));
vi.mock("@features/configuration/components/SettingsPage", () => ({
  default: ({ settingsConfig }: { settingsConfig: SettingsCategory[] }) => {
    shown.settings = settingsConfig;
    return null;
  },
}));

import ConfigurationCommissioning from "../ConfigurationCommissioning";

const layoutKeys = () =>
  shown.settings
    .find((category) => category.category === "layout")
    ?.settings.map((setting) => setting.key);

const SELLER_NAME = "show_seller_name_of_share_article_in_share_for_member_on_page";

beforeEach(() => {
  for (const name of Object.keys(capabilities)) delete capabilities[name];
  shown.settings = [];
  farm.importsShareAmounts = false;
  farm.hasPurchases = true;
  farm.sellsToResellers = true;
});

describe("ConfigurationCommissioning logistics", () => {
  it("offers no packing mode, as it follows from how each share size is packed", () => {
    render(<ConfigurationCommissioning />);

    const logisticsKeys = shown.settings
      .find((category) => category.category === "logistics")
      ?.settings.map((setting) => setting.key);
    expect(logisticsKeys).not.toContain("packing_mode");
    expect(logisticsKeys).toContain("number_packing_stations");
  });
});

describe("ConfigurationCommissioning layout", () => {
  it("lets the office show or hide washing and cleaning", () => {
    render(<ConfigurationCommissioning />);

    expect(layoutKeys()).toEqual(expect.arrayContaining(["show_washing", "show_cleaning"]));
  });

  it("offers the seller's name in the members' boxes where members use jasmin's logins", () => {
    render(<ConfigurationCommissioning />);

    expect(layoutKeys()).toContain(SELLER_NAME);
  });

  it("leaves it out where a host handles the logins and members never see jasmin", () => {
    capabilities.user_accounts = false;
    render(<ConfigurationCommissioning />);

    expect(layoutKeys()).not.toContain(SELLER_NAME);
    expect(layoutKeys()).toContain("show_size_column");
  });

  it("leaves it out on a farm that buys nothing in, as there is no seller to name", () => {
    farm.hasPurchases = false;
    render(<ConfigurationCommissioning />);

    expect(layoutKeys()).not.toContain(SELLER_NAME);
    expect(layoutKeys()).toContain("show_size_column");
  });
});

describe("ConfigurationCommissioning tax rates", () => {
  const taxRateKeys = () =>
    shown.settings
      .find((category) => category.category === "tax_rates")
      ?.settings.map((setting) => setting.key);

  it("offers a default rate for articles, crates and shares", () => {
    render(<ConfigurationCommissioning />);

    expect(taxRateKeys()).toEqual([
      "default_tax_rate_articles",
      "default_tax_rate_crates",
      "default_tax_rate_shares",
    ]);
  });

  it("leaves out the shares' rate where the share amounts are imported", () => {
    farm.importsShareAmounts = true;
    render(<ConfigurationCommissioning />);

    expect(taxRateKeys()).toEqual(["default_tax_rate_articles", "default_tax_rate_crates"]);
  });

  it("leaves out the crates' rate on a farm that sells to no reseller", () => {
    farm.sellsToResellers = false;
    render(<ConfigurationCommissioning />);

    expect(taxRateKeys()).toEqual(["default_tax_rate_articles", "default_tax_rate_shares"]);
  });
});
