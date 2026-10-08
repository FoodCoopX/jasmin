// The weekly staff plan: a week grid (category lines × weekdays) filled from a
// palette of employee chips. The generated staff client is replaced by real
// TanStack hooks around spies, so the page's own query keys, invalidation and
// mutation wiring run as in the app while every request is observable. The
// drag-and-drop kit stays real; its click "pick up, then place" path stands in
// for a mouse drag.

import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import type { UseMutationOptions } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { message } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  StaffWeeklyPlanGridRetrieveParams,
  WeeklyPlanAssignment,
  WeeklyPlanCopy,
  WeeklyPlanEmployee,
  WeeklyPlanGrid,
  WeeklyPlanReplace,
} from "@shared/api/generated/models";
import deErrors from "@shared/i18n/locales/de/errors.json";
import { flushMicrotasks, profileRenders } from "@/test/profileRenders";

// ── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// The signed-in user's roles; `useRoles` derives the office gate from them.
const auth = vi.hoisted(() => ({ roles: ["office"] as string[] }));
vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1", roles: auth.roles } }),
}));

vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock({
    tenant: { id: "tenant-1", created_at: "2023-02-01T09:00:00Z" },
  });
  return { useTenant: () => tenant };
});

const staffApi = vi.hoisted(() => ({
  fetchGrid: vi.fn(),
  replaceWeek: vi.fn(),
  copyWeek: vi.fn(),
}));

vi.mock("@shared/api/generated/staff/staff", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@shared/api/generated/staff/staff")>();
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  return {
    ...actual,
    useStaffWeeklyPlanGridRetrieve: (
      params: StaffWeeklyPlanGridRetrieveParams,
      options?: { query?: { enabled?: boolean } },
    ) =>
      useQuery({
        queryKey: actual.getStaffWeeklyPlanGridRetrieveQueryKey(params),
        queryFn: (): Promise<WeeklyPlanGrid> => staffApi.fetchGrid(params),
        ...options?.query,
      }),
    useStaffWeeklyPlanCreate: (options?: {
      mutation?: UseMutationOptions<
        WeeklyPlanGrid,
        unknown,
        { data: WeeklyPlanReplace }
      >;
    }) =>
      useMutation({
        ...options?.mutation,
        mutationFn: ({ data }: { data: WeeklyPlanReplace }) =>
          staffApi.replaceWeek(data) as Promise<WeeklyPlanGrid>,
      }),
    useStaffWeeklyPlanCopyCreate: (options?: {
      mutation?: UseMutationOptions<
        WeeklyPlanGrid,
        unknown,
        { data: WeeklyPlanCopy }
      >;
    }) =>
      useMutation({
        ...options?.mutation,
        mutationFn: ({ data }: { data: WeeklyPlanCopy }) =>
          staffApi.copyWeek(data) as Promise<WeeklyPlanGrid>,
      }),
  };
});

import WeeklyStaffPlan from "../WeeklyStaffPlan";

// ── Fixtures ────────────────────────────────────────────────────────────────

const ANNA: WeeklyPlanEmployee = {
  id: "emp-anna",
  short_name_for_weekly_plan: "Anna",
  first_name: "Anna",
  last_name: "Berger",
  is_active: true,
};
const BEN: WeeklyPlanEmployee = {
  id: "emp-ben",
  short_name_for_weekly_plan: "Ben",
  first_name: "Ben",
  last_name: "Kraus",
  is_active: true,
};
/** Deactivated, but still holding a shift in the week served with her. */
const CLARA: WeeklyPlanEmployee = {
  id: "emp-clara",
  short_name_for_weekly_plan: "Clara",
  first_name: "Clara",
  last_name: "Vogt",
  is_active: false,
};

const HARVEST = { id: "cat-harvest", name: "Harvest", max_lines: 2 };
const PACKING = { id: "cat-packing", name: "Packing", max_lines: 1 };

const MONDAY = 0;
const TUESDAY = 1;
const WEDNESDAY = 2;
const FRIDAY = 4;

