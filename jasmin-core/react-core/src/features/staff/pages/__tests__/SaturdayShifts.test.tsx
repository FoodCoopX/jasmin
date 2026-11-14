// The Saturday-shift page: a year of crosses, an employee per row and an ISO
// week per column, each cross saved as it is set. The generated staff client
// is replaced by real TanStack hooks around spies, so what reaches each
// request is under test.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UseMutationOptions } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { message } from "antd";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import type {
  SaturdayShiftEmployee,
  SaturdayShiftSetRequest,
  SaturdayShiftYear,
  StaffSaturdayShiftsYearRetrieveParams,
} from "@shared/api/generated/models";
import { flushMicrotasks, profileRenders } from "@/test/profileRenders";

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
  fetchYear: vi.fn(),
  setShift: vi.fn(),
}));

vi.mock("@shared/api/generated/staff/staff", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@shared/api/generated/staff/staff")>();
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  return {
    ...actual,
    useStaffSaturdayShiftsYearRetrieve: (
      params: StaffSaturdayShiftsYearRetrieveParams,
    ) =>
      useQuery({
        queryKey: actual.getStaffSaturdayShiftsYearRetrieveQueryKey(params),
        queryFn: (): Promise<SaturdayShiftYear> => staffApi.fetchYear(params),
      }),
    useStaffSaturdayShiftsYearCreate: (options?: {
      mutation?: UseMutationOptions<
        SaturdayShiftYear,
        unknown,
        { data: SaturdayShiftSetRequest }
      >;
    }) =>
      useMutation({
        ...options?.mutation,
        mutationKey:
          actual.getStaffSaturdayShiftsYearCreateMutationOptions().mutationKey,
        mutationFn: ({ data }: { data: SaturdayShiftSetRequest }) =>
          staffApi.setShift(data) as Promise<SaturdayShiftYear>,
      }),
  };
});

import SaturdayShifts from "../SaturdayShifts";

// ── Fixtures ────────────────────────────────────────────────────────────────

// The clock stands in ISO week 15 of 2026, a year of 53 weeks.
const THIS_WEEK = 15;

/** Works weeks 3 and 15, and is absent on the Saturday of week 15: a shift
 *  set before the absence. */
const ANNA: SaturdayShiftEmployee = {
  id: "emp-anna",
  short_name_for_weekly_plan: "Anna",
  is_active: true,
  weeks: [3, THIS_WEEK],
  absent_weeks: [THIS_WEEK],
};
/** Works week 7, absent on the Saturday of week 20. */
const BEN: SaturdayShiftEmployee = {
  id: "emp-ben",
  short_name_for_weekly_plan: "Ben",
  is_active: true,
  weeks: [7],
  absent_weeks: [20],
};
/** Deactivated, listed for the shift she still holds. */
const CARLA: SaturdayShiftEmployee = {
  id: "emp-carla",
  short_name_for_weekly_plan: "Carla",
  is_active: false,
  weeks: [3],
  absent_weeks: [],
};

let served: SaturdayShiftEmployee[] = [];

function saturdayYear(year: number): SaturdayShiftYear {
  return { year, weeks: year === 2026 ? 53 : 52, employees: served };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderPage() {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <SaturdayShifts />
    </QueryClientProvider>,
  );
  return { user };
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`No table row shows ${name}`);
  return row;
}

/** The cross of an employee's ISO week. */
const cross = (name: string, week: number) =>
  within(rowOf(name)).getAllByRole("checkbox")[week - 1];

const bodyRows = () =>
  Array.from(
    document.querySelectorAll<HTMLTableRowElement>(".ant-table-tbody tr.ant-table-row"),
  );

const noToast = () => undefined as never;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 3, 6, 12));
  auth.roles = ["office"];
  served = [ANNA, BEN, CARLA];
  staffApi.fetchYear
    .mockReset()
    .mockImplementation(async (params: StaffSaturdayShiftsYearRetrieveParams) =>
      saturdayYear(params.year),
    );
  staffApi.setShift
    .mockReset()
    .mockImplementation(async (body: SaturdayShiftSetRequest) => {
      served = served.map((employee) =>
        employee.id !== body.employee_id
          ? employee
          : {
              ...employee,
              weeks: body.on_duty
                ? [...employee.weeks, body.week].sort((a, b) => a - b)
                : employee.weeks.filter((week) => week !== body.week),
            },
      );
      return saturdayYear(body.year);
    });
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("SaturdayShifts render-loop smoke", () => {
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
        {profiler.wrap(<SaturdayShifts />, "saturday-shifts")}
      </QueryClientProvider>,
    );
    await screen.findByText("Anna");
    await flushMicrotasks(50);
    expect(profiler.onRender.mock.calls.length).toBeLessThan(80);
  });
});

