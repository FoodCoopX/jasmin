/**
 * The super-admin ops checklist: marking a task done and running a key
 * rotation, with their toasts. Super-admin endpoints have no generated client,
 * so the shared axios instance is the boundary mocked here.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  api: { get: vi.fn(), post: vi.fn() },
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));
vi.mock("@shared/services/api", () => ({ default: api }));
vi.mock("@shared/utils", () => ({ notify }));

import SuperAdminOpsChecklist from "../SuperAdminOpsChecklist";

const LIST_URL = "/api/super-admin/ops-checklist/";

const ROTATION_TASK = {
  id: 1,
  kind: "rotate_django_secret",
  title: "Rotate the Django secret",
  description: "",
  interval_days: 90,
  is_active: true,
  created_at: "2026-01-05T08:00:00Z",
  last_run: null,
  next_due_at: "2026-10-05T08:00:00Z",
  is_overdue: true,
};

/** A rejected request as axios hands it over, carrying the server's body. */
function axiosError(status: number, data: unknown) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
  });
}

async function renderLoaded() {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <SuperAdminOpsChecklist />
    </QueryClientProvider>,
  );
  await screen.findByText(ROTATION_TASK.title);
  return { user };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (url: string) => {
    if (url === LIST_URL) return { data: [ROTATION_TASK] };
    throw new Error(`unexpected GET ${url}`);
  });
});

describe("mark done", () => {
  async function recordCompletion() {
    const { user } = await renderLoaded();
    await user.click(screen.getByRole("button", { name: /Mark done/ }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), "Rotated on prod");
    await user.click(within(dialog).getByRole("button", { name: "Record completion" }));
  }

  it("records the completion and says so", async () => {
    api.post.mockResolvedValue({ data: {} });
    await recordCompletion();

    await waitFor(() =>
      expect(notify.success).toHaveBeenCalledWith("platform.ops_checklist.marked_done"),
    );
    expect(api.post).toHaveBeenCalledWith(
      "/api/super-admin/ops-checklist/1/mark-done/",
      { notes: "Rotated on prod" },
    );
  });

  it.each([
    ["the server's reason", { message: "Task is inactive." }, "Task is inactive."],
    ["its own message without one", {}, "platform.ops_checklist.mark_done_failed"],
  ])("reports a refused completion with %s", async (_, body, shown) => {
    api.post.mockRejectedValue(axiosError(503, body));
    await recordCompletion();

    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(shown));
    expect(notify.success).not.toHaveBeenCalled();
  });
});

describe("run rotation", () => {
  it("reports a failed rotation in its own words when the server gives no reason", async () => {
    api.post.mockRejectedValue(axiosError(503, {}));
    const { user } = await renderLoaded();

    await user.click(screen.getByRole("button", { name: /Run rotation/ }));

    await waitFor(() =>
      expect(notify.error).toHaveBeenCalledWith("platform.ops_checklist.rotation_failed"),
    );
  });

  it.each([
    [true, "success", "platform.ops_checklist.secret_copied"],
    [false, "error", "platform.ops_checklist.copy_failed"],
  ] as const)("copies the new secret (clipboard works: %s)", async (works, level, shown) => {
    api.post.mockResolvedValue({
      data: {
        kind: "rotate_django_secret",
        generated_secret: "s3cr3t",
        instructions: "Put it in .env",
        items_affected: 0,
        extras: {},
      },
    });
    const { user } = await renderLoaded();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockImplementation(() => (works ? Promise.resolve() : Promise.reject(new Error("denied"))));

    await user.click(screen.getByRole("button", { name: /Run rotation/ }));
    await user.click(await screen.findByRole("button", { name: /Copy to clipboard/ }));

    await waitFor(() => expect(notify[level]).toHaveBeenCalledWith(shown));
    expect(writeText).toHaveBeenCalledWith("s3cr3t");
  });
});
