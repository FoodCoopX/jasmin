// The absences page: a week of crosses, an employee per row and a weekday per
// column, each cross saved as it is set. The generated staff client is
// replaced by real TanStack hooks around spies, so what reaches each request
// is under test.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UseMutationOptions } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { message } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AbsenceSyncResult,
  AbsenceWeek,
  AbsenceWeekEmployee,
  AbsenceWeekReplaceRequest,
  HrSystemSyncRequest,
  StaffAbsencesWeekRetrieveParams,
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

// Whether the tenant takes its employees from the HR system.
const tenantSettings = vi.hoisted(() => ({ usesHrSystem: true }));
vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock({
    getSetting: (key: string, defaultValue?: unknown) =>
      key === "uses_hr_system" ? tenantSettings.usesHrSystem : defaultValue,
  });
  return { useTenant: () => tenant };
});

const staffApi = vi.hoisted(() => ({
  fetchWeek: vi.fn(),
  saveEmployeeWeek: vi.fn(),
  syncAbsences: vi.fn(),
}));

vi.mock("@shared/api/generated/staff/staff", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@shared/api/generated/staff/staff")>();
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  return {
    ...actual,
    useStaffAbsencesWeekRetrieve: (params: StaffAbsencesWeekRetrieveParams) =>
      useQuery({
        queryKey: actual.getStaffAbsencesWeekRetrieveQueryKey(params),
        queryFn: (): Promise<AbsenceWeek> => staffApi.fetchWeek(params),
      }),
    useStaffAbsencesWeekCreate: (options?: {
      mutation?: UseMutationOptions<
        AbsenceWeek,
        unknown,
        { data: AbsenceWeekReplaceRequest }
      >;
    }) =>
      useMutation({
        ...options?.mutation,
        mutationKey: actual.getStaffAbsencesWeekCreateMutationOptions()
          .mutationKey,
        mutationFn: ({ data }: { data: AbsenceWeekReplaceRequest }) =>
          staffApi.saveEmployeeWeek(data) as Promise<AbsenceWeek>,
      }),
    useStaffAbsencesSyncFromHrSystemCreate: (options?: {
      mutation?: {
        onSuccess?: (result: AbsenceSyncResult) => void;
        onError?: (error: unknown) => void;
      };
    }) =>
      useMutation({
        mutationFn: (variables: {
          data: HrSystemSyncRequest;
        }): Promise<AbsenceSyncResult> => staffApi.syncAbsences(variables.data),
        onSuccess: (result) => options?.mutation?.onSuccess?.(result),
        onError: (error) => options?.mutation?.onError?.(error),
      }),
  };
});

import Absences from "../Absences";

// ── Fixtures ────────────────────────────────────────────────────────────────

const ABSENCE = {
  id: "cat-default",
  name: "Abwesenheit",
  is_active: true,
  is_default: true,
};
const VACATION = {
  id: "cat-vacation",
  name: "Urlaub",
  is_active: true,
  is_default: false,
};

const MONDAY = 0;
const TUESDAY = 1;
const WEDNESDAY = 2;
const THURSDAY = 3;
const SUNDAY = 6;

function week(days: Record<number, string> = {}) {
  return Object.fromEntries(
    [0, 1, 2, 3, 4, 5, 6].map((day) => [String(day), days[day] ?? null]),
  );
}

/** From the HR system, away on Monday. */
const ANNA: AbsenceWeekEmployee = {
  id: "emp-anna",
  short_name_for_weekly_plan: "Anna",
  is_active: true,
  comes_from_hr_system: true,
  days: week({ [MONDAY]: ABSENCE.id }),
};
/** An intern entered here: away on Tuesday and on Sunday, which the page
 *  doesn't show, and on Wednesday under a category entered before. */
const PIA: AbsenceWeekEmployee = {
  id: "emp-pia",
  short_name_for_weekly_plan: "Pia",
  is_active: true,
  comes_from_hr_system: false,
  days: week({
    [TUESDAY]: ABSENCE.id,
    [WEDNESDAY]: VACATION.id,
    [SUNDAY]: ABSENCE.id,
  }),
};

