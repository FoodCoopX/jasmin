/**
 * The super-admin tenant page: the tenant's details and its active switch,
 * the users with their inline role editor, the rate limits, and the
 * create-user and create-admin modals. Super-admin endpoints have no
 * generated client, so the shared axios instance is the boundary mocked here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const { api, notify } = vi.hoisted(() => ({
  api: { get: vi.fn(), patch: vi.fn(), post: vi.fn() },
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@shared/services/api", () => ({ default: api }));
vi.mock("@shared/utils", () => ({ notify }));

import TenantDetail from "../TenantDetail";

const TENANT_URL = "/api/super-admin/tenants/t-1/";
const USERS_URL = "/api/super-admin/tenants/t-1/users/";

interface TenantUserFixture {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  roles: string[];
  is_active: boolean;
  account_status: string;
  date_joined: string;
  last_login: string | null;
}

interface TenantFixture {
  id: number;
  schema_name: string;
  name: string;
  tenant_language: string | null;
  created_on: string;
  is_active: boolean;
  domains: { domain: string; is_primary: boolean }[];
  action_rate_limit_defaults: {
    action: string;
    display_name: string;
    weekly: number;
    per_minute: number;
  }[];
  action_rate_limit_overrides: Record<
    string,
    Partial<Record<"weekly" | "per_minute", number>>
  >;
}

function makeTenant(overrides: Partial<TenantFixture> = {}): TenantFixture {
  return {
    id: 7,
    schema_name: "farm_north",
    name: "North Farm",
    tenant_language: "de",
    created_on: "2025-03-10T12:00:00Z",
    is_active: true,
    domains: [
      { domain: "north.example.org", is_primary: true },
      { domain: "farm-north.example.org", is_primary: false },
    ],
    action_rate_limit_defaults: [
      {
        action: "invoice_finalization",
        display_name: "Invoice finalization",
        weekly: 300,
        per_minute: 20,
      },
      {
        action: "member_creation",
        display_name: "Member creation",
        weekly: 1000,
        per_minute: 30,
      },
    ],
    action_rate_limit_overrides: { invoice_finalization: { per_minute: 10 } },
    ...overrides,
  };
}

function makeUser(
  overrides: Partial<TenantUserFixture> = {},
): TenantUserFixture {
  return {
    id: "u-9",
    first_name: "Sam",
    last_name: "Sample",
    email: "sam@north.example.org",
    roles: ["member"],
    is_active: true,
    account_status: "active",
    date_joined: "2025-04-01T12:00:00Z",
    last_login: null,
    ...overrides,
  };
}

const ADA = makeUser({
  id: "u-1",
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@north.example.org",
  roles: ["admin", "office"],
  is_active: true,
  account_status: "active",
  date_joined: "2025-03-11T12:00:00Z",
  last_login: "2026-09-30T12:00:00Z",
});

const OLLY = makeUser({
  id: "u-2",
  first_name: "Olly",
  last_name: "Olsen",
  email: "olly@north.example.org",
  roles: ["member"],
  is_active: false,
  account_status: "pending_approval",
  date_joined: "2025-06-01T12:00:00Z",
  last_login: null,
});

// What the mocked backend currently returns; a test changes it to simulate a
// server-side change that a refetch then picks up.
let backend: {
  tenant: TenantFixture;
  users: { admin_users: TenantUserFixture[]; other_users: TenantUserFixture[] };
};

function serveGets(overrides: Record<string, () => Promise<unknown>> = {}) {
  api.get.mockImplementation((url: string) => {
    const override = overrides[url];
    if (override) return override();
    if (url === TENANT_URL) return Promise.resolve({ data: backend.tenant });
    if (url === USERS_URL) return Promise.resolve({ data: backend.users });
    return Promise.reject(new Error(`Unexpected GET ${url}`));
  });
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function apiError(message: string, status = 400) {
  return {
    isAxiosError: true,
    response: { status, data: { code: "validation_error", message } },
  };
}

function getCalls(url: string): number {
  return api.get.mock.calls.filter(([calledUrl]) => calledUrl === url).length;
}

beforeEach(() => {
  backend = {
    tenant: makeTenant(),
    users: { admin_users: [ADA], other_users: [OLLY] },
  };
  api.get.mockReset();
  serveGets();
  api.patch.mockReset().mockResolvedValue({ data: {} });
  api.post.mockReset().mockResolvedValue({ data: {} });
  Object.values(notify).forEach((fn) => fn.mockReset());
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/tenants/t-1"]}>
        <Routes>
          <Route path="/tenants/:id" element={<TenantDetail />} />
          <Route path="/" element={<p data-testid="dashboard" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function findTitle() {
  return screen.findByRole("heading", { level: 1, name: "North Farm" });
}

/** The value next to a "Label:" in the tenant details grid. */
function detailValue(label: string): HTMLElement {
  return screen.getByText(`${label}:`).nextElementSibling as HTMLElement;
}

