// The employees list renders through the real CrudListPage and EditableTable;
// only the generated staff client is replaced (the list hook by a real
// TanStack query around a spy), so what the office sees and what reaches each
// generated function are both under test.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Employee,
  StaffEmployeesListParams,
  HrSystemSyncRequest,
  HrSystemSyncResult,
} from "@shared/api/generated/models";

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

// Inline row editing, the mode a new user starts in.
vi.mock("@shared/contexts/ModalContext", () => ({
  useModal: () => ({ isModalMode: false }),
}));

// Whether the tenant takes its employees from the HR system.
const tenantSettings = vi.hoisted(() => ({ usesHrSystem: false }));
vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock({
    getSetting: (key: string, defaultValue?: unknown) =>
      key === "uses_hr_system" ? tenantSettings.usesHrSystem : defaultValue,
  });
  return { useTenant: () => tenant };
});

const staffApi = vi.hoisted(() => ({
  listEmployees: vi.fn(),
  createEmployee: vi.fn(),
  updateEmployee: vi.fn(),
  deleteEmployee: vi.fn(),
  syncFromHrSystem: vi.fn(),
}));

vi.mock("@shared/api/generated/staff/staff", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@shared/api/generated/staff/staff")>();
  const { useMutation, useQuery } = await import("@tanstack/react-query");
  return {
    ...actual,
    useStaffEmployeesList: (params?: StaffEmployeesListParams) =>
      useQuery({
        queryKey: actual.getStaffEmployeesListQueryKey(params),
        queryFn: (): Promise<Employee[]> => staffApi.listEmployees(params),
      }),
    useStaffEmployeesSyncFromHrSystemCreate: (options?: {
      mutation?: {
        onSuccess?: (result: HrSystemSyncResult) => void;
        onError?: (error: unknown) => void;
      };
    }) =>
      useMutation({
        mutationFn: (variables: {
          data: HrSystemSyncRequest;
        }): Promise<HrSystemSyncResult> =>
          staffApi.syncFromHrSystem(variables.data),
        onSuccess: (result) => options?.mutation?.onSuccess?.(result),
        onError: (error) => options?.mutation?.onError?.(error),
      }),
    staffEmployeesCreate: (employee: Employee) =>
      staffApi.createEmployee(employee),
    staffEmployeesPartialUpdate: (id: string, employee: Employee) =>
      staffApi.updateEmployee(id, employee),
    staffEmployeesDestroy: (id: string) => staffApi.deleteEmployee(id),
  };
});

import ListEmployees from "../ListEmployees";

// ── Fixtures ────────────────────────────────────────────────────────────────

function employee(overrides: Partial<Employee> & { id: string }): Employee {
  return {
    is_active: true,
    short_name_for_weekly_plan: "",
    first_name: null,
    last_name: null,
    employee_number: null,
    comes_from_hr_system: false,
    hr_system_id: null,
    user: null,
    can_be_deleted: true,
    ...overrides,
  };
}

// Anna is still planned in a weekly plan, so the backend marks her as in use.
const ANNA = employee({
  id: "emp-anna",
  short_name_for_weekly_plan: "Anna",
  first_name: "Anna",
  last_name: "Berger",
  can_be_deleted: false,
});
const BEN = employee({ id: "emp-ben", short_name_for_weekly_plan: "Ben" });
const CARLA = employee({
  id: "emp-carla",
  short_name_for_weekly_plan: "Carla",
  is_active: false,
});

// What the server currently holds; the list request answers from it.
let serverEmployees: Employee[] = [];

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderList() {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ListEmployees />
    </QueryClientProvider>,
  );
  return { user };
}

function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest("tr");
  if (!row) throw new Error(`No table row shows ${text}`);
  return row;
}

/** The accessible name of the weekly-plan name's input. */
const NAME = "staff.short_name_for_weekly_plan";

/** The row being edited inline — the one offering a save button. */
function editingRow(): HTMLElement {
  const row = screen
    .getByRole("button", { name: "table.save" })
    .closest("tr");
  if (!row) throw new Error("No row is being edited");
  return row;
}