/** Anna on Monday and Ben on Wednesday, both on the first Harvest line. */
const PLANNED: WeeklyPlanAssignment[] = [
  { category_id: HARVEST.id, row_index: 0, day: MONDAY, employee_id: ANNA.id },
  { category_id: HARVEST.id, row_index: 0, day: WEDNESDAY, employee_id: BEN.id },
];

/** A grid as the backend serves it: every line of every active category, a
 *  cell per weekday holding an employee id or null. */
function weekGrid({
  year = 2026,
  week = 41,
  assignments = [] as WeeklyPlanAssignment[],
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

function apiError(status: number, body: Record<string, unknown>) {
  return {
    isAxiosError: true,
    message: `Request failed with status code ${status}`,
    response: { status, data: body },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderPlan() {
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

/** The `<td>` of a grid cell. `line` is the 1-based line number the grid
 *  shows; `day` counts from Monday = 0. */
function gridCell(category: string, line: number, day: number): HTMLElement {
  const group = screen.getByText(category, { selector: "th" }).closest("tbody");
  if (!group) throw new Error(`No grid group for category ${category}`);
  const row = within(group).getAllByRole("row")[line];
  return within(row).getAllByRole("cell")[day];
}

/** The cell's main button: picks up its occupant, or places what is held. */
function cellButton(category: string, line: number, day: number) {
  return within(gridCell(category, line, day)).getAllByRole("button")[0];
}

function removeButton(category: string, line: number, day: number) {
  return within(gridCell(category, line, day)).getByRole("button", {
    name: "staff.remove_employee",
  });
}

function paletteChip(name: string) {
  return screen.getByRole("button", { name: `${name}. staff.times_planned` });
}

/** Moves the copy source one week back from the preselected one. AntD's
 *  Select reads the legacy `which` key code, which user-event leaves unset, so
 *  the keys go in through fireEvent. */
async function pickEarlierSourceWeek(user: ReturnType<typeof userEvent.setup>) {
  const sourcePicker = screen.getByRole("combobox", {
    name: "staff.copy_weekly_plan_from",
  });
  await user.click(sourcePicker);
  fireEvent.keyDown(sourcePicker, { key: "ArrowUp", keyCode: 38, which: 38 });
  fireEvent.keyDown(sourcePicker, { key: "Enter", keyCode: 13, which: 13 });
}

const byCell = (a: WeeklyPlanAssignment, b: WeeklyPlanAssignment) =>
  a.category_id.localeCompare(b.category_id) ||
  a.row_index - b.row_index ||
  a.day - b.day;

/** The week the page saved last, its assignments in a stable order. */
function lastSavedWeek(): WeeklyPlanReplace {
  const calls = staffApi.replaceWeek.mock.calls;
  if (calls.length === 0) throw new Error("The week was never saved");
  const saved = calls[calls.length - 1][0] as WeeklyPlanReplace;
  return { ...saved, assignments: [...saved.assignments].sort(byCell) };
}

function sortedAssignments(...assignments: WeeklyPlanAssignment[]) {
  return [...assignments].sort(byCell);
}

// Stands in for antd's toast functions, which would otherwise render into the
// document body.
const noToast = () => undefined as never;

// The app's toast for a failed mutation, unless it sets `meta: { silent: true }`.
const appToast = vi.fn();

beforeEach(() => {
  // A Monday in ISO week 41 of 2026; the page opens on "now".
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 5, 12));
  auth.roles = ["office"];
  appToast.mockReset();
  staffApi.fetchGrid
    .mockReset()
    .mockImplementation(async (params: StaffWeeklyPlanGridRetrieveParams) =>
      weekGrid({ ...params, assignments: PLANNED }),
    );
  staffApi.replaceWeek
    .mockReset()
    .mockImplementation(async (data: WeeklyPlanReplace) =>
      weekGrid({ ...data }),
    );
  staffApi.copyWeek.mockReset().mockResolvedValue(weekGrid());
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("WeeklyStaffPlan render-loop smoke", () => {
  it("settles after mounting instead of re-rendering in a loop", async () => {
    const profiler = profileRenders();
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false, gcTime: 0 } },
          })
        }
      >
        {profiler.wrap(<WeeklyStaffPlan />, "weekly-staff-plan")}
      </QueryClientProvider>,
    );
    await screen.findByText("Harvest", { selector: "th" });
    await flushMicrotasks(50);
    expect(profiler.onRender.mock.calls.length).toBeLessThan(80);
  });
});