async function findUserRow(email: string): Promise<HTMLElement> {
  return (await screen.findByText(email)).closest("tr") as HTMLElement;
}

/** The admin-users and other-users tables, in page order. */
function userTables(): HTMLElement[] {
  return screen
    .getAllByRole("table")
    .filter((table) =>
      within(table).queryByRole("columnheader", { name: "Email" }),
    );
}

/** The modals' labels are not tied to their inputs, so look inside the group. */
function fieldIn(dialog: HTMLElement, label: string): HTMLInputElement {
  const input = within(dialog)
    .getByText(label)
    .closest(".sa-form-group")
    ?.querySelector("input");
  if (!input) throw new Error(`No input under "${label}"`);
  return input;
}

describe("TenantDetail loading", () => {
  it("shows a loading text until the tenant arrives", async () => {
    const tenant = deferred();
    serveGets({ [TENANT_URL]: () => tenant.promise });
    renderPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();

    tenant.resolve({ data: backend.tenant });
    expect(await findTitle()).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("loads the tenant and its users for the id in the address", async () => {
    renderPage();
    await findUserRow(ADA.email);

    expect(api.get).toHaveBeenCalledWith(TENANT_URL);
    expect(api.get).toHaveBeenCalledWith(USERS_URL);
  });

  it("says the tenant was not found when it cannot be loaded", async () => {
    serveGets({
      [TENANT_URL]: () => Promise.reject(apiError("Not found.", 404)),
    });
    renderPage();

    expect(await screen.findByText("Tenant not found")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
  });

  it("says why the tenant could not be loaded and loads it on retry", async () => {
    serveGets({
      [TENANT_URL]: () => Promise.reject(apiError("Schema is migrating.", 503)),
    });
    const user = userEvent.setup();
    renderPage();

    const failure = await screen.findByRole("alert");
    expect(failure).toHaveTextContent("Schema is migrating.");
    expect(screen.queryByText("Tenant not found")).not.toBeInTheDocument();

    serveGets();
    await user.click(within(failure).getByRole("button", { name: "Retry" }));

    expect(await findTitle()).toBeInTheDocument();
  });

  it("goes back to the dashboard", async () => {
    const user = userEvent.setup();
    renderPage();

    await findTitle();
    await user.click(screen.getByRole("button", { name: "← Back" }));

    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
  });
});

describe("TenantDetail details", () => {
  it("shows the tenant's schema, name, creation time and main language", async () => {
    renderPage();
    await findTitle();

    expect(detailValue("Schema Name")).toHaveTextContent("farm_north");
    expect(detailValue("Name")).toHaveTextContent("North Farm");
    expect(detailValue("Created")).toHaveTextContent(
      new Date("2025-03-10T12:00:00Z").toLocaleString(),
    );
    expect(detailValue("Main Language").textContent).toBe("de");
  });

  it("shows a dash when the tenant has no main language", async () => {
    backend.tenant = makeTenant({ tenant_language: null });
    renderPage();
    await findTitle();

    expect(detailValue("Main Language").textContent).toBe("—");
  });

  it("lists the domains and marks only the primary one", async () => {
    renderPage();
    await findTitle();

    const primary = screen
      .getByText("north.example.org")
      .closest(".sa-domain-row") as HTMLElement;
    const secondary = screen
      .getByText("farm-north.example.org")
      .closest(".sa-domain-row") as HTMLElement;
    expect(within(primary).getByText("Primary")).toBeInTheDocument();
    expect(within(secondary).queryByText("Primary")).not.toBeInTheDocument();
  });

  it("shows the rate-limit defaults with the tenant's overrides filled in", async () => {
    renderPage();
    await findTitle();

    expect(
      screen.getByLabelText("Invoice finalization: per minute"),
    ).toHaveValue(10);
    expect(screen.getByLabelText("Member creation: per week")).toHaveValue(
      null,
    );
    expect(screen.getByLabelText("Member creation: per week")).toHaveAttribute(
      "placeholder",
      "1000 (default)",
    );
  });

  it("reloads the tenant after its rate limits are saved", async () => {
    const user = userEvent.setup();
    renderPage();
    await findTitle();

    await user.type(screen.getByLabelText("Member creation: per week"), "500");
    await user.click(screen.getByRole("button", { name: "Save rate limits" }));

    expect(api.patch).toHaveBeenCalledWith(TENANT_URL, {
      action_rate_limit_overrides: {
        invoice_finalization: { per_minute: 10 },
        member_creation: { weekly: 500 },
      },
    });
    await waitFor(() => expect(getCalls(TENANT_URL)).toBe(2));
    expect(notify.success).toHaveBeenCalledWith("Rate limits saved");
  });
});

describe("TenantDetail active switch", () => {
  it.each([
    {
      isActive: true,
      badge: "Active",
      badgeClass: "sa-badge--active",
      action: "Deactivate",
      actionClass: "sa-btn--danger",
    },
    {
      isActive: false,
      badge: "Inactive",
      badgeClass: "sa-badge--inactive",
      action: "Activate",
      actionClass: "sa-btn--success",
    },
  ])(
    "shows an $badge badge and offers to $action",
    async ({ isActive, badge, badgeClass, action, actionClass }) => {
      backend.tenant = makeTenant({ is_active: isActive });
      renderPage();
      await findTitle();

      const status = detailValue("Status");
      expect(within(status).getByText(badge)).toHaveClass(
        "sa-badge",
        badgeClass,
      );
      const button = within(status).getByRole("button", { name: action });
      expect(button).toBeEnabled();
      expect(button).toHaveClass(actionClass);
    },
  );

  it("asks before deactivating and changes nothing when the super-admin cancels", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Deactivate" }));

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain('Deactivate "North Farm"?');
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeEnabled();
  });

  it("deactivates the tenant after confirmation and shows the reloaded state", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const patch = deferred();
    api.patch.mockReturnValue(patch.promise);
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Deactivate" }));

    expect(api.patch).toHaveBeenCalledWith(TENANT_URL, { is_active: false });
    expect(screen.getByRole("button", { name: "..." })).toBeDisabled();

    backend.tenant = makeTenant({ is_active: false });
    patch.resolve({ data: {} });

    expect(
      await screen.findByRole("button", { name: "Activate" }),
    ).toBeEnabled();
    expect(within(detailValue("Status")).getByText("Inactive")).toHaveClass(
      "sa-badge--inactive",
    );
    expect(getCalls(TENANT_URL)).toBe(2);
  });

  it("activates an inactive tenant without asking", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    backend.tenant = makeTenant({ is_active: false });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Activate" }));

    expect(confirm).not.toHaveBeenCalled();
    expect(api.patch).toHaveBeenCalledWith(TENANT_URL, { is_active: true });
  });

  it("reports a failed switch and leaves the tenant as it was", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    api.patch.mockRejectedValue(apiError("The tenant is being migrated."));
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "Deactivate" }));

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("The tenant is being migrated."),
    );
    expect(
      await screen.findByRole("button", { name: "Deactivate" }),
    ).toBeEnabled();
    expect(
      within(detailValue("Status")).getByText("Active"),
    ).toBeInTheDocument();
    expect(getCalls(TENANT_URL)).toBe(1);
  });
});

