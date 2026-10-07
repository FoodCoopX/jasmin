/**
 * SettingsRenderer's number settings: shown and typed in the tenant's number
 * format and named by their label. A decimal setting (a tax rate, a
 * percentage) takes "." or "," as the decimal mark; a whole-number setting
 * takes digits only. The tenant sets no number format, so numbers are written
 * the German way, with a decimal comma.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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

// The number fields read the tenant's number format straight from useTenant.
vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock();
  return { useTenant: () => tenant };
});

import { SettingsRenderer } from "../SettingsRenderer";
import type { SettingConfig } from "../SettingsRenderer";

const TAX_RATE: SettingConfig = {
  key: "default_tax_rate",
  label: "Tax rate",
  type: "number",
  step: 0.01,
  precision: 2,
  min: 0,
  max: 100,
};
const JOKERS: SettingConfig = {
  key: "amount_of_jokers",
  label: "Jokers",
  type: "number",
  min: 0,
};

/** One setting as a settings page renders it, holding what it is changed to. */
function Setting({
  setting,
  initial = null,
  onChange = () => {},
}: {
  setting: SettingConfig;
  initial?: unknown;
  onChange?: (value: unknown) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      {SettingsRenderer.renderInput(setting, value, (next) => {
        setValue(next);
        onChange(next);
      })}
    </>
  );
}

describe("SettingsRenderer number settings", () => {
  it("shows a number setting in the tenant's format, named by its label", () => {
    render(<Setting setting={TAX_RATE} initial={19.5} />);

    expect(screen.getByRole("spinbutton", { name: "Tax rate" })).toHaveValue(
      "19,50",
    );
  });

  it("reads a decimal comma or point in a decimal setting and lets neither into a whole-number one", async () => {
    const user = userEvent.setup();
    const onTaxRate = vi.fn();
    const onJokers = vi.fn();
    render(
      <>
        <Setting setting={TAX_RATE} onChange={onTaxRate} />
        <Setting setting={JOKERS} onChange={onJokers} />
      </>,
    );
    const taxRate = screen.getByRole("spinbutton", { name: "Tax rate" });
    const jokers = screen.getByRole("spinbutton", { name: "Jokers" });

    await user.type(taxRate, "7,5");
    expect(onTaxRate).toHaveBeenLastCalledWith(7.5);
    await user.clear(taxRate);
    await user.type(taxRate, "7.25");
    expect(onTaxRate).toHaveBeenLastCalledWith(7.25);

    await user.type(jokers, "3,5");
    expect(jokers).toHaveValue("35");
    await user.clear(jokers);
    await user.type(jokers, "3.5");
    expect(jokers).toHaveValue("35");
    expect(onJokers).toHaveBeenLastCalledWith(35);
  });
});