beforeEach(() => {
  auth.roles = ["office"];
  tenantSettings.usesHrSystem = false;
  serverEmployees = [ANNA, BEN, CARLA];
  staffApi.listEmployees
    .mockReset()
    .mockImplementation(async () => [...serverEmployees]);
  staffApi.createEmployee
    .mockReset()
    .mockImplementation(async (payload: Employee) => ({
      ...payload,
      id: "emp-new",
      can_be_deleted: true,
    }));
  staffApi.updateEmployee
    .mockReset()
    .mockImplementation(async (id: string, payload: Employee) => ({
      ...payload,
      id,
    }));
  staffApi.deleteEmployee.mockReset().mockImplementation(async (id: string) => {
    serverEmployees = serverEmployees.filter((row) => row.id !== id);
  });
  staffApi.syncFromHrSystem.mockReset();
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ListEmployees", () => {
  it("loads every employee, active or not, with one unfiltered request", async () => {
    renderList();

    await screen.findByText("Anna");
    expect(staffApi.listEmployees).toHaveBeenCalledTimes(1);
    expect(staffApi.listEmployees).toHaveBeenCalledWith(undefined);
  });

  it("shows the weekly hours where they are set", async () => {
    serverEmployees = [{ ...ANNA, hours_per_week: 24 }, BEN];
    renderList();
    await screen.findByText("Anna");

    expect(within(rowOf("Anna")).getByText("staff.hours_value")).toBeVisible();
    expect(
      within(rowOf("Ben")).queryByText("staff.hours_value"),
    ).not.toBeInTheDocument();
  });

  it("shows a spinner over the table while the employees load", async () => {
    let deliver: (rows: Employee[]) => void = () => {};
    staffApi.listEmployees.mockImplementation(
      () =>
        new Promise<Employee[]>((resolve) => {
          deliver = resolve;
        }),
    );
    renderList();

    expect(document.querySelector(".ant-spin-spinning")).toBeInTheDocument();

    deliver([ANNA, BEN]);

    expect(await screen.findByText("Anna")).toBeInTheDocument();
    // AntD's Spin turns itself off in an effect, a render after the rows.
    await waitFor(() =>
      expect(document.querySelector(".ant-spin-spinning")).not.toBeInTheDocument(),
    );
  });

  it("shows the title, the column headings and the explainer", async () => {
    renderList();
    await screen.findByText("Anna");

    expect(
      screen.getByRole("heading", { level: 1, name: "staff.employees" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: /commissioning\.is_active/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", {
        name: "staff.short_name_for_weekly_plan",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("explainers.list_employees")).toBeInTheDocument();
  });

  it("lists the active employees and reveals inactive ones when asked", async () => {
    const { user } = renderList();
    await screen.findByText("Anna");

    expect(screen.getByText("Ben")).toBeInTheDocument();
    expect(screen.queryByText("Carla")).not.toBeInTheDocument();

    await user.click(screen.getByText("commissioning.hide_inactive"));

    expect(screen.getByText("Carla")).toBeInTheDocument();
  });

  it("creates an employee from the new row, active by default", async () => {
    const { user } = renderList();
    await screen.findByText("Anna");

    await user.click(screen.getByRole("button", { name: /table\.add_record/ }));
    await user.type(within(editingRow()).getByRole("textbox", { name: NAME }), "Dora");
    await user.click(screen.getByRole("button", { name: "table.save" }));

    await waitFor(() => expect(staffApi.createEmployee).toHaveBeenCalledTimes(1));
    expect(staffApi.createEmployee).toHaveBeenCalledWith(
      expect.objectContaining({
        is_active: true,
        short_name_for_weekly_plan: "Dora",
      }),
    );
    expect(await screen.findByText("Dora")).toBeInTheDocument();
  });

  it("saves a renamed employee under their id", async () => {
    const { user } = renderList();
    await screen.findByText("Anna");

    await user.click(
      within(rowOf("Ben")).getByRole("button", { name: "table.edit" }),
    );
    const nameInput = within(editingRow()).getByRole("textbox", { name: NAME });
    await user.clear(nameInput);
    await user.type(nameInput, "Benno");
    await user.click(screen.getByRole("button", { name: "table.save" }));

    await waitFor(() =>
      expect(staffApi.updateEmployee).toHaveBeenCalledWith(
        "emp-ben",
        expect.objectContaining({
          is_active: true,
          short_name_for_weekly_plan: "Benno",
        }),
      ),
    );
    expect(await screen.findByText("Benno")).toBeInTheDocument();
  });

  it("sends is_active false when an employee is deactivated", async () => {
    const { user } = renderList();
    await screen.findByText("Anna");

    await user.click(
      within(rowOf("Ben")).getByRole("button", { name: "table.edit" }),
    );
    await user.click(within(editingRow()).getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "table.save" }));

    await waitFor(() =>
      expect(staffApi.updateEmployee).toHaveBeenCalledWith(
        "emp-ben",
        expect.objectContaining({ is_active: false }),
      ),
    );
  });

  it("refuses a weekly-plan name another employee already uses", async () => {
    const { user } = renderList();
    await screen.findByText("Anna");

    await user.click(
      within(rowOf("Ben")).getByRole("button", { name: "table.edit" }),
    );
    const nameInput = within(editingRow()).getByRole("textbox", { name: NAME });
    await user.clear(nameInput);
    await user.type(nameInput, "Anna");
    await user.click(screen.getByRole("button", { name: "table.save" }));

    expect(
      await screen.findByText("validation.unique.name — table.save_failed_hint"),
    ).toBeInTheDocument();
    expect(staffApi.updateEmployee).not.toHaveBeenCalled();
  });

  it("deletes an employee after confirmation and reloads the list", async () => {
    const { user } = renderList();
    await screen.findByText("Anna");

    await user.click(
      within(rowOf("Ben")).getByRole("button", { name: "table.delete" }),
    );
    await user.click(await screen.findByRole("button", { name: "table.yes" }));

    await waitFor(() =>
      expect(staffApi.deleteEmployee).toHaveBeenCalledWith("emp-ben"),
    );
    await waitFor(() => expect(staffApi.listEmployees).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("Ben")).not.toBeInTheDocument();
    expect(screen.getByText("Anna")).toBeInTheDocument();
  });

  it("offers no delete for an employee the backend reports as in use", async () => {
    renderList();
    await screen.findByText("Anna");

    const annaRow = rowOf("Anna");
    expect(
      within(annaRow).getByRole("button", { name: "table.edit" }),
    ).toBeEnabled();
    expect(
      within(annaRow).queryByRole("button", { name: "table.delete" }),
    ).not.toBeInTheDocument();
  });
});

