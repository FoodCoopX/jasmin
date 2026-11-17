/**
 * The weekly plan's palette: each active employee as a chip, with how often
 * they are planned and, where the office set weekly hours, the hours planned
 * against them.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { WeeklyPlanEmployee } from "@shared/api/generated/models";
import { DndGrid } from "@shared/ui";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: unknown) =>
      values && typeof values === "object"
        ? `${key} ${JSON.stringify(values)}`
        : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import WeeklyPlanPalette from "../WeeklyPlanPalette";

const employee = (
  id: string,
  hours_per_week: number | null,
): WeeklyPlanEmployee => ({
  id,
  short_name_for_weekly_plan: id,
  first_name: id,
  last_name: null,
  is_active: true,
  hours_per_week,
  absent_days: [],
});

function renderPalette(
  employees: WeeklyPlanEmployee[],
  counts: Record<string, number>,
) {
  render(
    <DndGrid onPlace={vi.fn()}>
      <WeeklyPlanPalette
        employees={employees}
        planCountByEmployee={new Map(Object.entries(counts))}
        colorMap={new Map()}
        canDrag
        everyoneAbsent={false}
      />
    </DndGrid>,
  );
}

const hoursOf = (planned: number, target: number) =>
  screen.getByText(`staff.hours_of ${JSON.stringify({ planned, target })}`);

describe("WeeklyPlanPalette hours", () => {
  it("shows the hours planned against the weekly hours, green when they match", () => {
    renderPalette([employee("Anna", 24), employee("Ben", 20)], {
      Anna: 3,
      Ben: 2,
    });

    expect(hoursOf(24, 24)).toHaveClass("weekly-plan-hours--met");
    expect(hoursOf(16, 20)).toHaveClass("weekly-plan-hours--off");
  });

  it("is red above the weekly hours as well", () => {
    renderPalette([employee("Anna", 16)], { Anna: 3 });

    expect(hoursOf(24, 16)).toHaveClass("weekly-plan-hours--off");
  });

  it("names the hours to a screen reader too", () => {
    renderPalette([employee("Anna", 24)], { Anna: 1 });

    expect(
      screen.getByRole("button", {
        name: /staff\.hours_planned \{"planned":8,"target":24\}/,
      }),
    ).toBeInTheDocument();
  });

  it("shows no hours for an employee without weekly hours", () => {
    renderPalette([employee("Clara", null)], { Clara: 2 });

    expect(screen.queryByText(/staff\.hours_of/)).not.toBeInTheDocument();
  });
});
