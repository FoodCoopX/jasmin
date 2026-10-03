/**
 * ``useTransferUndoColumn``: the office undoes a coop share transfer from any
 * row it created, after confirming; a membership the undo reopens makes the
 * modal close.
 */
import { render, renderHook, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  options: null as null | {
    mutation: { onSuccess: (result: { from_member_reinstated: boolean }) => void };
  },
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock("@shared/api/generated/commissioning/commissioning", () => ({
  getCommissioningCoopSharesListQueryKey: () => ["coop_shares"],
  getCommissioningMembersListQueryKey: () => ["members"],
  useCommissioningCoopSharesReverseTransferCreate: (
    options: typeof mocks.options,
  ) => {
    mocks.options = options;
    return { mutate: mocks.mutate, isPending: false, variables: undefined };
  },
}));

vi.mock("@shared/utils", () => ({ notify: mocks.notify }));

import { useTransferUndoColumn } from "../useTransferUndoColumn";

type Render = (value: unknown, record: Record<string, unknown>) => ReactNode;

function column(enabled: boolean, onMemberReinstated = vi.fn()) {
  const queryClient = new QueryClient();
  const { result } = renderHook(
    () => useTransferUndoColumn({ enabled, onMemberReinstated }),
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    },
  );
  return result.current.render as Render;
}

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.notify.success.mockReset();
});

describe("useTransferUndoColumn", () => {
  it("undoes the transfer of a row once the office confirms", async () => {
    const renderCell = column(true);
    render(<>{renderCell(undefined, { key: "share-1", id: "share-1", transfer: "t-1" })}</>);

    await userEvent.click(screen.getByRole("button", { name: /members.undo_transfer/ }));
    const buttons = screen.getAllByRole("button", { name: /members.undo_transfer/ });
    await userEvent.click(buttons[buttons.length - 1]);

    expect(mocks.mutate).toHaveBeenCalledWith({ id: "share-1" });
  });

  it("offers nothing on a row no transfer created", () => {
    const renderCell = column(true);

    expect(renderCell(undefined, { key: "share-1", id: "share-1", transfer: null })).toBeNull();
  });

  it("offers nothing to a viewer who isn't office", () => {
    const renderCell = column(false);

    expect(renderCell(undefined, { key: "share-1", id: "share-1", transfer: "t-1" })).toBeNull();
  });

  it("reports a reopened membership", () => {
    const onMemberReinstated = vi.fn();
    column(true, onMemberReinstated);

    mocks.options!.mutation.onSuccess({ from_member_reinstated: true });

    expect(onMemberReinstated).toHaveBeenCalledTimes(1);
    expect(mocks.notify.success).toHaveBeenCalledWith(
      "members.transfer_undone_member_reinstated",
    );
  });

  it("keeps the modal open when no membership was reopened", () => {
    const onMemberReinstated = vi.fn();
    column(true, onMemberReinstated);

    mocks.options!.mutation.onSuccess({ from_member_reinstated: false });

    expect(onMemberReinstated).not.toHaveBeenCalled();
    expect(mocks.notify.success).toHaveBeenCalledWith("members.transfer_undone");
  });
});
