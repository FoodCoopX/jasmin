/**
 * BoxCombinationLabel: a packed box as its base size with one superscript per
 * add-on (share type short name and size), every size translated.
 */

import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import BoxCombinationLabel from "../BoxCombinationLabel";

const parts = (container: HTMLElement) => ({
  base: container.querySelector(".box-combo__base")?.textContent,
  addOns: Array.from(container.querySelectorAll("sup.box-combo__addon")).map(
    (addOn) => addOn.textContent,
  ),
});

describe("BoxCombinationLabel", () => {
  it("shows the base size followed by each add-on's short name and size", () => {
    const { container } = render(
      <BoxCombinationLabel
        baseSize="M"
        addOns={[
          { share_type_short_name: "HONEY", size: "ONE_SIZE" },
          { share_type_short_name: "BREAD", size: "L" },
        ]}
      />,
    );

    expect(parts(container)).toEqual({
      base: "commissioning.M",
      addOns: ["HONEY·commissioning.ONE_SIZE", "BREAD·commissioning.L"],
    });
  });

  it("keeps two identical add-ons as two badges", () => {
    const { container } = render(
      <BoxCombinationLabel
        baseSize="S"
        addOns={[
          { share_type_short_name: "EGGS", size: "HALF" },
          { share_type_short_name: "EGGS", size: "HALF" },
        ]}
      />,
    );

    expect(parts(container).addOns).toEqual([
      "EGGS·commissioning.HALF",
      "EGGS·commissioning.HALF",
    ]);
  });

  it("shows the given label, or a dash, for add-ons packed without a base box", () => {
    const addOns = [{ share_type_short_name: "BREAD", size: "M" }];

    const labelled = render(
      <BoxCombinationLabel baseSize={null} addOns={addOns} noBaseLabel="Add-ons only" />,
    );
    expect(parts(labelled.container).base).toBe("Add-ons only");
    labelled.unmount();

    const { container } = render(<BoxCombinationLabel baseSize={null} addOns={addOns} />);
    expect(parts(container)).toEqual({ base: "—", addOns: ["BREAD·commissioning.M"] });
  });
});
