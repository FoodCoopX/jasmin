/**
 * Mobile cards must honour a column's own `render`.
 *
 * Otherwise the card view would fall through to `String(raw)`, so on a phone
 * every column that defines a `render` would show the raw API value: "0.000"
 * for a formatted amount, an ISO date, a bare id for a relation.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import MobileCardList from "../MobileCardList";
import type { EditableColumnConfig, TableRecord } from "../types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "de", changeLanguage: () => Promise.resolve() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

type Row = TableRecord & { key: string; name: string; amount: string | null };

const ROWS: Row[] = [{ key: "r1", name: "Carrots", amount: "0.000" }];

function columns(extra: Partial<EditableColumnConfig<Row>> = {}) {
  return [
    { dataIndex: "name", title: "Name", key: "name" },
    { dataIndex: "amount", title: "Amount", key: "amount", ...extra },
  ] as unknown as EditableColumnConfig<Row>[];
}

function renderList(cols: EditableColumnConfig<Row>[], data: Row[] = ROWS) {
  return render(
    <MobileCardList
      data={data}
      columns={cols}
      onEdit={vi.fn()}
      onAdd={vi.fn()}
      onDelete={vi.fn()}
      primaryFields={["name", "amount"]}
    />,
  );
}

describe("MobileCardList", () => {
  it("uses the column's render instead of the raw value", () => {
    renderList(
      columns({
        render: (value: unknown) => `${Number(value).toFixed(2)} kg`,
      }),
    );

    expect(screen.getByText("0.00 kg")).toBeInTheDocument();
    // The raw wire string must not leak through.
    expect(screen.queryByText("0.000")).not.toBeInTheDocument();
  });

  it("passes value, record and index to render", () => {
    const spy = vi.fn(() => "rendered");
    renderList(columns({ render: spy }));

    expect(spy).toHaveBeenCalledWith("0.000", ROWS[0], 0);
  });

  it("drops the field when render yields nothing", () => {
    renderList(columns({ render: () => "" }));

    // The label is only printed alongside a value; an empty render removes both.
    expect(screen.queryByText("Amount:")).not.toBeInTheDocument();
  });

  it("still falls back to the raw value when a column has no render", () => {
    renderList(columns());
    expect(screen.getByText("0.000")).toBeInTheDocument();
  });
});

describe("MobileCardList paging", () => {
  const many: Row[] = Array.from({ length: 45 }, (_, index) => ({
    key: `r${index}`,
    name: `Article ${index + 1}`,
    amount: null,
  }));

  it("shows 20 cards at first and 20 more per request", async () => {
    renderList(columns(), many);

    expect(screen.getByText("Article 20")).toBeInTheDocument();
    expect(screen.queryByText("Article 21")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "table.show_more" }));
    expect(screen.getByText("Article 40")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "table.show_more" }));
    expect(screen.getByText("Article 45")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "table.show_more" }),
    ).not.toBeInTheDocument();
  });
});