describe("TenantDetail users", () => {
  it("shows a loading text until the users arrive", async () => {
    const users = deferred();
    serveGets({ [USERS_URL]: () => users.promise });
    renderPage();

    expect(await screen.findByText("Loading users...")).toBeInTheDocument();

    users.resolve({ data: backend.users });
    expect(await screen.findByText(ADA.email)).toBeInTheDocument();
    expect(screen.queryByText("Loading users...")).not.toBeInTheDocument();
  });

  it("says why the users could not be loaded instead of listing none", async () => {
    serveGets({
      [USERS_URL]: () => Promise.reject(apiError("Tenant schema unavailable.", 500)),
    });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Tenant schema unavailable.",
    );
    expect(screen.queryByText("No admin users found")).not.toBeInTheDocument();
  });

  it("lists admin users and other users in separate tables", async () => {
    renderPage();
    await findUserRow(ADA.email);

    const [adminTable, otherTable] = userTables();
    expect(within(adminTable).getByText(ADA.email)).toBeInTheDocument();
    expect(within(adminTable).queryByText(OLLY.email)).not.toBeInTheDocument();
    expect(within(otherTable).getByText(OLLY.email)).toBeInTheDocument();
    expect(within(otherTable).queryByText(ADA.email)).not.toBeInTheDocument();
  });

  it("shows an active user's name, roles, status, join date and last login", async () => {
    renderPage();
    const row = await findUserRow(ADA.email);

    expect(within(row).getByText("Ada Lovelace")).toBeInTheDocument();
    expect(within(row).getByText("admin")).toHaveClass("sa-role-chip");
    expect(within(row).getByText("office")).toHaveClass("sa-role-chip");
    expect(within(row).getByText("active")).toHaveClass("sa-status-pill");
    expect(within(row).getByTitle("Active")).toHaveClass("sa-status-dot--on");
    expect(
      within(row).getByText(
        new Date("2025-03-11T12:00:00Z").toLocaleDateString(),
      ),
    ).toBeInTheDocument();
    expect(
      within(row).getByText(
        new Date("2026-09-30T12:00:00Z").toLocaleDateString(),
      ),
    ).toBeInTheDocument();
  });

  it("marks an inactive user and shows N/A for a user who never logged in", async () => {
    renderPage();
    const row = await findUserRow(OLLY.email);

    expect(within(row).getByTitle("Inactive")).toHaveClass(
      "sa-status-dot--off",
    );
    expect(within(row).getByText("pending_approval")).toBeInTheDocument();
    expect(within(row).getByText("N/A")).toBeInTheDocument();
  });

  it("says when a user has no roles", async () => {
    backend.users = {
      admin_users: [ADA],
      other_users: [makeUser({ roles: [] })],
    };
    renderPage();
    const row = await findUserRow("sam@north.example.org");

    expect(within(row).getByText("No roles")).toBeInTheDocument();
  });

  it("says when the tenant has no admin users and no other users", async () => {
    backend.users = { admin_users: [], other_users: [] };
    renderPage();

    expect(await screen.findByText("No admin users found")).toBeInTheDocument();
    expect(screen.getByText("No other users found")).toBeInTheDocument();
    expect(userTables()).toHaveLength(0);
  });

  it.each([
    {
      status: "active",
      background: "var(--color-success-bg)",
      color: "var(--color-share-content)",
    },
    {
      status: "pending_approval",
      background: "var(--color-warning-bg)",
      color: "var(--color-warning-text)",
    },
    {
      status: "pending_invitation",
      background: "var(--color-info-bg)",
      color: "var(--color-info-text)",
    },
    {
      status: "inactive",
      background: "var(--color-error-bg)",
      color: "var(--color-error-text)",
    },
  ])(
    "shows the $status account status in its colours",
    async ({ status, background, color }) => {
      backend.users = {
        admin_users: [],
        other_users: [makeUser({ account_status: status })],
      };
      renderPage();
      const row = await findUserRow("sam@north.example.org");

      expect(within(row).getByText(status)).toHaveStyle({ background, color });
    },
  );

  it("shows an unknown account status in the inactive colours", async () => {
    backend.users = {
      admin_users: [],
      other_users: [makeUser({ account_status: "locked" })],
    };
    renderPage();
    const row = await findUserRow("sam@north.example.org");

    expect(within(row).getByText("locked")).toHaveStyle({
      background: "var(--color-error-bg)",
      color: "var(--color-error-text)",
    });
  });
});

