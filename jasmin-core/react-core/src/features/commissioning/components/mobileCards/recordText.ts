import type { TableRecord } from "@shared/tables/BasicEditableTable/types";

/** A text field of the row, or "" when the row has none. */
export function recordText(record: TableRecord, field: string): string {
  return (record[field] as string) || "";
}
