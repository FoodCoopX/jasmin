import { render, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { label?: string }) =>
      options?.label !== undefined ? `${key}(${options.label})` : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const catalogue = vi.hoisted(() => ({
  shareTypes: [] as Array<Record<string, unknown>>,
}));
vi.mock("@hooks/index", () => ({
  useShareTypes: () => ({ shareTypes: catalogue.shareTypes }),
}));

import type { RoleGatedItem } from "@shared/auth";
import { usePlanningNavItems } from "../usePlanningNavItems";

/** A share type active since long ago, so today's date governs it. */
function shareType(fields: Record<string, unknown>) {
  return { valid_from: "2020-01-06", valid_until: null, ...fields };
}

/** The text a link shows; the label is a <Link>, so it renders in a router. */
function labelOf(item: RoleGatedItem): string {
  const { container } = render(
    <MemoryRouter>{item.label as React.ReactNode}</MemoryRouter>,
  );
  const text = container.textContent ?? "";
  container.remove();
  return text;
}

beforeEach(() => {
  catalogue.shareTypes = [];
});

describe("usePlanningNavItems", () => {
  it("names a complex option's two links after its share type", () => {
    catalogue.shareTypes = [
      shareType({
        share_option: "HARVEST_SHARE",
        needs_complex_planning: true,
        name: "Gemüsekiste",
      }),
    ];
    const { result } = renderHook(() => usePlanningNavItems());

    expect(result.current.planningComplexItems.map(labelOf)).toEqual([
      "Gemüsekiste",
    ]);
    expect(result.current.planningLongTermItems.map(labelOf)).toEqual([
      "commissioning.long_term_planning_of(Gemüsekiste)",
    ]);
  });

  it("names an additional option's link after its share type", () => {
    catalogue.shareTypes = [
      shareType({
        share_option: "CHICKEN_SHARE",
        needs_complex_planning: false,
        name: "Eier",
      }),
    ];
    const { result } = renderHook(() => usePlanningNavItems());

    expect(result.current.additionalLongTermItems.map(labelOf)).toEqual([
      "Eier",
    ]);
    expect(result.current.planningComplexItems).toEqual([]);
  });

  it("keeps the translated names for a share type without a name", () => {
    catalogue.shareTypes = [
      shareType({
        share_option: "HARVEST_SHARE",
        needs_complex_planning: true,
        name: null,
      }),
    ];
    const { result } = renderHook(() => usePlanningNavItems());

    expect(result.current.planningComplexItems.map(labelOf)).toEqual([
      "commissioning.harvest_shares_veg",
    ]);
    expect(result.current.planningLongTermItems.map(labelOf)).toEqual([
      "commissioning.planning_longterm_harvest_shares_veg_only",
    ]);
  });

  it("takes the name of the share type governing today, not of its successor", () => {
    catalogue.shareTypes = [
      shareType({
        share_option: "HARVEST_SHARE",
        needs_complex_planning: true,
        name: "Gemüse 2025",
        valid_until: "2999-12-26",
      }),
      shareType({
        share_option: "HARVEST_SHARE",
        needs_complex_planning: true,
        name: "Gemüse später",
        valid_from: "3000-01-03",
      }),
    ];
    const { result } = renderHook(() => usePlanningNavItems());

    expect(result.current.planningComplexItems.map(labelOf)).toEqual([
      "Gemüse 2025",
    ]);
  });
});
