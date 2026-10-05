/**
 * The super-admin support inbox: every tenant's tickets grouped by tenant, the
 * status filter, and a ticket's conversation with its status switch and reply
 * box. Super-admin endpoints have no generated client, so the shared axios
 * instance is the boundary mocked here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AdminTicketDetail,
  AdminTicketListRow,
} from "@features/platform/supportTickets";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const { api, notify, auth } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn() },
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  auth: {
    state: { loading: false, isAuthenticated: true, isSuperAdmin: true },
  },
}));
vi.mock("@shared/services/api", () => ({ default: api }));
vi.mock("@shared/utils", () => ({ notify }));
vi.mock("@shared/contexts/AuthContext", () => ({
  useAuth: () => auth.state,
}));

import SuperAdminSupportTickets from "../SuperAdminSupportTickets";

const LIST_URL = "/api/super-admin/support-tickets/";
const DETAIL_URL = "/api/super-admin/support-tickets/tk-1/";
const REPLY_URL = "/api/super-admin/support-tickets/tk-1/reply/";
const SET_STATUS_URL = "/api/super-admin/support-tickets/tk-1/set-status/";

function makeRow(
  overrides: Partial<AdminTicketListRow> = {},
): AdminTicketListRow {
  return {
    id: "tk-1",
    tenant_schema: "farm_north",
    tenant_name: "North Farm",
    subject: "Invoices do not send",
    status: "open",
    priority: "high",
    creator_name: "Olga Office",
    creator_email: "olga@north.example.org",
    created_at: "2026-09-28T08:00:00Z",
    updated_at: "2026-09-29T10:00:00Z",
    ...overrides,
  };
}

// In the order the server returns them; the page regroups and resorts them.
const ROWS: AdminTicketListRow[] = [
  makeRow(),
  makeRow({
    id: "tk-2",
    tenant_schema: "garden_south",
    tenant_name: "South Garden",
    subject: "Station map is wrong",
    status: "resolved",
    priority: "low",
    creator_name: "Sven Staff",
    updated_at: "2026-09-30T10:00:00Z",
  }),
  makeRow({
    id: "tk-3",
    subject: "Old export question",
    status: "closed",
    updated_at: "2026-10-01T10:00:00Z",
  }),
  makeRow({
    id: "tk-4",
    subject: "Delivery list is empty",
    status: "in_progress",
    updated_at: "2026-09-20T10:00:00Z",
  }),
  makeRow({
    id: "tk-5",
    subject: "Login loop on tablets",
    status: "open",
    updated_at: "2026-10-02T10:00:00Z",
  }),
  makeRow({
    id: "tk-6",
    tenant_schema: "farm_east",
    tenant_name: "",
    subject: "Logo upload fails",
    updated_at: "2026-09-25T10:00:00Z",
  }),
];

function makeDetail(
  overrides: Partial<AdminTicketDetail> = {},
): AdminTicketDetail {
  return {
    ...makeRow(),
    creator_id: "u-7",
    creator_roles: ["office"],
    context: {},
    resolved_at: null,
    messages: [
      {
        id: "m-1",
        author_kind: "staff",
        author_name: "Olga Office",
        body: "The invoice emails bounce.",
        created_at: "2026-09-28T08:00:00Z",
      },
      {
        id: "m-2",
        author_kind: "super_admin",
        author_name: "Sam Support",
        body: "Looking into it.",
        created_at: "2026-09-28T09:00:00Z",
      },
    ],
    ...overrides,
  };
}

// What the mocked backend currently holds; a test changes it to simulate a
// server-side change that a refetch then picks up.
let backend: { rows: AdminTicketListRow[]; detail: AdminTicketDetail };

function paginated(results: AdminTicketListRow[]) {
  return { count: results.length, next: null, previous: null, results };
}

function serveGets(overrides: Record<string, () => Promise<unknown>> = {}) {
  api.get.mockImplementation(
    (url: string, config?: { params?: { status?: string } }) => {
      const override = overrides[url];
      if (override) return override();
      if (url === LIST_URL) {
        const status = config?.params?.status;
        const results = status
          ? backend.rows.filter((row) => row.status === status)
          : backend.rows;
        return Promise.resolve({ data: paginated(results) });
      }
      if (url === DETAIL_URL) return Promise.resolve({ data: backend.detail });
      return Promise.reject(new Error(`Unexpected GET ${url}`));
    },
  );
}

function deferred<T = unknown>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function apiError(message: string) {
  return {
    isAxiosError: true,
    response: { status: 400, data: { code: "validation_error", message } },
  };
}

function getCalls(url: string): number {
  return api.get.mock.calls.filter(([calledUrl]) => calledUrl === url).length;
}

beforeEach(() => {
  auth.state = { loading: false, isAuthenticated: true, isSuperAdmin: true };
  backend = { rows: [...ROWS], detail: makeDetail() };
  api.get.mockReset();
  serveGets();
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
      <MemoryRouter initialEntries={["/support-tickets"]}>
        <Routes>
          <Route
            path="/support-tickets"
            element={<SuperAdminSupportTickets />}
          />
          <Route path="/login" element={<p data-testid="login-page" />} />
          <Route path="/" element={<p data-testid="dashboard" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function groupTitles(): string[] {
  return screen
    .getAllByRole("heading", { level: 3 })
    .map((heading) => heading.textContent ?? "");
}

/** One column of a tenant group's table, top to bottom. */
function columnOf(tenant: string, column: string): string[] {
  const group = screen
    .getByRole("heading", { level: 3, name: tenant })
    .closest(".sa-ticket-group") as HTMLElement;
  const index = within(group)
    .getAllByRole("columnheader")
    .map((header) => header.textContent)
    .indexOf(column);
  return within(group)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[index].textContent ?? "");
}

