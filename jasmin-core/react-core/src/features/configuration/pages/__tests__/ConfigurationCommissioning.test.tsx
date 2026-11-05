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
vi.mock("@hooks/index", () => ({
  useCapability: (name: string) => capabilities[name] ?? true,
}));

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
});