function absenceWeek(
  params: StaffAbsencesWeekRetrieveParams,
  employees: AbsenceWeekEmployee[] = [ANNA, PIA],
): AbsenceWeek {
  return { ...params, categories: [ABSENCE, VACATION], employees };
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
      <Absences />
    </QueryClientProvider>,
  );
  return { user };
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`No table row shows ${name}`);
  return row;
}

/** The cross of an employee's day; `day` counts from Monday = 0. */
const cross = (name: string, day: number) =>
  within(rowOf(name)).getAllByRole("checkbox", {
    name: "staff.absent_on_day",
  })[day];

const syncButton = () =>
  screen.getByRole("button", { name: /staff\.sync_from_hr_system/ });

const noToast = () => undefined as never;

beforeEach(() => {
  // A Monday in ISO week 15 of 2026; the page opens on "now".
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 3, 6, 12));
  auth.roles = ["office"];
  tenantSettings.usesHrSystem = true;
  staffApi.fetchWeek
    .mockReset()
    .mockImplementation(async (params: StaffAbsencesWeekRetrieveParams) =>
      absenceWeek(params),
    );
  staffApi.saveEmployeeWeek
    .mockReset()
    .mockImplementation(async (body: AbsenceWeekReplaceRequest) =>
      absenceWeek({ year: body.year, week: body.week }, [
        ANNA,
        { ...PIA, days: body.days },
      ]),
    );
  staffApi.syncAbsences.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Absences render-loop smoke", () => {
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
        {profiler.wrap(<Absences />, "absences")}
      </QueryClientProvider>,
    );
    await screen.findByText("Pia");
    await flushMicrotasks(50);
    expect(profiler.onRender.mock.calls.length).toBeLessThan(80);
  });
});