describe("WeeklyStaffPlan week selection", () => {
  it("requests the grid of the current ISO week", async () => {
    renderPlan();

    await screen.findByText("Harvest", { selector: "th" });
    expect(staffApi.fetchGrid).toHaveBeenCalledTimes(1);
    expect(staffApi.fetchGrid).toHaveBeenCalledWith({ year: 2026, week: 41 });
  });

  it("opens on the ISO week-year in the days around new year", async () => {
    // Friday 1 January 2027 still belongs to ISO week 53 of 2026.
    vi.setSystemTime(new Date(2027, 0, 1, 12));
    renderPlan();

    await screen.findByText("Harvest", { selector: "th" });
    expect(staffApi.fetchGrid).toHaveBeenCalledWith({ year: 2026, week: 53 });
  });

  it("requests the neighbouring weeks when the week arrows are used", async () => {
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(screen.getByRole("button", { name: "common.next" }));
    await waitFor(() =>
      expect(staffApi.fetchGrid).toHaveBeenLastCalledWith({
        year: 2026,
        week: 42,
      }),
    );

    await user.click(screen.getByRole("button", { name: "common.previous" }));
    await user.click(screen.getByRole("button", { name: "common.previous" }));
    await waitFor(() =>
      expect(staffApi.fetchGrid).toHaveBeenLastCalledWith({
        year: 2026,
        week: 40,
      }),
    );
  });

  it("continues with week 1 of the next year after the last week", async () => {
    // Monday 28 December 2026 opens ISO week 53, the last of 2026.
    vi.setSystemTime(new Date(2026, 11, 28, 12));
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(screen.getByRole("button", { name: "common.next" }));

    await waitFor(() =>
      expect(staffApi.fetchGrid).toHaveBeenLastCalledWith({
        year: 2027,
        week: 1,
      }),
    );
  });

  it("shows the plan of the newly selected week", async () => {
    staffApi.fetchGrid.mockImplementation(
      async (params: StaffWeeklyPlanGridRetrieveParams) =>
        weekGrid({
          ...params,
          assignments:
            params.week === 42
              ? [
                  {
                    category_id: PACKING.id,
                    row_index: 0,
                    day: FRIDAY,
                    employee_id: ANNA.id,
                  },
                ]
              : PLANNED,
        }),
    );
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });
    expect(cellButton("Harvest", 1, MONDAY)).toHaveTextContent("Anna");

    await user.click(screen.getByRole("button", { name: "common.next" }));

    await waitFor(() =>
      expect(cellButton("Packing", 1, FRIDAY)).toHaveTextContent("Anna"),
    );
    expect(cellButton("Harvest", 1, MONDAY)).not.toHaveTextContent("Anna");
    expect(cellButton("Harvest", 1, WEDNESDAY)).not.toHaveTextContent("Ben");
  });
});