describe("SaturdayShifts", () => {
  it("requests the current ISO year and crosses every Saturday shift", async () => {
    renderPage();
    await screen.findByText("Anna");

    expect(staffApi.fetchYear).toHaveBeenCalledWith({ year: 2026 });
    expect(cross("Anna", 3)).toBeChecked();
    expect(cross("Anna", 4)).not.toBeChecked();
    expect(cross("Ben", 7)).toBeChecked();
  });

  it("has a column for each week of the year and counts each row's shifts", async () => {
    renderPage();
    await screen.findByText("Anna");

    expect(
      screen.getAllByRole("columnheader", { name: /staff\.week_option/ }),
    ).toHaveLength(53);
    expect(within(rowOf("Anna")).getAllByRole("checkbox")).toHaveLength(53);
    const countOf = (name: string) =>
      within(rowOf(name)).getAllByRole("cell")[1].textContent;
    expect([countOf("Anna"), countOf("Ben")]).toEqual(["2", "1"]);
  });

  it("marks the current week's column", async () => {
    renderPage();
    await screen.findByText("Anna");

    const headers = screen.getAllByRole("columnheader", {
      name: /staff\.week_option/,
    });
    expect(headers[THIS_WEEK - 1]).toHaveClass("saturday-shifts-current-week");
    expect(headers[THIS_WEEK]).not.toHaveClass("saturday-shifts-current-week");
  });

  it("opens on the current week, and stays put while crosses are set", async () => {
    // jsdom has no scrollIntoView; the stub goes again with the test.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    onTestFinished(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });
    const { user } = renderPage();
    await screen.findByText("Anna");

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.contexts[0]).toBe(
      screen.getAllByRole("columnheader", { name: /staff\.week_option/ })[
        THIS_WEEK - 1
      ],
    );
    expect(scrollIntoView).toHaveBeenCalledWith({
      inline: "center",
      block: "nearest",
    });

    await user.click(cross("Ben", 10));
    await waitFor(() => expect(staffApi.setShift).toHaveBeenCalledTimes(1));
    await flushMicrotasks();

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("saves a shift as soon as it is crossed, and counts it", async () => {
    const { user } = renderPage();
    await screen.findByText("Anna");

    await user.click(cross("Ben", 10));

    expect(cross("Ben", 10)).toBeChecked();
    await waitFor(() =>
      expect(staffApi.setShift).toHaveBeenCalledWith({
        year: 2026,
        week: 10,
        employee_id: BEN.id,
        on_duty: true,
      }),
    );
    expect(within(rowOf("Ben")).getAllByRole("cell")[1]).toHaveTextContent("2");
  });

  it("takes a shift away when its cross is", async () => {
    const { user } = renderPage();
    await screen.findByText("Anna");

    await user.click(cross("Anna", 3));

    expect(cross("Anna", 3)).not.toBeChecked();
    await waitFor(() =>
      expect(staffApi.setShift).toHaveBeenCalledWith(
        expect.objectContaining({ week: 3, employee_id: ANNA.id, on_duty: false }),
      ),
    );
  });

  it("refuses a new cross on an absent Saturday and marks one set before", async () => {
    renderPage();
    await screen.findByText("Anna");

    expect(cross("Ben", 20)).toBeDisabled();
    expect(cross("Ben", 20)).toHaveAccessibleName("staff.saturday_shift_absent");
    // Set before the absence: red, and it can still be taken away.
    expect(cross("Anna", THIS_WEEK)).toBeChecked();
    expect(cross("Anna", THIS_WEEK)).toBeEnabled();
    expect(
      cross("Anna", THIS_WEEK).closest(".saturday-shift-conflict"),
    ).not.toBeNull();
    expect(cross("Anna", 3).closest(".saturday-shift-conflict")).toBeNull();
  });

  it("lets an inactive employee's shift be taken away, but gives no new one", async () => {
    renderPage();
    await screen.findByText("Anna");

    expect(screen.getByText("staff.inactive_employee")).toBeInTheDocument();
    const carla = screen.getByText("staff.inactive_employee").closest("tr");
    if (!carla) throw new Error("No row for the inactive employee");
    const crosses = within(carla).getAllByRole("checkbox");
    expect(crosses[3 - 1]).toBeEnabled();
    expect(crosses[4 - 1]).toBeDisabled();
  });

  it("holds a row's crosses until its save is back", async () => {
    let confirm: () => void = () => {};
    staffApi.setShift.mockImplementation(
      (body: SaturdayShiftSetRequest) =>
        new Promise<SaturdayShiftYear>((resolve) => {
          confirm = () => resolve(saturdayYear(body.year));
        }),
    );
    const { user } = renderPage();
    await screen.findByText("Anna");

    await user.click(cross("Ben", 10));

    expect(cross("Ben", 11)).toBeDisabled();
    expect(cross("Anna", 4)).toBeEnabled();
    expect(await screen.findByText("settings.saving")).toBeInTheDocument();
    confirm();
    await waitFor(() => expect(cross("Ben", 11)).toBeEnabled());
  });

  it("reports a refused save and shows the year as stored", async () => {
    const error = vi.spyOn(message, "error").mockImplementation(noToast);
    staffApi.setShift.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 409,
        data: { code: "staff.saturday_shift_no_place", message: "Full." },
      },
    });
    const { user } = renderPage();
    await screen.findByText("Anna");

    await user.click(cross("Ben", 10));

    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(staffApi.fetchYear).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(cross("Ben", 10)).not.toBeChecked());
  });

  it("sorts by a week, those working its Saturday first", async () => {
    const { user } = renderPage();
    await screen.findByText("Anna");
    expect(bodyRows()[0]).toBe(rowOf("Anna"));

    await user.click(
      screen.getAllByRole("columnheader", { name: /staff\.week_option/ })[7 - 1],
    );

    expect(bodyRows()[0]).toBe(rowOf("Ben"));
  });

  it("keeps a sorted row in place when its cross changes", async () => {
    const { user } = renderPage();
    await screen.findByText("Anna");
    await user.click(
      screen.getAllByRole("columnheader", { name: /staff\.week_option/ })[7 - 1],
    );
    expect(bodyRows()[0]).toBe(rowOf("Ben"));

    await user.click(cross("Ben", 7));
    await waitFor(() => expect(cross("Ben", 7)).toBeEnabled());

    expect(cross("Ben", 7)).not.toBeChecked();
    expect(bodyRows()[0]).toBe(rowOf("Ben"));
  });

  it("sorts by the count, the most shifts first", async () => {
    served = [BEN, ANNA, CARLA];
    const { user } = renderPage();
    await screen.findByText("Anna");
    expect(bodyRows()[0]).toBe(rowOf("Ben"));

    await user.click(
      screen.getByRole("columnheader", { name: /staff\.saturday_shift_count/ }),
    );

    expect(bodyRows()[0]).toBe(rowOf("Anna"));
  });

  it("counts on top who works each week's Saturday, whatever the sort", async () => {
    const { user } = renderPage();
    await screen.findByText("Anna");
    const totals = rowOf("staff.sum");
    const onDuty = (week: number) =>
      within(totals).getAllByRole("cell")[week - 1].textContent;

    expect([onDuty(3), onDuty(7), onDuty(8)]).toEqual(["2", "1", "0"]);

    await user.click(cross("Ben", 8));
    await waitFor(() => expect(onDuty(8)).toBe("1"));
    await user.click(
      screen.getByRole("columnheader", { name: /staff\.saturday_shift_count/ }),
    );
    expect(totals.parentElement?.firstElementChild).toBe(totals);
  });

  it("finds an employee by name", async () => {
    const { user } = renderPage();
    await screen.findByText("Anna");

    await user.type(
      screen.getByRole("searchbox", { name: "table.search_placeholder" }),
      "be",
    );

    expect(bodyRows()).toEqual([rowOf("Ben")]);
  });

  it.each([{ roles: ["gardener"] }, { roles: ["staff"] }])(
    "shows the shifts read-only to $roles",
    async ({ roles }) => {
      auth.roles = roles;
      renderPage();
      await screen.findByText("Anna");

      for (const box of screen.getAllByRole("checkbox")) {
        expect(box).toBeDisabled();
      }
    },
  );
});