/** A ticket row's cells keyed by their column header. */
function rowCells(subject: string): Record<string, string> {
  const row = screen.getByText(subject).closest("tr") as HTMLElement;
  const headers = within(row.closest("table") as HTMLElement)
    .getAllByRole("columnheader")
    .map((header) => header.textContent ?? "");
  const cells = within(row).getAllByRole("cell");
  return Object.fromEntries(
    headers.map((header, index) => [header, cells[index].textContent ?? ""]),
  );
}

function statusFilter(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: "Filter by status" });
}

describe("SuperAdminSupportTickets access and navigation", () => {
  it.each([
    [
      "signed out",
      { loading: false, isAuthenticated: false, isSuperAdmin: false },
    ],
    [
      "signed in without super-admin rights",
      { loading: false, isAuthenticated: true, isSuperAdmin: false },
    ],
  ])(
    "sends a visitor who is %s to the login page without loading tickets",
    async (_who, state) => {
      auth.state = state;
      renderPage();

      expect(await screen.findByTestId("login-page")).toBeInTheDocument();
      expect(api.get).not.toHaveBeenCalled();
    },
  );

  it("neither redirects nor loads tickets while the session is being checked", () => {
    auth.state = { loading: true, isAuthenticated: false, isSuperAdmin: false };
    renderPage();

    expect(screen.queryByTestId("login-page")).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("goes back to the dashboard", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "← Dashboard" }));

    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
  });
});

