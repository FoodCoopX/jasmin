import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { axe } from "@/test/axe";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === "string" ? fallback : key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

// Inline editing, the mode a new user starts in.
vi.mock("@shared/contexts/ModalContext", () => ({
  useModal: () => ({ isModalMode: false }),
}));

vi.mock("@hooks/configuration/useTenant", async () => {
  const { makeUseTenantMock } = await import("@/test/tenantMock");
  const tenant = makeUseTenantMock();
  return { useTenant: () => tenant };
});

import EditableTable from "../EditableTable";
import type { EditableColumnConfig, TableRecord } from "../types";

type Row = TableRecord & { name: string; amount: number };

const ROWS: Row[] = [
  { key: "1", id: "1", name: "Carrots", amount: 3 },
  { key: "2", id: "2", name: "Leeks", amount: 5 },
];

const COLUMNS: EditableColumnConfig<Row>[] = [
  { title: "Name", dataIndex: "name", inputType: "text", editable: true },
  { title: "Amount", dataIndex: "amount", inputType: "number", editable: true },
];

function renderTable() {
  return render(
    <EditableTable<Row>
      columns={COLUMNS}
      initialData={ROWS}
      permissions={{ canAdd: true, canEdit: true, canDelete: true }}
      apiFunctions={{
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      }}
    />,
  );
}

describe("EditableTable", () => {
  it("names every column, including the actions column", async () => {
    const { container } = renderTable();

    expect(await screen.findByText("Carrots")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "table.actions" }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("labels the inputs of a row being edited inline", async () => {
    const { container } = renderTable();

    await userEvent.click(
      (await screen.findAllByRole("button", { name: "table.edit" }))[0],
    );

    // The first cell takes focus a frame later, ready to be typed over.
    const nameInput = await screen.findByDisplayValue("Carrots");
    await waitFor(() => expect(nameInput).toHaveFocus());
    expect(await axe(container)).toHaveNoViolations();
  });
});
