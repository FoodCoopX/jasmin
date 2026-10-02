import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@shared/ui", () => ({
  PictureUploadField: () => <div data-testid="app-icon-upload" />,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { AppIconSettings } from "../AppIconSettings";

function renderSettings(shortName: string, onShortNameChange = vi.fn()) {
  render(
    <AppIconSettings
      iconUrl={null}
      iconUploading={false}
      onIconUpload={vi.fn()}
      shortName={shortName}
      onShortNameChange={onShortNameChange}
      tenantName="Solidarische Landwirtschaft Leipzig"
    />,
  );
  return screen.getByLabelText("tenant.files.app_short_name");
}

describe("AppIconSettings", () => {
  it("caps the short name at 12 characters and suggests the fallback", () => {
    const input = renderSettings("");

    expect(input).toHaveAttribute("maxlength", "12");
    // Left empty, installs show the name's first 12 characters.
    expect(input).toHaveAttribute("placeholder", "Solidarische");
    expect(screen.getByTestId("app-icon-upload")).toBeInTheDocument();
  });

  it("reports an edited short name", () => {
    const onShortNameChange = vi.fn();
    const input = renderSettings("Gemüse", onShortNameChange);

    fireEvent.change(input, { target: { value: "Gemüsehof" } });

    expect(onShortNameChange).toHaveBeenCalledWith("Gemüsehof");
  });
});
