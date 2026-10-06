/**
 * EditableTable on a phone: a page's own cards, which may open the edit dialog
 * only for a row the table lets edit, and the dialog itself — what a save
 * sends, and what it keeps of the user's input through a re-render or a
 * refusal.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@shared/contexts/ModalContext", () => ({
  useModal: () => ({ isModalMode: false }),
}));

vi.mock("@hooks/index", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hooks/index")>()),
  useIsMobile: () => true,
}));

vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock();
  return { useTenant: () => tenant };
});

import EditableTable from "../EditableTable";
import type {
  EditableColumnConfig,
  EditableTableProps,
  TablePermissions,
  TableRecord,
} from "../types";

type Row = TableRecord & { name: string; washed?: boolean; crate?: string };

// The carrots carry two fields no column shows.
const CARROTS: Row = {
  key: "1",
  id: "1",
  name: "Carrots",
  washed: true,
  crate: "crate-e2",
};
const LEEKS: Row = { key: "2", id: "2", name: "Leeks" };

const NAME_COLUMN: EditableColumnConfig<Row> = {
  title: "Name",
  dataIndex: "name",
  inputType: "text",
  editable: true,
};
const PERMISSIONS: TablePermissions<Row> = {
  canAdd: true,
  canEdit: true,
  canDelete: false,
};

/** A page's own card: a button where it may open the edit dialog, plain text
 *  where it may not. */
function Card({
  record,
  onEdit,
}: {
  record: Row;
  onEdit: ((record: Row) => void) | undefined;
}) {
  return onEdit ? (
    <button type="button" onClick={() => onEdit(record)}>
      {record.name}
    </button>
  ) : (
    <p>{record.name}</p>
  );
}

const savingApi = () => ({
  create: vi.fn((data: Record<string, unknown>) =>
    Promise.resolve({ data: { ...data, id: "new" } }),
  ),
  update: vi.fn((id: string, data: Record<string, unknown>) =>
    Promise.resolve({ data: { ...data, id } }),
  ),
  delete: vi.fn(() => Promise.resolve({})),
});

function renderTable(props: Partial<EditableTableProps<Row>> = {}) {
  const api = savingApi();
  const table = (overrides: Partial<EditableTableProps<Row>> = {}) => (
    <EditableTable<Row>
      columns={[{ ...NAME_COLUMN }]}
      initialData={[CARROTS, LEEKS]}
      permissions={PERMISSIONS}
      apiFunctions={api}
      renderMobileCard={(record, onEdit) => (
        <Card record={record} onEdit={onEdit} />
      )}
      {...props}
      {...overrides}
    />
  );
  const { rerender } = render(table());
  return { api, rerenderWith: (overrides: Partial<EditableTableProps<Row>>) => rerender(table(overrides)) };
}

const dialog = () => screen.getByRole("dialog");
const nameInput = () => within(dialog()).getByRole("textbox", { name: "Name" });
const saveInDialog = () =>
  userEvent.click(within(dialog()).getByRole("button", { name: "table.save" }));

async function openCarrotsAndType(name: string) {
  await userEvent.click(await screen.findByRole("button", { name: "Carrots" }));
  await waitFor(() => expect(nameInput()).toHaveValue("Carrots"));
  await userEvent.clear(nameInput());
  await userEvent.type(nameInput(), name);
}

describe("EditableTable phone cards", () => {
  it("lets a card open the edit dialog only for a row the table lets edit", async () => {
    renderTable({
      permissions: { ...PERMISSIONS, canEditRecord: (row) => row.key !== "2" },
    });

    expect(await screen.findByText("Leeks")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leeks" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Carrots" }));

    expect(await within(dialog()).findAllByText("table.edit_record")).not.toHaveLength(0);
  });

  it("gives the cards of a read-only table nothing to open", async () => {
    renderTable({ permissions: { canAdd: false, canEdit: false, canDelete: false } });

    expect(await screen.findByText("Carrots")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Carrots" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leeks" })).not.toBeInTheDocument();
  });
});

describe("EditableTable phone edit dialog", () => {
  it("sends the row's fields the dialog doesn't show along with the edit", async () => {
    const { api } = renderTable();
    await openCarrotsAndType("Parsnips");

    await saveInDialog();

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(1));
    expect(api.update).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ name: "Parsnips", washed: true, crate: "crate-e2" }),
    );
  });

  it("keeps what was typed when the page renders new columns and rows while it is open", async () => {
    const { api, rerenderWith } = renderTable();
    await openCarrotsAndType("Parsnips");

    // A refetch on window focus: new row objects, and the page's columns built anew.
    rerenderWith({
      columns: [{ ...NAME_COLUMN }],
      initialData: [{ ...CARROTS }, { ...LEEKS }],
    });

    expect(nameInput()).toHaveValue("Parsnips");
    await saveInDialog();
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith("1", expect.objectContaining({ name: "Parsnips" })),
    );
  });

  it("stays open with the reason when the save is refused, and closes once it goes through", async () => {
    const { api } = renderTable();
    api.update.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 400, data: { message: "The farm shop already has carrots" } },
    });
    await openCarrotsAndType("Parsnips");

    await saveInDialog();

    expect(
      await within(dialog()).findByText("The farm shop already has carrots"),
    ).toBeInTheDocument();
    expect(nameInput()).toHaveValue("Parsnips");

    await saveInDialog();

    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Parsnips" })).toBeInTheDocument();
  });

  it("stays open when the table's duplicate check refuses the save", async () => {
    const { api } = renderTable({
      uniqueCheck: ["name"],
      uniqueCheckMessage: "Name taken",
    });
    await openCarrotsAndType("Leeks");

    await saveInDialog();

    expect(await within(dialog()).findByText("Name taken")).toBeInTheDocument();
    expect(nameInput()).toHaveValue("Leeks");
    expect(api.update).not.toHaveBeenCalled();
  });
});