describe("Absences", () => {
  it("requests the current ISO week and crosses each day someone is away", async () => {
    renderPage();
    await screen.findByText("Pia");

    expect(staffApi.fetchWeek).toHaveBeenCalledWith({ year: 2026, week: 15 });
    expect(cross("Anna", MONDAY)).toBeChecked();
    expect(cross("Anna", TUESDAY)).not.toBeChecked();
    expect(cross("Pia", TUESDAY)).toBeChecked();
    expect(cross("Pia", WEDNESDAY)).toBeChecked();
    expect(cross("Pia", THURSDAY)).not.toBeChecked();
  });

  it("has a column for each day from Monday to Saturday", async () => {
    renderPage();
    await screen.findByText("Pia");

    for (const day of [0, 1, 2, 3, 4, 5]) {
      expect(
        screen.getByRole("columnheader", {
          name: `commissioning.weekdays.${day}`,
        }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("columnheader", { name: "commissioning.weekdays.6" }),
    ).not.toBeInTheDocument();
    expect(within(rowOf("Pia")).getAllByRole("checkbox")).toHaveLength(6);
  });

  it("sorts by a day, those away that day first", async () => {
    const { user } = renderPage();
    await screen.findByText("Pia");
    const rows = () =>
      Array.from(document.querySelectorAll(".ant-table-tbody tr.ant-table-row"));
    expect(rows()).toEqual([rowOf("Anna"), rowOf("Pia")]);

    await user.click(
      screen.getByRole("columnheader", { name: /commissioning\.weekdays\.1/ }),
    );

    expect(rows()).toEqual([rowOf("Pia"), rowOf("Anna")]);
  });

  it("keeps the sorted order through a cross, and sorts another week afresh", async () => {
    const { user } = renderPage();
    await screen.findByText("Pia");
    const rows = () =>
      Array.from(document.querySelectorAll(".ant-table-tbody tr.ant-table-row"));
    await user.click(
      screen.getByRole("columnheader", { name: /commissioning\.weekdays\.1/ }),
    );
    expect(rows()).toEqual([rowOf("Pia"), rowOf("Anna")]);

    await user.click(cross("Pia", TUESDAY));
    await waitFor(() => expect(cross("Pia", TUESDAY)).toBeEnabled());

    expect(cross("Pia", TUESDAY)).not.toBeChecked();
    expect(rows()).toEqual([rowOf("Pia"), rowOf("Anna")]);

    // In the next week only Anna is away on Tuesday.
    staffApi.fetchWeek.mockImplementation(
      async (params: StaffAbsencesWeekRetrieveParams) =>
        absenceWeek(params, [
          { ...ANNA, days: week({ [TUESDAY]: ABSENCE.id }) },
          { ...PIA, days: week() },
        ]),
    );
    await user.click(screen.getByRole("button", { name: "common.next" }));

    await waitFor(() => expect(rows()).toEqual([rowOf("Anna"), rowOf("Pia")]));
  });

  it("counts on top who is away each day", async () => {
    const { user } = renderPage();
    await screen.findByText("Pia");
    const away = () =>
      within(rowOf("staff.sum"))
        .getAllByRole("cell")
        .map((cell) => cell.textContent);
    expect(away()).toEqual(["1", "1", "1", "0", "0", "0"]);

    await user.click(cross("Pia", THURSDAY));

    await waitFor(() => expect(away()[THURSDAY]).toBe("1"));
  });

  it("finds an employee by name", async () => {
    const { user } = renderPage();
    await screen.findByText("Pia");

    await user.type(
      screen.getByRole("searchbox", { name: "table.search_placeholder" }),
      "pi",
    );

    expect(screen.queryByText("Anna")).not.toBeInTheDocument();
    expect(rowOf("Pia")).toBeInTheDocument();
  });

  it("saves the employee's week as soon as a day is crossed", async () => {
    const { user } = renderPage();
    await screen.findByText("Pia");

    await user.click(cross("Pia", THURSDAY));

    expect(cross("Pia", THURSDAY)).toBeChecked();
    await waitFor(() =>
      expect(staffApi.saveEmployeeWeek).toHaveBeenCalledTimes(1),
    );
    // The new day goes into the default category; the others, Sunday
    // included, go back as they were.
    expect(staffApi.saveEmployeeWeek).toHaveBeenCalledWith({
      year: 2026,
      week: 15,
      employee_id: PIA.id,
      days: {
        "0": null,
        "1": ABSENCE.id,
        "2": VACATION.id,
        "3": ABSENCE.id,
        "4": null,
        "5": null,
        "6": ABSENCE.id,
      },
    });
  });

  it("clears a day when its cross is taken away", async () => {
    const { user } = renderPage();
    await screen.findByText("Pia");

    await user.click(cross("Pia", TUESDAY));

    expect(cross("Pia", TUESDAY)).not.toBeChecked();
    await waitFor(() =>
      expect(staffApi.saveEmployeeWeek).toHaveBeenCalledTimes(1),
    );
    expect(staffApi.saveEmployeeWeek.mock.calls[0][0].days["1"]).toBeNull();
  });

  it("holds a row's crosses until its save is back", async () => {
    let confirm: () => void = () => {};
    staffApi.saveEmployeeWeek.mockImplementation(
      (body: AbsenceWeekReplaceRequest) =>
        new Promise<AbsenceWeek>((resolve) => {
          confirm = () =>
            resolve(absenceWeek(body, [ANNA, { ...PIA, days: body.days }]));
        }),
    );
    const { user } = renderPage();
    await screen.findByText("Pia");

    await user.click(cross("Pia", THURSDAY));

    expect(cross("Pia", MONDAY)).toBeDisabled();
    expect(await screen.findByText("settings.saving")).toBeInTheDocument();
    confirm();
    await waitFor(() => expect(cross("Pia", THURSDAY)).toBeEnabled());
    expect(cross("Pia", THURSDAY)).toBeChecked();
  });

  it("reports a refused save and shows the week as stored", async () => {
    const error = vi.spyOn(message, "error").mockImplementation(noToast);
    staffApi.saveEmployeeWeek.mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 409,
        data: { code: "staff.absences_from_hr_system", message: "Refused." },
      },
    });
    const { user } = renderPage();
    await screen.findByText("Pia");

    await user.click(cross("Pia", THURSDAY));

    await waitFor(() => expect(error).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(staffApi.fetchWeek).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(cross("Pia", THURSDAY)).not.toBeChecked());
  });

  it("leaves the absences of the HR system's employees to the sync", async () => {
    renderPage();
    await screen.findByText("Pia");

    expect(within(rowOf("Anna")).getByText("staff.hr_system_tag")).toBeVisible();
    expect(cross("Anna", TUESDAY)).toBeDisabled();
    expect(cross("Pia", THURSDAY)).toBeEnabled();
  });

  it("lets every employee's absences be crossed without the HR system", async () => {
    tenantSettings.usesHrSystem = false;
    renderPage();
    await screen.findByText("Pia");

    expect(cross("Anna", TUESDAY)).toBeEnabled();
    expect(screen.queryByText("staff.hr_system_tag")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /staff\.sync_from_hr_system/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("explainers.absences")).toBeInTheDocument();
  });

  it.each([{ roles: ["gardener"] }, { roles: ["staff"] }])(
    "shows the absences read-only to $roles",
    async ({ roles }) => {
      auth.roles = roles;
      renderPage();
      await screen.findByText("Pia");

      for (const box of screen.getAllByRole("checkbox")) {
        expect(box).toBeDisabled();
      }
      expect(
        screen.queryByRole("button", { name: /staff\.sync_from_hr_system/ }),
      ).not.toBeInTheDocument();
    },
  );
});

