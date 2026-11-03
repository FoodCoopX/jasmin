// Configuration > General: the tenant language select offers only the two
// languages the backend accepts. The serializer constrains the column to
// ``LanguageChoices`` (en/de), so an option beyond those is one the user can
// pick and the save will then reject.

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
  const tenant = {
    tenant: { id: "tenant-1", name: "Test Farm", tenant_language: "de" },
    refreshTenant: () => Promise.resolve(),
  };
  const autoSave = {
    hasChanges: false,
    saving: false,
    markChanged: () => {},
  };
  const pictureUpload = { uploading: false, uploadPicture: () => {} };
  // What the deployment offers; a name left out is offered.
  const capabilities: Record<string, boolean> = {};
  return { translation, tenant, autoSave, pictureUpload, capabilities };
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

  it("leaves out the app icon and short name where jasmin isn't installed as an app", () => {
    stable.capabilities.web_app = false;
    render(<ConfigurationGeneral />);

    expect(
      screen.queryByText("tenant.files.current_app_icon"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("tenant.files.current_bio_logo")).toBeInTheDocument();
  });
});
