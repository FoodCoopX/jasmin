import type {
  EditableColumnConfig,
  TableRecord,
} from "@shared/tables/BasicEditableTable/types";
import { DiffCell } from "@shared/ui";
import { formatAmountForUnit } from "@shared/utils";

/**
 * The amount, unit and size columns of a delivery-note or invoice line, each
 * showing the upstream value under its own when the line differs from it. A
 * changed amount's original is formatted as an amount, in the unit it had
 * upstream.
 */
export function withUpstreamDiffs(
  columns: EditableColumnConfig<TableRecord>[],
  format: (value: number, decimals: number) => string,
): EditableColumnConfig<TableRecord>[] {
  return columns.map((col) => ({
    ...col,
    render: (value: unknown, record: TableRecord) => (
      <DiffCell
        value={col.render ? col.render(value, record, 0) : (value as string)}
        differs={record[`${col.dataIndex}_differs`] as boolean | undefined}
        original={record[`original_${col.dataIndex}`]}
        formatOriginal={
          col.dataIndex === "amount"
            ? (original) =>
                formatAmountForUnit(
                  Number(original),
                  (record.unit_differs
                    ? record.original_unit
                    : record.unit) as string | undefined,
                  format,
                )
            : undefined
        }
      />
    ),
  }));
}