describe("Absences synced from the HR system", () => {
  it("syncs, reports what changed and the conflicts, and reloads the week", async () => {
    const success = vi.spyOn(message, "success").mockImplementation(noToast);
    const warning = vi.spyOn(message, "warning").mockImplementation(noToast);
    staffApi.syncAbsences.mockResolvedValue({
      employees: { created: 0, updated: 0, deactivated: 0 },
      absences: { created: 3, updated: 0, deleted: 1, conflicts: 2 },
    });
    const { user } = renderPage();
    await screen.findByText("Pia");

    await user.click(syncButton());

    await waitFor(() =>
      expect(staffApi.syncAbsences).toHaveBeenCalledWith({}),
    );
    await waitFor(() => expect(staffApi.fetchWeek).toHaveBeenCalledTimes(2));
    expect(success).toHaveBeenCalledTimes(1);
    expect(success).toHaveBeenCalledWith(
      expect.objectContaining({ content: "staff.hr_system_absences_synced" }),
    );
    expect(warning).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "staff.hr_system_absence_conflicts",
      }),
    );
  });

  it("also reports the employees the sync changed", async () => {
    const success = vi.spyOn(message, "success").mockImplementation(noToast);
    staffApi.syncAbsences.mockResolvedValue({
      employees: { created: 1, updated: 0, deactivated: 0 },
      absences: { created: 0, updated: 0, deleted: 0, conflicts: 0 },
    });
    const { user } = renderPage();
    await screen.findByText("Pia");

    await user.click(syncButton());

    await waitFor(() =>
      expect(success).toHaveBeenCalledWith(
        expect.objectContaining({ content: "staff.hr_system_synced" }),
      ),
    );
  });

  it("asks before deactivating more than half, and syncs once confirmed", async () => {
    vi.spyOn(message, "success").mockImplementation(noToast);
    staffApi.syncAbsences
      .mockRejectedValueOnce({
        isAxiosError: true,
        response: {
          status: 409,
          data: {
            code: "staff.hr_system_mass_deactivation",
            message: "The sync would deactivate 2 of the 3 active employees.",
            details: { employees: ["Anna", "Ben"] },
          },
        },
      })
      .mockResolvedValueOnce({
        employees: { created: 0, updated: 0, deactivated: 2 },
        absences: { created: 0, updated: 0, deleted: 0, conflicts: 0 },
      });
    const { user } = renderPage();
    await screen.findByText("Pia");

    await user.click(syncButton());
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "staff.hr_system_deactivate" }),
    );

    await waitFor(() =>
      expect(staffApi.syncAbsences).toHaveBeenLastCalledWith({
        confirm_deactivations: true,
      }),
    );
  });
});