describe("ListEmployees with the HR system", () => {
  // Dora came from the HR system; Anna and Ben were entered here.
  const DORA = employee({
    id: "emp-dora",
    short_name_for_weekly_plan: "Dora",
    first_name: "Dora",
    last_name: "Lang",
    comes_from_hr_system: true,
    hr_system_id: "hr-4",
  });

  beforeEach(() => {
    tenantSettings.usesHrSystem = true;
    serverEmployees = [ANNA, BEN, DORA];
  });

  it("shows neither the HR-system column nor the sync without the setting", async () => {
    tenantSettings.usesHrSystem = false;
    renderList();
    await screen.findByText("Anna");

    expect(
      screen.queryByRole("columnheader", { name: "staff.comes_from_hr_system" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /staff\.sync_from_hr_system/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("explainers.list_employees")).toBeInTheDocument();
  });

  it("shows which employees come from the HR system", async () => {
    renderList();
    await screen.findByText("Dora");

    expect(
      screen.getByRole("columnheader", { name: "staff.comes_from_hr_system" }),
    ).toBeInTheDocument();
    // Each row shows "active" first, then "from the HR system".
    const fromHrSystem = (name: string) =>
      within(rowOf(name)).getAllByRole("checkbox")[1];
    expect(fromHrSystem("Dora")).toBeChecked();
    expect(fromHrSystem("Ben")).not.toBeChecked();
    expect(
      screen.getByText("explainers.list_employees_hr_system"),
    ).toBeInTheDocument();
  });

  it("offers the sync as a magenta button", async () => {
    renderList();
    await screen.findByText("Ben");

    expect(
      screen.getByRole("button", { name: /staff\.sync_from_hr_system/ }),
    ).toHaveClass("ant-btn-color-magenta", "ant-btn-variant-solid");
  });

  it("syncs with the HR system, reports the counts and reloads the list", async () => {
    staffApi.syncFromHrSystem.mockImplementation(async () => {
      serverEmployees = [
        ...serverEmployees,
        employee({
          id: "emp-emil",
          short_name_for_weekly_plan: "Emil",
          comes_from_hr_system: true,
          hr_system_id: "hr-5",
        }),
      ];
      return { created: 1, updated: 0, deactivated: 0 };
    });
    const { user } = renderList();
    await screen.findByText("Ben");

    await user.click(
      screen.getByRole("button", { name: /staff\.sync_from_hr_system/ }),
    );

    expect(await screen.findByText("Emil")).toBeInTheDocument();
    expect(staffApi.syncFromHrSystem).toHaveBeenCalledTimes(1);
    expect(staffApi.syncFromHrSystem).toHaveBeenCalledWith({});
    expect(staffApi.listEmployees).toHaveBeenCalledTimes(2);
    expect(
      await screen.findByText("staff.hr_system_synced"),
    ).toBeInTheDocument();
  });

  it("asks before deactivating more than half, and syncs once confirmed", async () => {
    staffApi.syncFromHrSystem
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
      .mockResolvedValueOnce({ created: 0, updated: 0, deactivated: 2 });
    const { user } = renderList();
    await screen.findByText("Ben");

    await user.click(
      screen.getByRole("button", { name: /staff\.sync_from_hr_system/ }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("staff.hr_system_mass_deactivation_text"),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "staff.hr_system_deactivate" }),
    );

    await waitFor(() =>
      expect(staffApi.syncFromHrSystem).toHaveBeenLastCalledWith({
        confirm_deactivations: true,
      }),
    );
    expect(
      await screen.findByText("staff.hr_system_synced"),
    ).toBeInTheDocument();
  });

  it("deactivates nobody when the question is cancelled", async () => {
    staffApi.syncFromHrSystem.mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 409,
        data: {
          code: "staff.hr_system_mass_deactivation",
          message: "The sync would deactivate 2 of the 3 active employees.",
          details: { employees: ["Anna", "Ben"] },
        },
      },
    });
    const { user } = renderList();
    await screen.findByText("Ben");

    await user.click(
      screen.getByRole("button", { name: /staff\.sync_from_hr_system/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "common.cancel" }),
    );

    expect(staffApi.syncFromHrSystem).toHaveBeenCalledTimes(1);
  });

  it("offers no delete for a synced employee, whom the next sync would add back", async () => {
    renderList();
    await screen.findByText("Dora");

    expect(
      within(rowOf("Dora")).queryByRole("button", { name: "table.delete" }),
    ).not.toBeInTheDocument();
    expect(
      within(rowOf("Ben")).getByRole("button", { name: "table.delete" }),
    ).toBeEnabled();
  });

  it("keeps the name and the active flag of a synced employee from edits, not its hours", async () => {
    const { user } = renderList();
    await screen.findByText("Dora");

    await user.click(
      within(rowOf("Dora")).getByRole("button", { name: "table.edit" }),
    );

    // A locked cell shows its value instead of an input.
    expect(
      within(editingRow()).queryByRole("textbox", { name: NAME }),
    ).not.toBeInTheDocument();
    expect(within(editingRow()).getByText("Dora")).toBeInTheDocument();
    for (const checkbox of within(editingRow()).getAllByRole("checkbox")) {
      expect(checkbox).toBeDisabled();
    }
    expect(
      within(editingRow()).getByRole("textbox", { name: "staff.weekly_hours" }),
    ).toBeEnabled();
  });

  it("lets an employee entered here be edited, but not marked as from the HR system", async () => {
    const { user } = renderList();
    await screen.findByText("Ben");

    await user.click(
      within(rowOf("Ben")).getByRole("button", { name: "table.edit" }),
    );

    expect(within(editingRow()).getByRole("textbox", { name: NAME })).toBeEnabled();
    const [isActive, fromHrSystem] = within(editingRow()).getAllByRole(
      "checkbox",
    );
    expect(isActive).toBeEnabled();
    expect(fromHrSystem).toBeDisabled();
  });

  it("offers the sync only to the office", async () => {
    auth.roles = ["gardener"];
    renderList();
    await screen.findByText("Ben");

    expect(
      screen.queryByRole("button", { name: /staff\.sync_from_hr_system/ }),
    ).not.toBeInTheDocument();
  });
});

