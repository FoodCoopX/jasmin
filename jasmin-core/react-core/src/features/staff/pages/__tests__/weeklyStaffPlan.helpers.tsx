/**
 * The weekly plan's test fixtures, the page rendered as the app does, and ways
 * to read and drive its grid as the office does.
 */
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

import type {
  WeeklyPlanAssignmentRequest,
  WeeklyPlanEmployee,
  WeeklyPlanGrid,
} from "@shared/api/generated/models";

import WeeklyStaffPlan from "../WeeklyStaffPlan";

// ── Fixtures ────────────────────────────────────────────────────────────────

export const ANNA: WeeklyPlanEmployee = {
  id: "emp-anna",
  short_name_for_weekly_plan: "Anna",
  first_name: "Anna",
  last_name: "Berger",
  is_active: true,
  hours_per_week: null,
  absent_days: [],
};
export const BEN: WeeklyPlanEmployee = {
  id: "emp-ben",
  short_name_for_weekly_plan: "Ben",
  first_name: "Ben",
  last_name: "Kraus",
  is_active: true,
  hours_per_week: null,
  absent_days: [],
};
/** Deactivated, but still holding a shift in the week served with her. */
export const CLARA: WeeklyPlanEmployee = {
  id: "emp-clara",
  short_name_for_weekly_plan: "Clara",
  first_name: "Clara",
  last_name: "Vogt",
  is_active: false,
  hours_per_week: null,
  absent_days: [],
};

export const HARVEST = { id: "cat-harvest", name: "Harvest", max_lines: 2 };
export const PACKING = { id: "cat-packing", name: "Packing", max_lines: 1 };

export const MONDAY = 0;
export const TUESDAY = 1;
export const WEDNESDAY = 2;
export const FRIDAY = 4;
export const SATURDAY = 5;

/** Anna on Monday and Ben on Wednesday, both on the first Harvest line. */
export const PLANNED: WeeklyPlanAssignmentRequest[] = [
  { category_id: HARVEST.id, row_index: 0, day: MONDAY, employee_id: ANNA.id },
  { category_id: HARVEST.id, row_index: 0, day: WEDNESDAY, employee_id: BEN.id },
];

/** A grid as the backend serves it: every line of every active category, a
 *  cell per weekday holding an employee id or null. */
export function weekGrid({
  year = 2026,
  week = 41,
  assignments = [] as WeeklyPlanAssignmentRequest[],
  categories = [HARVEST, PACKING],
  employees = [ANNA, BEN],
} = {}): WeeklyPlanGrid {
  return {
    year,
    week,
    employees,
    categories: categories.map((category) => ({
      ...category,
      rows: Array.from({ length: category.max_lines }, (_, rowIndex) => ({
        row_index: rowIndex,
        days: Object.fromEntries(
          [0, 1, 2, 3, 4, 5, 6].map((day) => [
            String(day),
            assignments.find(
              (assignment) =>
                assignment.category_id === category.id &&
                assignment.row_index === rowIndex &&
                assignment.day === day,
            )?.employee_id ?? null,
          ]),
        ),
      })),
    })),
  };
}

export function apiError(status: number, body: Record<string, unknown>) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, data: body },
  };
}

// ── The page ────────────────────────────────────────────────────────────────

// Stands in for antd's toast functions, which would otherwise render into the
// document body.
export const noToast = () => undefined as never;

// The app's toast for a failed mutation, unless it sets `meta: { silent: true }`.
export const appToast = vi.fn();

export function renderPlan() {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (!mutation.meta?.silent) appToast(error);
      },
    }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <WeeklyStaffPlan />
    </QueryClientProvider>,
  );
  return { user };
}

// ── The grid ────────────────────────────────────────────────────────────────

/** The `<td>` of a grid cell. `line` is the 1-based line number the grid
 *  shows; `day` counts from Monday = 0. */
export function gridCell(
  category: string,
  line: number,
  day: number,
): HTMLElement {
  const group = screen.getByText(category, { selector: "th" }).closest("tbody");
  if (!group) throw new Error(`No grid group for category ${category}`);
  const row = within(group).getAllByRole("row")[line];
  return within(row).getAllByRole("cell")[day];
}

/** The cell's main button: picks up its occupant, or places what is held. */
export function cellButton(category: string, line: number, day: number) {
  return within(gridCell(category, line, day)).getAllByRole("button")[0];
}

export function removeButton(category: string, line: number, day: number) {
  return within(gridCell(category, line, day)).getByRole("button", {
    name: "staff.remove_employee",
  });
}

export function paletteChip(name: string) {
  return screen.getByRole("button", { name: `${name}. staff.times_planned` });
}

/** Moves the copy source one week back from the preselected one. AntD's
 *  Select reads the legacy `which` key code, which user-event leaves unset, so
 *  the keys go in through fireEvent. */
export async function pickEarlierSourceWeek(
  user: ReturnType<typeof userEvent.setup>,
) {
  const sourcePicker = screen.getByRole("combobox", {
    name: "staff.copy_weekly_plan_from",
  });
  await user.click(sourcePicker);
  fireEvent.keyDown(sourcePicker, { key: "ArrowUp", keyCode: 38, which: 38 });
  fireEvent.keyDown(sourcePicker, { key: "Enter", keyCode: 13, which: 13 });
}

const byCell = (a: WeeklyPlanAssignmentRequest, b: WeeklyPlanAssignmentRequest) =>
  a.category_id.localeCompare(b.category_id) ||
  a.row_index - b.row_index ||
  a.day - b.day;

export function sortedAssignments(...assignments: WeeklyPlanAssignmentRequest[]) {
  return [...assignments].sort(byCell);
}