describe("WeeklyStaffPlan grid", () => {
  it("shows a loading hint until the week has arrived", async () => {
    let deliver: (grid: WeeklyPlanGrid) => void = () => {};
    staffApi.fetchGrid.mockImplementation(
      () =>
        new Promise<WeeklyPlanGrid>((resolve) => {
          deliver = resolve;
        }),
    );
    renderPlan();

    expect(await screen.findByText("common.loading")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("staff.no_categories")).not.toBeInTheDocument();

    deliver(weekGrid({ assignments: PLANNED }));

    expect(
      await screen.findByText("Harvest", { selector: "th" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("common.loading")).not.toBeInTheDocument();
  });

  it("asks for categories first when no weekly-plan category is active", async () => {
    staffApi.fetchGrid.mockImplementation(
      async (params: StaffWeeklyPlanGridRetrieveParams) =>
        weekGrid({ ...params, categories: [] }),
    );
    renderPlan();

    await waitFor(() =>
      expect(screen.queryByText("common.loading")).not.toBeInTheDocument(),
    );
    expect(staffApi.fetchGrid).toHaveBeenCalledTimes(1);
    expect(screen.getByText("staff.no_categories")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("asks for employees first when none is active, but still shows the grid", async () => {
    staffApi.fetchGrid.mockImplementation(
      async (params: StaffWeeklyPlanGridRetrieveParams) =>
        weekGrid({ ...params, employees: [] }),
    );
    renderPlan();

    await screen.findByText("Harvest", { selector: "th" });
    expect(screen.getByText("staff.no_employees")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("lays out every line of each category with the planned employees in place", async () => {
    renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      expect(
        screen.getByRole("columnheader", {
          name: `commissioning.weekdays.${day}`,
        }),
      ).toBeInTheDocument();
    }
    const lineNumbers = (category: string) => {
      const group = screen
        .getByText(category, { selector: "th" })
        .closest("tbody") as HTMLElement;
      return within(group)
        .getAllByRole("rowheader")
        .map((header) => header.textContent);
    };
    expect(lineNumbers("Harvest")).toEqual(["1", "2"]);
    expect(lineNumbers("Packing")).toEqual(["1"]);

    expect(cellButton("Harvest", 1, MONDAY)).toHaveTextContent("Anna");
    expect(cellButton("Harvest", 1, WEDNESDAY)).toHaveTextContent("Ben");
    expect(cellButton("Harvest", 2, MONDAY)).toHaveTextContent(
      "staff.drop_employee_here",
    );
    expect(cellButton("Packing", 1, FRIDAY)).toHaveTextContent(
      "staff.drop_employee_here",
    );
  });

  it("shows a deactivated employee's shift but leaves them out of the palette", async () => {
    staffApi.fetchGrid.mockImplementation(
      async (params: StaffWeeklyPlanGridRetrieveParams) =>
        weekGrid({
          ...params,
          employees: [ANNA, BEN, CLARA],
          assignments: [
            ...PLANNED,
            {
              category_id: PACKING.id,
              row_index: 0,
              day: FRIDAY,
              employee_id: CLARA.id,
            },
          ],
        }),
    );
    renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    expect(cellButton("Packing", 1, FRIDAY)).toHaveTextContent(
      "staff.inactive_employee",
    );
    expect(
      screen.queryByRole("button", { name: /^Clara\./ }),
    ).not.toBeInTheDocument();
    expect(paletteChip("Anna")).toBeInTheDocument();
  });

  it("counts on each palette chip how often the employee is planned this week", async () => {
    staffApi.fetchGrid.mockImplementation(
      async (params: StaffWeeklyPlanGridRetrieveParams) =>
        weekGrid({
          ...params,
          assignments: [
            ...PLANNED,
            {
              category_id: PACKING.id,
              row_index: 0,
              day: FRIDAY,
              employee_id: ANNA.id,
            },
          ],
        }),
    );
    renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    expect(paletteChip("Anna")).toHaveTextContent("Anna2");
    expect(paletteChip("Ben")).toHaveTextContent("Ben1");
  });
});

describe("WeeklyStaffPlan editing by the office", () => {
  it("places an employee picked from the palette and saves the whole week", async () => {
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(paletteChip("Ben"));
    await user.click(cellButton("Harvest", 2, MONDAY));

    await waitFor(() => expect(staffApi.replaceWeek).toHaveBeenCalledTimes(1));
    expect(lastSavedWeek()).toEqual({
      year: 2026,
      week: 41,
      assignments: sortedAssignments(...PLANNED, {
        category_id: HARVEST.id,
        row_index: 1,
        day: MONDAY,
        employee_id: BEN.id,
      }),
    });
    expect(cellButton("Harvest", 2, MONDAY)).toHaveTextContent("Ben");
    expect(paletteChip("Ben")).toHaveTextContent("Ben2");
  });

  it("removes an employee from a cell and saves the week without them", async () => {
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(removeButton("Harvest", 1, MONDAY));

    await waitFor(() => expect(staffApi.replaceWeek).toHaveBeenCalledTimes(1));
    expect(lastSavedWeek().assignments).toEqual([PLANNED[1]]);
    expect(cellButton("Harvest", 1, MONDAY)).not.toHaveTextContent("Anna");
    expect(paletteChip("Anna")).toHaveTextContent("Anna0");
  });

  it("moves a planned employee to another cell", async () => {
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(cellButton("Harvest", 1, WEDNESDAY));
    await user.click(cellButton("Packing", 1, FRIDAY));

    await waitFor(() => expect(staffApi.replaceWeek).toHaveBeenCalledTimes(1));
    expect(lastSavedWeek().assignments).toEqual(
      sortedAssignments(PLANNED[0], {
        category_id: PACKING.id,
        row_index: 0,
        day: FRIDAY,
        employee_id: BEN.id,
      }),
    );
    expect(cellButton("Harvest", 1, WEDNESDAY)).not.toHaveTextContent("Ben");
    expect(cellButton("Packing", 1, FRIDAY)).toHaveTextContent("Ben");
  });

  it("swaps two employees when one is dropped onto the other", async () => {
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(cellButton("Harvest", 1, MONDAY));
    await user.click(cellButton("Harvest", 1, WEDNESDAY));

    await waitFor(() => expect(staffApi.replaceWeek).toHaveBeenCalledTimes(1));
    expect(lastSavedWeek().assignments).toEqual(
      sortedAssignments(
        { ...PLANNED[0], employee_id: BEN.id },
        { ...PLANNED[1], employee_id: ANNA.id },
      ),
    );
    expect(cellButton("Harvest", 1, MONDAY)).toHaveTextContent("Ben");
    expect(cellButton("Harvest", 1, WEDNESDAY)).toHaveTextContent("Anna");
  });

  it("refuses to plan an employee twice in one category on the same day", async () => {
    const warning = vi.spyOn(message, "warning").mockImplementation(noToast);
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(paletteChip("Anna"));
    await user.click(cellButton("Harvest", 2, MONDAY));

    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({ content: "staff.already_in_category_that_day" }),
    );
    expect(cellButton("Harvest", 2, MONDAY)).not.toHaveTextContent("Anna");
    await flushMicrotasks();
    expect(staffApi.replaceWeek).not.toHaveBeenCalled();
  });

  it("refuses a move that would put an employee twice in one category on the same day", async () => {
    const warning = vi.spyOn(message, "warning").mockImplementation(noToast);
    staffApi.fetchGrid.mockImplementation(
      async (params: StaffWeeklyPlanGridRetrieveParams) =>
        weekGrid({
          ...params,
          assignments: [
            PLANNED[0],
            {
              category_id: HARVEST.id,
              row_index: 1,
              day: TUESDAY,
              employee_id: ANNA.id,
            },
          ],
        }),
    );
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(cellButton("Harvest", 2, TUESDAY));
    await user.click(cellButton("Harvest", 2, MONDAY));

    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({ content: "staff.already_in_category_that_day" }),
    );
    expect(cellButton("Harvest", 2, TUESDAY)).toHaveTextContent("Anna");
    expect(cellButton("Harvest", 2, MONDAY)).not.toHaveTextContent("Anna");
    await flushMicrotasks();
    expect(staffApi.replaceWeek).not.toHaveBeenCalled();
  });

  it("allows the same employee in another category on the same day", async () => {
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(paletteChip("Anna"));
    await user.click(cellButton("Packing", 1, MONDAY));

    await waitFor(() => expect(staffApi.replaceWeek).toHaveBeenCalledTimes(1));
    expect(lastSavedWeek().assignments).toEqual(
      sortedAssignments(...PLANNED, {
        category_id: PACKING.id,
        row_index: 0,
        day: MONDAY,
        employee_id: ANNA.id,
      }),
    );
  });

  it("does not save a week that was only loaded or browsed", async () => {
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(screen.getByRole("button", { name: "common.next" }));
    await waitFor(() =>
      expect(staffApi.fetchGrid).toHaveBeenLastCalledWith({
        year: 2026,
        week: 42,
      }),
    );
    await flushMicrotasks(50);

    expect(staffApi.replaceWeek).not.toHaveBeenCalled();
  });

  it("shows that the week is being saved until the server confirms it", async () => {
    let confirm: () => void = () => {};
    staffApi.replaceWeek.mockImplementation(
      (data: WeeklyPlanReplace) =>
        new Promise<WeeklyPlanGrid>((resolve) => {
          confirm = () => resolve(weekGrid({ ...data }));
        }),
    );
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(removeButton("Harvest", 1, MONDAY));

    expect(await screen.findByText("settings.saving")).toBeInTheDocument();
    confirm();
    expect(await screen.findByText("settings.saved")).toBeInTheDocument();
    expect(screen.queryByText("settings.saving")).not.toBeInTheDocument();
  });

  it("reports a refused save and requests the week again", async () => {
    const error = vi.spyOn(message, "error").mockImplementation(noToast);
    staffApi.replaceWeek.mockRejectedValue(
      apiError(400, {
        code: "staff.invalid_weekly_plan_assignment",
        message:
          "Category 'Harvest' is deactivated, so the weekly plan does not show it. Reactivate it, or drop its assignments.",
        field: "category_id",
      }),
    );
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(paletteChip("Ben"));
    await user.click(cellButton("Harvest", 2, MONDAY));

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          content: deErrors.staff.invalid_weekly_plan_assignment,
        }),
      ),
    );
    await waitFor(() => expect(staffApi.fetchGrid).toHaveBeenCalledTimes(2));
    expect(staffApi.fetchGrid).toHaveBeenLastCalledWith({
      year: 2026,
      week: 41,
    });
    // The server kept the week as it was, so Ben's placement leaves the grid.
    await waitFor(() =>
      expect(cellButton("Harvest", 2, MONDAY)).toHaveTextContent(
        "staff.drop_employee_here",
      ),
    );
  });

  it("tells the office once, and says the week is not saved", async () => {
    const error = vi.spyOn(message, "error").mockImplementation(noToast);
    staffApi.replaceWeek.mockRejectedValue(
      apiError(400, {
        code: "staff.invalid_weekly_plan_assignment",
        message: "Category 'Harvest' is deactivated.",
        field: "category_id",
      }),
    );
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(removeButton("Harvest", 1, MONDAY));

    expect(await screen.findByText("common.error_saving")).toBeInTheDocument();
    expect(screen.queryByText("settings.saved")).not.toBeInTheDocument();
    expect(error).toHaveBeenCalledTimes(1);
    expect(appToast).not.toHaveBeenCalled();
  });
});

describe("WeeklyStaffPlan copying a week", () => {
  // The server's plan for the visible week; a copy fills it.
  let served: WeeklyPlanAssignment[] = [];

  beforeEach(() => {
    served = [];
    staffApi.fetchGrid.mockImplementation(
      async (params: StaffWeeklyPlanGridRetrieveParams) =>
        weekGrid({ ...params, assignments: served }),
    );
    staffApi.copyWeek.mockImplementation(async (data: WeeklyPlanCopy) => {
      served = PLANNED;
      return weekGrid({
        year: data.year,
        week: data.to_week,
        assignments: PLANNED,
      });
    });
  });

  it("copies the previous week into an empty week and shows the copied plan", async () => {
    const success = vi.spyOn(message, "success").mockImplementation(noToast);
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(
      screen.getByRole("button", { name: "staff.copy_into_this_week" }),
    );

    await waitFor(() =>
      expect(staffApi.copyWeek).toHaveBeenCalledWith({
        year: 2026,
        from_week: 40,
        to_week: 41,
      }),
    );
    expect(success).toHaveBeenCalledWith(
      expect.objectContaining({ content: "staff.weekly_plan_copied_success" }),
    );
    await waitFor(() =>
      expect(cellButton("Harvest", 1, MONDAY)).toHaveTextContent("Anna"),
    );
    expect(staffApi.fetchGrid).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("button", { name: "staff.copy_into_this_week" }),
    ).not.toBeInTheDocument();
    // The copy button is gone, so focus moves to the grid instead of the body.
    expect(
      screen.getByRole("region", { name: "staff.grid_caption" }),
    ).toHaveFocus();
  });

  it("copies from the week picked as the source", async () => {
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    // The picker opens on the preselected previous week (40); one up is 39.
    await pickEarlierSourceWeek(user);
    await user.click(
      screen.getByRole("button", { name: "staff.copy_into_this_week" }),
    );

    await waitFor(() =>
      expect(staffApi.copyWeek).toHaveBeenCalledWith({
        year: 2026,
        from_week: 39,
        to_week: 41,
      }),
    );
  });

  it("falls back to the previous week as the source after moving to another week", async () => {
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });
    await pickEarlierSourceWeek(user);

    await user.click(screen.getByRole("button", { name: "common.next" }));
    await screen.findByText("Harvest", { selector: "th" });
    await user.click(
      screen.getByRole("button", { name: "staff.copy_into_this_week" }),
    );

    await waitFor(() =>
      expect(staffApi.copyWeek).toHaveBeenCalledWith({
        year: 2026,
        from_week: 41,
        to_week: 42,
      }),
    );
  });

  it("offers no copy source in week 1, as the copy stays within the year", async () => {
    // Thursday 1 January 2026 lies in ISO week 1 of 2026.
    vi.setSystemTime(new Date(2026, 0, 1, 12));
    renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    expect(staffApi.fetchGrid).toHaveBeenCalledWith({ year: 2026, week: 1 });
    expect(screen.getByText("staff.copy_source_week")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "staff.copy_into_this_week" }),
    ).toBeDisabled();
  });

  it("hides the copy tools once the week has a plan", async () => {
    served = PLANNED;
    renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    expect(
      screen.queryByRole("button", { name: "staff.copy_into_this_week" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "staff.copy_weekly_plan_from" }),
    ).not.toBeInTheDocument();
  });

  it("reports a refused copy and leaves the week as it is", async () => {
    const error = vi.spyOn(message, "error").mockImplementation(noToast);
    staffApi.copyWeek.mockRejectedValue(
      apiError(409, {
        code: "staff.weekly_plan_copy_target_not_empty",
        message: "Week 41/2026 already has a weekly plan.",
      }),
    );
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    await user.click(
      screen.getByRole("button", { name: "staff.copy_into_this_week" }),
    );

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          content: deErrors.staff.weekly_plan_copy_target_not_empty,
        }),
      ),
    );
    expect(error).toHaveBeenCalledTimes(1);
    expect(appToast).not.toHaveBeenCalled();
    expect(staffApi.fetchGrid).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "staff.copy_into_this_week" }),
    ).toBeInTheDocument();
  });
});