describe("ListEmployees role gating", () => {
  it.each([{ roles: ["office"] }, { roles: ["admin"] }])(
    "lets $roles add, edit and delete employees",
    async ({ roles }) => {
      auth.roles = roles;
      renderList();
      await screen.findByText("Anna");

      expect(
        screen.getByRole("button", { name: /table\.add_record/ }),
      ).toBeEnabled();
      expect(
        within(rowOf("Ben")).getByRole("button", { name: "table.edit" }),
      ).toBeEnabled();
      expect(
        within(rowOf("Ben")).getByRole("button", { name: "table.delete" }),
      ).toBeEnabled();
    },
  );

  it.each([
    { roles: ["gardener"] },
    { roles: ["staff"] },
    { roles: ["management"] },
  ])("shows the employees read-only to $roles", async ({ roles }) => {
    auth.roles = roles;
    const { user } = renderList();
    await screen.findByText("Anna");

    expect(
      screen.queryByRole("button", { name: /table\.add_record/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "table.delete" }),
    ).not.toBeInTheDocument();
    for (const editButton of screen.queryAllByRole("button", {
      name: "table.edit",
    })) {
      expect(editButton).toBeDisabled();
    }

    await user.click(screen.getByText("Ben"));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "table.save" }),
    ).not.toBeInTheDocument();
  });
});
