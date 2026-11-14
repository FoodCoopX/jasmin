// The absence-categories list renders through the real CrudListPage and
// EditableTable; only the generated staff client is replaced (the list hook by
// a real TanStack query around a spy).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AbsenceCategory,
  StaffAbsenceCategoriesListParams,
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

vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock();
  return { useTenant: () => tenant };
});

const staffApi = vi.hoisted(() => ({
  listAbsenceCategories: vi.fn(),
  createAbsenceCategory: vi.fn(),
  updateAbsenceCategory: vi.fn(),
  deleteAbsenceCategory: vi.fn(),
}));

vi.mock("@shared/api/generated/staff/staff", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@shared/api/generated/staff/staff")>();
  const { useQuery } = await import("@tanstack/react-query");
  return {
    ...actual,
    useStaffAbsenceCategoriesList: (
      params?: StaffAbsenceCategoriesListParams,
    ) =>
      useQuery({
        queryKey: actual.getStaffAbsenceCategoriesListQueryKey(params),
        queryFn: (): Promise<AbsenceCategory[]> =>
          staffApi.listAbsenceCategories(params),
      }),
    staffAbsenceCategoriesCreate: (category: AbsenceCategory) =>
      staffApi.createAbsenceCategory(category),
    staffAbsenceCategoriesPartialUpdate: (
      id: string,
      category: AbsenceCategory,
    ) => staffApi.updateAbsenceCategory(id, category),
    staffAbsenceCategoriesDestroy: (id: string) =>
      staffApi.deleteAbsenceCategory(id),
  };
});

import ListAbsenceCategory from "../ListAbsenceCategory";

// ── Fixtures ────────────────────────────────────────────────────────────────

// The default category stays: the backend marks it undeletable.
const ABSENCE: AbsenceCategory = {
  id: "abs-default",
  is_active: true,
  is_default: true,
  name: "Abwesenheit",
  can_be_deleted: false,
};
// Absences still point at the vacation category, so it is in use.
const VACATION: AbsenceCategory = {
  id: "abs-vacation",
  is_active: true,
  is_default: false,
  name: "Vacation",
  can_be_deleted: false,
};
const TRAINING: AbsenceCategory = {
  id: "abs-training",
  is_active: true,
  is_default: false,
  name: "Training",
  can_be_deleted: true,
};
const PARENTAL_LEAVE: AbsenceCategory = {
  id: "abs-parental",
  is_active: false,
  is_default: false,
  name: "Parental leave",
  can_be_deleted: true,
};

// What the server currently holds; the list request answers from it.
let serverCategories: AbsenceCategory[] = [];

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
      <ListAbsenceCategory />
    </QueryClientProvider>,
  );
  return { user };
}

function rowOf(text: string): HTMLElement {
  const row = screen.getByText(text).closest("tr");
  if (!row) throw new Error(`No table row shows ${text}`);
  return row;
}

function editingRow(): HTMLElement {
  const row = screen
    .getByRole("button", { name: "table.save" })
    .closest("tr");
  if (!row) throw new Error("No row is being edited");
  return row;
}