describe("TenantDetail role editing", () => {
  async function openRoleEditor(email: string) {
    const user = userEvent.setup();
    renderPage();
    const row = await findUserRow(email);
    await user.click(within(row).getByTitle("Click to edit roles"));
    return { user, row };
  }

  it("opens a role editor with the user's roles ticked and without the customer role", async () => {
    const { row } = await openRoleEditor(OLLY.email);

    expect(
      within(row).getByRole("checkbox", { name: "member" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      within(row).getByRole("checkbox", { name: "office" }),
    ).toHaveAttribute("aria-checked", "false");
    const offered = within(row)
      .getAllByRole("checkbox")
      .map((chip) => chip.textContent);
    expect(offered).toEqual(expect.arrayContaining(["admin", "office"]));
    expect(offered).not.toContain("customer");
  });

  it("saves the picked roles for that user and shows the reloaded roles", async () => {
    const patch = deferred();
    api.patch.mockReturnValue(patch.promise);
    const { user, row } = await openRoleEditor(OLLY.email);

    await user.click(within(row).getByRole("checkbox", { name: "office" }));
    await user.click(within(row).getByRole("checkbox", { name: "member" }));
    await user.click(within(row).getByRole("button", { name: "✓" }));

    expect(api.patch).toHaveBeenCalledWith(
      "/api/super-admin/tenants/t-1/users/u-2/roles/",
      { roles: ["office"] },
    );
    expect(within(row).getByRole("button", { name: "..." })).toBeDisabled();

    backend.users = {
      admin_users: [ADA],
      other_users: [{ ...OLLY, roles: ["office"] }],
    };
    patch.resolve({ data: {} });

    await waitFor(() =>
      expect(within(row).queryAllByRole("checkbox")).toHaveLength(0),
    );
    await waitFor(() =>
      expect(within(row).getByText("office")).toHaveClass("sa-role-chip"),
    );
    expect(within(row).queryByText("member")).not.toBeInTheDocument();
    expect(getCalls(USERS_URL)).toBe(2);
  });

  it("discards the picked roles on cancel", async () => {
    const { user, row } = await openRoleEditor(OLLY.email);

    await user.click(within(row).getByRole("checkbox", { name: "office" }));
    await user.click(within(row).getByRole("button", { name: "✕" }));

    expect(within(row).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(row).getByText("member")).toHaveClass("sa-role-chip");
    expect(within(row).queryByText("office")).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("reports a failed role update and keeps the editor open", async () => {
    api.patch.mockRejectedValue(apiError("A user needs at least one role."));
    const { user, row } = await openRoleEditor(OLLY.email);

    await user.click(within(row).getByRole("checkbox", { name: "member" }));
    await user.click(within(row).getByRole("button", { name: "✓" }));

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        "A user needs at least one role.",
      ),
    );
    expect(
      await within(row).findByRole("button", { name: "✓" }),
    ).toBeEnabled();
    expect(
      within(row).getByRole("checkbox", { name: "member" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(getCalls(USERS_URL)).toBe(1);
  });
});

describe("TenantDetail user creation", () => {
  it("opens the create-user modal and closes it on cancel", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "+ Create User" }));
    const dialog = screen.getByRole("dialog", { name: "Create User" });
    expect(
      within(dialog).getByRole("checkbox", { name: "office" }),
    ).toHaveAttribute("aria-checked", "false");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("creates a user with the picked roles in this tenant and reloads the users", async () => {
    api.post.mockResolvedValue({ data: { message: "User created." } });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "+ Create User" }));
    const dialog = screen.getByRole("dialog", { name: "Create User" });
    await user.type(fieldIn(dialog, "First Name *"), "Nina");
    await user.type(fieldIn(dialog, "Last Name *"), "Novak");
    await user.type(fieldIn(dialog, "Email *"), "nina@north.example.org");
    await user.type(fieldIn(dialog, "Password *"), "correct-horse-battery");
    await user.click(within(dialog).getByRole("checkbox", { name: "office" }));
    await user.click(within(dialog).getByRole("checkbox", { name: "member" }));
    backend.users = {
      admin_users: [ADA],
      other_users: [
        OLLY,
        makeUser({ id: "u-3", email: "nina@north.example.org" }),
      ],
    };
    await user.click(within(dialog).getByRole("button", { name: "Create User" }));

    expect(api.post).toHaveBeenCalledWith(
      "/api/super-admin/tenants/t-1/create-user/",
      {
        first_name: "Nina",
        last_name: "Novak",
        email: "nina@north.example.org",
        password: "correct-horse-battery",
        roles: ["office", "member"],
      },
    );
    expect(await within(dialog).findByText("User created.")).toBeInTheDocument();
    // The modal closes itself 1.5 s after a successful creation.
    await waitFor(
      () => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(await findUserRow("nina@north.example.org")).toBeInTheDocument();
    expect(getCalls(USERS_URL)).toBe(2);
  });

  it("creates admins of this tenant through the create-admin modal and shows a refusal in it", async () => {
    api.post.mockRejectedValue(
      apiError("A user with this email already exists."),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "+ Create Admin User" }),
    );
    const dialog = screen.getByRole("dialog", { name: "Create Admin User" });
    await user.type(fieldIn(dialog, "First Name *"), "Ada");
    await user.type(fieldIn(dialog, "Last Name *"), "Lovelace");
    await user.type(fieldIn(dialog, "Email *"), ADA.email);
    await user.type(fieldIn(dialog, "Password *"), "analytical-engine");
    await user.click(within(dialog).getByRole("button", { name: "Create Admin" }));

    expect(api.post).toHaveBeenCalledWith(
      "/api/super-admin/tenants/t-1/create-admin/",
      {
        first_name: "Ada",
        last_name: "Lovelace",
        email: ADA.email,
        password: "analytical-engine",
      },
    );
    expect(
      await within(dialog).findByText("A user with this email already exists."),
    ).toBeInTheDocument();
    expect(getCalls(USERS_URL)).toBe(1);

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
