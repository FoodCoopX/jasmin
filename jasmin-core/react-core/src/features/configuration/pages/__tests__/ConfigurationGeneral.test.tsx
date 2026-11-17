// Configuration > General: the tenant language select offers only the two
// languages the backend accepts. The serializer constrains the column to
// ``LanguageChoices`` (en/de), so an option beyond those is one the user can
// pick and the save will then reject. The farm's address and VAT ID are
// offered wherever something prints them: its reseller documents, its legal
// notice or its data-protection pages.

import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Every mocked hook returns a STABLE reference. The page re-seeds its form
// state from a ``useEffect`` keyed on the tenant object, so a fresh object
// literal per render would re-fire that effect on its own setState and spin
// forever (the real TenantContext memoizes its value).
const stable = vi.hoisted(() => {
  const translation = {
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  };
  // The tenant's settings, per test; a key left out falls through to the
  // caller's default.
  const settings: Record<string, unknown> = {};
  const tenant = {
    tenant: { id: "tenant-1", name: "Test Farm", tenant_language: "de" },
    refreshTenant: () => Promise.resolve(),
    getSetting: (key: string, fallback?: unknown) =>
      key in settings ? settings[key] : fallback,
  };
  const autoSave = {
    hasChanges: false,
    saving: false,
    markChanged: () => {},
  };
  const pictureUpload = { uploading: false, uploadPicture: () => {} };
  // What the deployment offers; a name left out is offered.
  const capabilities: Record<string, boolean> = {};
  return { translation, settings, tenant, autoSave, pictureUpload, capabilities };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => stable.translation,
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@hooks/index", () => ({
  useTenant: () => stable.tenant,
  useAutoSave: () => stable.autoSave,
  useCapability: (name: string) => stable.capabilities[name] ?? true,
}));

vi.mock("@shared/api/generated/tenants/tenants", () => ({
  tenantsTenantsPartialUpdate: vi.fn(),
}));

vi.mock("@shared/ui", () => ({
  AutoSaveIndicator: () => null,
  PictureUploadField: () => null,
  usePictureUpload: () => stable.pictureUpload,
}));

vi.mock("@shared/utils", () => ({
  notify: { success: vi.fn(), error: vi.fn() },
}));

import ConfigurationGeneral from "../ConfigurationGeneral";

/** The renderer puts the label and the Select in one wrapper div. The label
 *  text sits in a <strong> inside AntD's <Text> span, so reach the wrapper by
 *  the nearest enclosing div rather than a single parentElement hop. */
function languageSelect(): HTMLElement {
  const label = screen.getByText("tenant.organization.tenant_language");
  return within(label.closest("div") as HTMLElement).getByRole("combobox");
}

describe("ConfigurationGeneral tenant language", () => {
  it("offers only the languages the backend accepts", async () => {
    const user = userEvent.setup();
    render(<ConfigurationGeneral />);

    // The options only exist in the DOM once the dropdown is open, so this
    // click is what lets the assertion see an extra option at all.
    await user.click(languageSelect());

    const dropdown = await screen.findByRole("listbox");
    const options = Array.from(
      (dropdown.closest(".ant-select-dropdown") ?? dropdown).querySelectorAll(
        ".ant-select-item-option-content",
      ),
    ).map((option) => option.textContent);

    expect(options).toEqual(["Deutsch (DE)", "English (EN)"]);
  });
});

describe("ConfigurationGeneral by what the farm does", () => {
  const ORDER_EMAIL = "tenant.email_for_orders";
  const FISCAL_YEAR = "tenant.organization.fiscal_year_start_month";

  beforeEach(() => {
    for (const key of Object.keys(stable.settings)) delete stable.settings[key];
  });

  it("offers the order email and the start of the fiscal year by default", () => {
    render(<ConfigurationGeneral />);

    expect(screen.getByText(ORDER_EMAIL)).toBeInTheDocument();
    expect(screen.getByText(FISCAL_YEAR)).toBeInTheDocument();
  });

  it("leaves out the order email where the farm sells to no reseller", () => {
    stable.settings.sells_to_resellers = false;
    render(<ConfigurationGeneral />);

    expect(screen.queryByText(ORDER_EMAIL)).not.toBeInTheDocument();
    expect(screen.getByText("tenant.email")).toBeInTheDocument();
  });

  it("offers the start of the fiscal year without the economics module, as the dashboards and statistics count from it", () => {
    stable.settings["navigation.show_economics"] = false;
    render(<ConfigurationGeneral />);

    expect(screen.getByText(FISCAL_YEAR)).toBeInTheDocument();
  });
});

describe("ConfigurationGeneral inside a host application", () => {
  beforeEach(() => {
    for (const name of Object.keys(stable.capabilities)) {
      delete stable.capabilities[name];
    }
  });

  it("offers the legal notice and the app icon on its own", () => {
    render(<ConfigurationGeneral />);

    expect(screen.getByText("tenant.legal_notice.title")).toBeInTheDocument();
    expect(screen.getByText("tenant.files.current_app_icon")).toBeInTheDocument();
  });

  it("leaves out the legal notice where the host publishes its own", () => {
    stable.capabilities.legal_notice = false;
    render(<ConfigurationGeneral />);

    expect(screen.queryByText("tenant.legal_notice.title")).not.toBeInTheDocument();
    expect(screen.getByText("tenant.basic_info.title")).toBeInTheDocument();
  });

  describe("the farm's address and VAT ID", () => {
    const ADDRESS_AND_VAT_ID = [
      "tenant.address.address",
      "tenant.address.zip_code",
      "tenant.address.city",
      "tenant.address.country",
      "tenant.organization.uid",
    ];
    const shown = () =>
      ADDRESS_AND_VAT_ID.filter((label) => screen.queryByText(label) !== null);

    beforeEach(() => {
      for (const key of Object.keys(stable.settings)) delete stable.settings[key];
    });

    it("are offered on its own, for the legal notice and the data-protection pages", () => {
      stable.settings.sells_to_resellers = false;
      render(<ConfigurationGeneral />);

      expect(shown()).toEqual(ADDRESS_AND_VAT_ID);
    });

    it("are left out where the host publishes those pages and the farm sells to no reseller", () => {
      stable.capabilities.legal_notice = false;
      stable.capabilities.gdpr = false;
      stable.settings.sells_to_resellers = false;
      render(<ConfigurationGeneral />);

      expect(shown()).toEqual([]);
      // The station sheets print the farm's contact details.
      expect(screen.getByText("tenant.email")).toBeInTheDocument();
      expect(screen.getByText("tenant.phone_number")).toBeInTheDocument();
    });

    it("are offered there to a farm that sells to resellers, for its documents", () => {
      stable.capabilities.legal_notice = false;
      stable.capabilities.gdpr = false;
      render(<ConfigurationGeneral />);

      expect(shown()).toEqual(ADDRESS_AND_VAT_ID);
    });
  });

  it("offers no description of the farm", () => {
    render(<ConfigurationGeneral />);

    expect(screen.queryByText("tenant.basic_info.description")).not.toBeInTheDocument();
    expect(screen.getByText("tenant.basic_info.name")).toBeInTheDocument();
  });

  it("leaves out the app icon and short name where jasmin isn't installed as an app", () => {
    stable.capabilities.web_app = false;
    render(<ConfigurationGeneral />);

    expect(
      screen.queryByText("tenant.files.current_app_icon"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("tenant.files.current_bio_logo")).toBeInTheDocument();
  });
});