beforeEach(() => {
  auth.roles = ["office"];
  serverCategories = [ABSENCE, VACATION, TRAINING, PARENTAL_LEAVE];
  staffApi.listAbsenceCategories
    .mockReset()
    .mockImplementation(async () => [...serverCategories]);
  staffApi.createAbsenceCategory
    .mockReset()
    .mockImplementation(async (payload: AbsenceCategory) => ({
      ...payload,
      id: "abs-new",
      is_default: false,
      can_be_deleted: true,
    }));
  staffApi.updateAbsenceCategory
    .mockReset()
    .mockImplementation(async (id: string, payload: AbsenceCategory) => ({
      ...payload,
      id,
    }));
  staffApi.deleteAbsenceCategory
    .mockReset()
    .mockImplementation(async (id: string) => {
      serverCategories = serverCategories.filter((row) => row.id !== id);
    });
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("ListAbsenceCategory", () => {
  it("loads every category, active or not, with one unfiltered request", async () => {
    renderList();

    await screen.findByText("Vacation");
    expect(staffApi.listAbsenceCategories).toHaveBeenCalledTimes(1);
    expect(staffApi.listAbsenceCategories).toHaveBeenCalledWith(undefined);
  });

  it("shows the title, the description and the column headings, but no year", async () => {
    renderList();
    await screen.findByText("Vacation");

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "staff.absence_categories",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 5,
        name: "staff.absence_categories_description",
      }),
    ).toBeInTheDocument();
    for (const heading of [/commissioning\.is_active/, "staff.name"]) {
      expect(
        screen.getByRole("columnheader", { name: heading }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("columnheader", { name: "common.year" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("explainers.list_absence_categories"),
    ).toBeInTheDocument();
  });

  it("marks the default category, and lists inactive ones when asked", async () => {
    const { user } = renderList();
    await screen.findByText("Vacation");

    expect(
      screen.getByText("staff.absence_category_default"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Parental leave")).not.toBeInTheDocument();

    await user.click(screen.getByText("commissioning.hide_inactive"));

    expect(screen.getByText("Parental leave")).toBeInTheDocument();
  });

  it("creates a category by its name", async () => {
    const { user } = renderList();
    await screen.findByText("Vacation");

    await user.click(screen.getByRole("button", { name: /table\.add_record/ }));
    await user.type(within(editingRow()).getByRole("textbox"), "Illness");
    await user.click(screen.getByRole("button", { name: "table.save" }));

    await waitFor(() =>
      expect(staffApi.createAbsenceCategory).toHaveBeenCalledTimes(1),
    );
    const [payload] = staffApi.createAbsenceCategory.mock.calls[0];
    expect(payload).toMatchObject({ is_active: true, name: "Illness" });
    expect(payload).not.toHaveProperty("year");
    expect(await screen.findByText("Illness")).toBeInTheDocument();
  });

  it("refuses a second category with a name already taken", async () => {
    const { user } = renderList();
    await screen.findByText("Vacation");

    await user.click(screen.getByRole("button", { name: /table\.add_record/ }));
    await user.type(within(editingRow()).getByRole("textbox"), "Vacation");
    await user.click(screen.getByRole("button", { name: "table.save" }));

    expect(
      await screen.findByText(
        "staff.absence_category_name_unique — table.save_failed_hint",
      ),
    ).toBeInTheDocument();
    expect(staffApi.createAbsenceCategory).not.toHaveBeenCalled();
  });

  it("saves a renamed category under its id", async () => {
    const { user } = renderList();
    await screen.findByText("Vacation");

    await user.click(
      within(rowOf("Training")).getByRole("button", { name: "table.edit" }),
    );
    const name = within(editingRow()).getByRole("textbox");
    await user.clear(name);
    await user.type(name, "Course");
    await user.click(screen.getByRole("button", { name: "table.save" }));

    await waitFor(() =>
      expect(staffApi.updateAbsenceCategory).toHaveBeenCalledTimes(1),
    );
    const [id, payload] = staffApi.updateAbsenceCategory.mock.calls[0];
    expect(id).toBe("abs-training");
    expect(payload).toMatchObject({ is_active: true, name: "Course" });
    expect(await screen.findByText("Course")).toBeInTheDocument();
  });

  it("lets the default category be renamed, but not switched off", async () => {
    const { user } = renderList();
    await screen.findByText("Vacation");

    await user.click(
      within(rowOf("staff.absence_category_default")).getByRole("button", {
        name: "table.edit",
      }),
    );

    expect(within(editingRow()).getByRole("textbox")).toBeEnabled();
    expect(within(editingRow()).getByRole("checkbox")).toBeDisabled();
  });

  it("deletes an unused category after confirmation and reloads the list", async () => {
    const { user } = renderList();
    await screen.findByText("Vacation");

    await user.click(
      within(rowOf("Training")).getByRole("button", {
        name: "table.delete",
      }),
    );
    await user.click(await screen.findByRole("button", { name: "table.yes" }));

    await waitFor(() =>
      expect(staffApi.deleteAbsenceCategory).toHaveBeenCalledWith(
        "abs-training",
      ),
    );
    await waitFor(() =>
      expect(staffApi.listAbsenceCategories).toHaveBeenCalledTimes(2),
    );
    expect(screen.queryByText("Training")).not.toBeInTheDocument();
  });

  it("offers no delete for the default category or one that absences use", async () => {
    renderList();
    await screen.findByText("Vacation");

    for (const name of ["staff.absence_category_default", "Vacation"]) {
      expect(
        within(rowOf(name)).queryByRole("button", { name: "table.delete" }),
      ).not.toBeInTheDocument();
    }
    expect(
      within(rowOf("Training")).getByRole("button", {
        name: "table.delete",
      }),
    ).toBeInTheDocument();
  });
});

describe("ListAbsenceCategory role gating", () => {
  it.each([{ roles: ["office"] }, { roles: ["admin"] }])(
    "lets $roles add, edit and delete categories",
    async ({ roles }) => {
      auth.roles = roles;
      renderList();
      await screen.findByText("Vacation");

      expect(
        screen.getByRole("button", { name: /table\.add_record/ }),
      ).toBeEnabled();
      expect(
        within(rowOf("Training")).getByRole("button", { name: "table.edit" }),
      ).toBeEnabled();
      expect(
        within(rowOf("Training")).getByRole("button", {
          name: "table.delete",
        }),
      ).toBeEnabled();
    },
  );

  it.each([
    { roles: ["gardener"] },
    { roles: ["staff"] },
    { roles: ["management"] },
  ])("shows the categories read-only to $roles", async ({ roles }) => {
    auth.roles = roles;
    const { user } = renderList();
    await screen.findByText("Vacation");

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

    await user.click(screen.getByText("Training"));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
});