describe("SuperAdminSupportTickets list", () => {
  it("shows a loading text until the tickets arrive", async () => {
    const list = deferred();
    serveGets({ [LIST_URL]: () => list.promise });
    renderPage();

    expect(screen.getByText("Loading tickets...")).toBeInTheDocument();

    list.resolve({ data: paginated(ROWS) });
    expect(
      await screen.findByRole("heading", { level: 3, name: "North Farm" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Loading tickets...")).not.toBeInTheDocument();
  });

  it("loads the tickets of every status by default", async () => {
    renderPage();
    await screen.findByText("Invoices do not send");

    expect(api.get).toHaveBeenCalledWith(LIST_URL, { params: undefined });
    expect(statusFilter()).toHaveValue("");
  });

  it("says so when there are no tickets", async () => {
    backend.rows = [];
    renderPage();

    expect(await screen.findByText("No support tickets.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("groups the tickets by tenant and names a group without a tenant name by its schema", async () => {
    renderPage();
    await screen.findByText("Invoices do not send");

    expect(groupTitles()).toEqual(["North Farm", "South Garden", "farm_east"]);
    expect(columnOf("farm_east", "subject")).toEqual(["Logo upload fails"]);
  });

  it("lists open tickets first and, within a status, the most recently updated first", async () => {
    renderPage();
    await screen.findByText("Invoices do not send");

    expect(columnOf("North Farm", "subject")).toEqual([
      "Login loop on tablets",
      "Invoices do not send",
      "Delivery list is empty",
      "Old export question",
    ]);
    expect(columnOf("North Farm", "status")).toEqual([
      "open",
      "open",
      "in progress",
      "closed",
    ]);
  });

  it("shows who opened a ticket, its priority and when it was last updated", async () => {
    renderPage();
    await screen.findByText("Station map is wrong");

    expect(rowCells("Station map is wrong")).toMatchObject({
      status: "resolved",
      from: "Sven Staff",
      priority: "low",
      updated: new Date("2026-09-30T10:00:00Z").toLocaleString("de-DE"),
    });
  });

  it.each([
    {
      status: "open",
      label: "open",
      background: "var(--color-info-bg)",
      color: "var(--color-info-text)",
    },
    {
      status: "in_progress",
      label: "in progress",
      background: "var(--color-warning-bg)",
      color: "var(--color-warning-text)",
    },
    {
      status: "resolved",
      label: "resolved",
      background: "var(--color-success-bg)",
      color: "var(--color-share-content)",
    },
    {
      status: "closed",
      label: "closed",
      background: "var(--color-bg-hover)",
      color: "var(--color-text-secondary)",
    },
  ])(
    "shows the $status status as a pill reading $label in its colours",
    async ({ status, label, background, color }) => {
      backend.rows = [makeRow({ status })];
      renderPage();
      const row = (await screen.findByText("Invoices do not send")).closest(
        "tr",
      ) as HTMLElement;

      const pill = within(row).getByText(label);
      expect(pill).toHaveClass("sa-status-pill");
      expect(pill).toHaveStyle({ background, color });
    },
  );

  it("shows an unknown status in the closed colours", async () => {
    backend.rows = [makeRow({ status: "on_hold" })];
    renderPage();
    const row = (await screen.findByText("Invoices do not send")).closest(
      "tr",
    ) as HTMLElement;

    expect(within(row).getByText("on hold")).toHaveStyle({
      background: "var(--color-bg-hover)",
      color: "var(--color-text-secondary)",
    });
  });
});

describe("SuperAdminSupportTickets status filter", () => {
  it("offers all statuses and each ticket status by a readable name", async () => {
    renderPage();
    await screen.findByText("Invoices do not send");

    const options = within(statusFilter()).getAllByRole("option");
    expect(
      options.map((option) => [option.getAttribute("value"), option.textContent]),
    ).toEqual([
      ["", "All statuses"],
      ["open", "open"],
      ["in_progress", "in progress"],
      ["resolved", "resolved"],
      ["closed", "closed"],
    ]);
  });

  it("asks the server for the chosen status only and lists what it returns", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Invoices do not send");

    await user.selectOptions(statusFilter(), "in_progress");

    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(LIST_URL, {
        params: { status: "in_progress" },
      }),
    );
    expect(
      await screen.findByText("Delivery list is empty"),
    ).toBeInTheDocument();
    expect(groupTitles()).toEqual(["North Farm"]);
    expect(columnOf("North Farm", "subject")).toEqual([
      "Delivery list is empty",
    ]);
    expect(statusFilter()).toHaveValue("in_progress");
  });

  it("keeps the list and the filter's focus while another status loads", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Invoices do not send");
    const pending = deferred();
    serveGets({ [LIST_URL]: () => pending.promise });

    await user.selectOptions(statusFilter(), "resolved");

    expect(screen.queryByText("Loading tickets...")).not.toBeInTheDocument();
    expect(screen.getByText("Invoices do not send")).toBeInTheDocument();
    expect(statusFilter()).toHaveFocus();
  });

  it("says why the tickets could not be loaded and loads them on retry", async () => {
    serveGets({ [LIST_URL]: () => Promise.reject(apiError("Database is down.")) });
    const user = userEvent.setup();
    renderPage();

    const failure = await screen.findByRole("alert");
    expect(failure).toHaveTextContent("Database is down.");
    expect(screen.queryByText("No support tickets.")).not.toBeInTheDocument();

    serveGets();
    await user.click(within(failure).getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Invoices do not send")).toBeInTheDocument();
  });

  it("lists every ticket again when the filter goes back to all statuses", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Invoices do not send");

    await user.selectOptions(statusFilter(), "resolved");
    await screen.findByText("Station map is wrong");
    expect(groupTitles()).toEqual(["South Garden"]);

    await user.selectOptions(statusFilter(), "");

    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(LIST_URL, { params: undefined }),
    );
    expect(await screen.findByText("Invoices do not send")).toBeInTheDocument();
    expect(groupTitles()).toEqual(["North Farm", "South Garden", "farm_east"]);
  });
});

describe("SuperAdminSupportTickets conversation", () => {
  async function openTicket() {
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText("Invoices do not send")).closest(
      "tr",
    ) as HTMLElement;
    await user.click(within(row).getByRole("button", { name: "Open" }));
    const title = await screen.findByRole("heading", {
      level: 2,
      name: "Invoices do not send",
    });
    return { user, header: title.parentElement as HTMLElement };
  }

  /** The value printed after a label in the ticket's meta grid. */
  function metaValue(label: string): HTMLElement {
    return screen.getByText(label, { selector: ".sa-ticket-meta-label" })
      .nextElementSibling as HTMLElement;
  }

  function messageWith(body: string): HTMLElement {
    return screen
      .getByText(body)
      .closest(".sa-ticket-message") as HTMLElement;
  }

  it("shows a loading text until the opened ticket arrives", async () => {
    const detail = deferred();
    serveGets({ [DETAIL_URL]: () => detail.promise });
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText("Invoices do not send")).closest(
      "tr",
    ) as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Open" }));

    expect(screen.getByText("Loading ticket...")).toBeInTheDocument();
    detail.resolve({ data: backend.detail });
    expect(
      await screen.findByRole("heading", { level: 2, name: "Invoices do not send" }),
    ).toBeInTheDocument();
  });

  it("says why an opened ticket could not be loaded", async () => {
    serveGets({ [DETAIL_URL]: () => Promise.reject(apiError("Ticket is locked.")) });
    const user = userEvent.setup();
    renderPage();
    const row = (await screen.findByText("Invoices do not send")).closest(
      "tr",
    ) as HTMLElement;

    await user.click(within(row).getByRole("button", { name: "Open" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Ticket is locked.");
    expect(screen.queryByText("Loading ticket...")).not.toBeInTheDocument();
  });

  it("replaces the list with the ticket's details and conversation", async () => {
    const { header } = await openTicket();

    expect(api.get).toHaveBeenCalledWith(DETAIL_URL);
    expect(
      screen.queryByRole("combobox", { name: "Filter by status" }),
    ).not.toBeInTheDocument();
    expect(within(header).getByText("open")).toHaveClass("sa-status-pill");
    expect(metaValue("Tenant")).toHaveTextContent("North Farm");
    expect(metaValue("Reporter")).toHaveTextContent(
      "Olga Office <olga@north.example.org>",
    );
    expect(metaValue("Priority")).toHaveTextContent("high");
    expect(screen.getByRole("combobox", { name: "Change status" })).toHaveValue(
      "open",
    );
  });

  it("tells staff messages and support replies apart", async () => {
    await openTicket();

    const staffMessage = messageWith("The invoice emails bounce.");
    expect(within(staffMessage).getByText("Olga Office")).toBeInTheDocument();
    expect(within(staffMessage).getByText("Staff")).toBeInTheDocument();
    const supportReply = messageWith("Looking into it.");
    expect(within(supportReply).getByText("Sam Support")).toBeInTheDocument();
    expect(within(supportReply).getByText("Support")).toBeInTheDocument();
  });

  it("goes back to the list", async () => {
    const { user } = await openTicket();

    await user.click(screen.getByRole("button", { name: "← Back to list" }));

    expect(statusFilter()).toBeInTheDocument();
    expect(groupTitles()).toEqual(["North Farm", "South Garden", "farm_east"]);
  });

  it("changes the ticket's status and reloads the ticket and the list", async () => {
    const { user, header } = await openTicket();
    backend.detail = makeDetail({ status: "resolved" });

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Change status" }),
      "resolved",
    );

    expect(api.post).toHaveBeenCalledWith(SET_STATUS_URL, {
      status: "resolved",
    });
    expect(await within(header).findByText("resolved")).toHaveClass(
      "sa-status-pill",
    );
    expect(screen.getByRole("combobox", { name: "Change status" })).toHaveValue(
      "resolved",
    );
    expect(getCalls(DETAIL_URL)).toBe(2);
    await waitFor(() => expect(getCalls(LIST_URL)).toBe(2));
  });

  it("reports a status change the server refuses", async () => {
    api.post.mockRejectedValue(apiError("Closed tickets cannot be reopened."));
    const { user } = await openTicket();

    await user.selectOptions(
      screen.getByRole("combobox", { name: "Change status" }),
      "in_progress",
    );

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith(
        "Closed tickets cannot be reopened.",
      ),
    );
    expect(screen.getByRole("combobox", { name: "Change status" })).toHaveValue(
      "open",
    );
    expect(getCalls(DETAIL_URL)).toBe(1);
  });

  it("keeps the send button disabled until the reply has text", async () => {
    const { user } = await openTicket();
    const reply = screen.getByRole("textbox", { name: "Reply" });
    const send = screen.getByRole("button", { name: "Send reply" });

    expect(send).toBeDisabled();
    await user.type(reply, "   ");
    expect(send).toBeDisabled();
    await user.type(reply, "On it.");
    expect(send).toBeEnabled();
  });

  it("sends the trimmed reply, empties the box and reloads the conversation", async () => {
    const sent = deferred();
    api.post.mockReturnValue(sent.promise);
    const { user } = await openTicket();
    const reply = screen.getByRole("textbox", { name: "Reply" });

    await user.type(reply, "  We fixed the mail settings.  ");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    expect(api.post).toHaveBeenCalledWith(REPLY_URL, {
      body: "We fixed the mail settings.",
    });
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();

    const detail = makeDetail();
    backend.detail = {
      ...detail,
      messages: [
        ...detail.messages,
        {
          id: "m-3",
          author_kind: "super_admin",
          author_name: "Sam Support",
          body: "We fixed the mail settings.",
          created_at: "2026-09-28T10:00:00Z",
        },
      ],
    };
    sent.resolve({ data: {} });

    expect(
      await screen.findByText("We fixed the mail settings."),
    ).toBeInTheDocument();
    expect(reply).toHaveValue("");
    expect(
      await screen.findByRole("button", { name: "Send reply" }),
    ).toBeDisabled();
  });

  it("reports a reply the server refuses and keeps the draft", async () => {
    api.post.mockRejectedValue(apiError("The ticket is closed."));
    const { user } = await openTicket();
    const reply = screen.getByRole("textbox", { name: "Reply" });

    await user.type(reply, "Any news?");
    await user.click(screen.getByRole("button", { name: "Send reply" }));

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("The ticket is closed."),
    );
    expect(reply).toHaveValue("Any news?");
    expect(
      await screen.findByRole("button", { name: "Send reply" }),
    ).toBeEnabled();
  });
});