describe("WeeklyStaffPlan role gating", () => {
  it.each([
    { roles: ["office"], offered: true },
    { roles: ["admin"], offered: true },
    { roles: ["gardener"], offered: false },
    { roles: ["staff"], offered: false },
    { roles: ["management"], offered: false },
  ])(
    "offers copying into an empty week to $roles: $offered",
    async ({ roles, offered }) => {
      auth.roles = roles;
      staffApi.fetchGrid.mockImplementation(
        async (params: StaffWeeklyPlanGridRetrieveParams) =>
          weekGrid({ ...params }),
      );
      renderPlan();
      await screen.findByText("Harvest", { selector: "th" });

      expect(
        screen.queryByRole("button", { name: "staff.copy_into_this_week" }) !==
          null,
      ).toBe(offered);
    },
  );

  it("shows the plan read-only to staff without the office role", async () => {
    auth.roles = ["gardener"];
    const { user } = renderPlan();
    await screen.findByText("Harvest", { selector: "th" });

    expect(cellButton("Harvest", 1, MONDAY)).toHaveTextContent("Anna");
    expect(
      screen.queryAllByRole("button", { name: "staff.remove_employee" }),
    ).toHaveLength(0);

    await user.click(paletteChip("Ben"));
    expect(paletteChip("Ben")).toHaveAttribute("aria-pressed", "false");
    await user.click(cellButton("Harvest", 2, MONDAY));
    await user.click(cellButton("Harvest", 1, MONDAY));
    await user.click(cellButton("Packing", 1, FRIDAY));

    expect(cellButton("Harvest", 2, MONDAY)).not.toHaveTextContent("Ben");
    expect(cellButton("Harvest", 1, MONDAY)).toHaveTextContent("Anna");
    expect(cellButton("Packing", 1, FRIDAY)).not.toHaveTextContent("Anna");
    await flushMicrotasks();
    expect(staffApi.replaceWeek).not.toHaveBeenCalled();
  });
});
