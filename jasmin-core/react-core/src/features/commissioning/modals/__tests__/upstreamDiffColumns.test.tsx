/**
 * withUpstreamDiffs: wraps a delivery note's or invoice's amount, unit and
 * size columns so each cell shows the upstream value under its own when the
 * line differs from it. A changed amount's original is formatted in the
 * tenant's number format at the precision of the unit it had upstream.
 */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  EditableColumnConfig,
  TableRecord,
} from "@shared/tables/BasicEditableTable/types";
import { formatNumber } from "@shared/utils/numberFormat";

import { withUpstreamDiffs } from "../upstreamDiffColumns";

const germanNumber = (value: number, decimals: number) =>
  formatNumber(value, decimals, "de-DE");

const COLUMNS: EditableColumnConfig<TableRecord>[] = [
  {
    title: "Amount",
    dataIndex: "amount",
    key: "amount",
    width: "6em",
    render: (value: unknown) => `${germanNumber(Number(value), 2)} amount`,
  },
  { title: "Unit", dataIndex: "unit", key: "unit" },
  { title: "Size", dataIndex: "size", key: "size" },
];

const columns = withUpstreamDiffs(COLUMNS, germanNumber);

const renderCell = (dataIndex: string, record: TableRecord) => {
  const column = columns.find((col) => col.dataIndex === dataIndex)!;
  const { container } = render(<>{column.render!(record[dataIndex], record, 0)}</>);
  return {
    value: container.querySelector(".jasmin-diff-cell__value"),
    original: container.querySelector(".jasmin-diff-cell__original"),
  };
};

const LINE: TableRecord = {
  key: "line-1",
  id: "line-1",
  amount: 12.5,
  unit: "KG",
  size: "M",
};

describe("withUpstreamDiffs", () => {
  it("keeps every column's own settings and order", () => {
    expect(columns.map(({ dataIndex, title, key }) => ({ dataIndex, title, key }))).toEqual([
      { dataIndex: "amount", title: "Amount", key: "amount" },
      { dataIndex: "unit", title: "Unit", key: "unit" },
      { dataIndex: "size", title: "Size", key: "size" },
    ]);
    expect(columns[0].width).toBe("6em");
  });

  it("renders an unchanged cell through the column's own renderer, without an original", () => {
    const amount = renderCell("amount", LINE);
    expect(amount.value).toHaveTextContent("12,50 amount");
    expect(amount.value).not.toHaveClass("jasmin-diff-cell__value--changed");
    expect(amount.original).toBeNull();

    const unit = renderCell("unit", LINE);
    expect(unit.value).toHaveTextContent("KG");
    expect(unit.original).toBeNull();
  });

  it("shows a changed amount's original at its unit's precision in the tenant's number format", () => {
    const amount = renderCell("amount", {
      ...LINE,
      amount_differs: true,
      original_amount: "1234.5",
    });

    expect(amount.value).toHaveClass("jasmin-diff-cell__value--changed");
    expect(amount.original).toHaveTextContent(/^1\.234,50$/);
  });

  it("formats a changed amount's original in the unit it had upstream", () => {
    const amount = renderCell("amount", {
      ...LINE,
      unit: "KG",
      amount_differs: true,
      original_amount: 8,
      unit_differs: true,
      original_unit: "PCS",
    });

    expect(amount.original).toHaveTextContent(/^8,0$/);
  });

  it("shows the upstream unit and size as they were", () => {
    const record = {
      ...LINE,
      unit_differs: true,
      original_unit: "PCS",
      size_differs: true,
      original_size: "L",
    };

    expect(renderCell("unit", record).original).toHaveTextContent(/^PCS$/);
    expect(renderCell("size", record).original).toHaveTextContent(/^L$/);
  });

  it("shows no original when the line differs but the upstream value is missing", () => {
    const amount = renderCell("amount", { ...LINE, amount_differs: true, original_amount: null });

    expect(amount.value).toHaveClass("jasmin-diff-cell__value--changed");
    expect(amount.original).toBeNull();
  });
});
