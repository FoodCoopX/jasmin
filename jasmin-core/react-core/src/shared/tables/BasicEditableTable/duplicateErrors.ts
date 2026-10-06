import type { Key } from "react";
import type { TableRecord } from "./types";

/**
 * Whether two cell values are equal the way the table compares them. Form
 * inputs hand back strings (an AntD <Input> for a numeric column emits "2"),
 * while rows loaded from the API keep numbers (`sort_order: 2`), so a strict
 * `===` would miss every number-vs-string match; primitives are compared via
 * String(), and null/undefined never equal a real value.
 */
export const sameCellValue = (a: unknown, b: unknown): boolean =>
  a === b || (a != null && b != null && String(a) === String(b));

/**
 * The rows a row about to be saved is checked against: the table's own and
 * those the page keeps out of the table (`extraRows`, inactive ones, say),
 * which still hold their values — without the row itself and the unsaved
 * draft. For a row the table holds, its own copy carries the edits made here.
 */
export function otherRows<T extends TableRecord>({
  rows,
  extraRows = [],
  key,
}: {
  rows: T[];
  extraRows?: T[];
  key: Key;
}): T[] {
  const heldIds = new Set(rows.map((record) => record.id));
  return [
    ...rows,
    ...extraRows
      .filter((record) => !heldIds.has(record.id))
      .map((record) => ({ ...record, key: record.id }) as T),
  ].filter((record) => record.key !== key && record.key !== -1);
}

/**
 * The field error for a row whose `uniqueCheck` fields repeat another row's
 * values (see `otherRows`), keyed by the first checked field; empty when
 * nothing repeats.
 */
export function duplicateErrors<T extends TableRecord>({
  uniqueCheck,
  uniqueCheckMessage,
  rows,
  extraRows,
  key,
  row,
}: {
  uniqueCheck: string | string[];
  uniqueCheckMessage: string | null;
  rows: T[];
  extraRows?: T[];
  key: Key;
  row: Record<string, unknown>;
}): Record<string, string> {
  const fieldsToCheck = Array.isArray(uniqueCheck) ? uniqueCheck : [uniqueCheck];
  const others = otherRows({ rows, extraRows, key });

  if (fieldsToCheck.length > 1) {
    const duplicateExists = others.some((record) =>
      fieldsToCheck.every((fieldName) =>
        sameCellValue(record[fieldName], row[fieldName]),
      ),
    );
    return duplicateExists
      ? {
          [fieldsToCheck[0]]:
            uniqueCheckMessage ||
            `This combination of ${fieldsToCheck.join(" + ")} already exists.`,
        }
      : {};
  }

  const [fieldName] = fieldsToCheck;
  const value = row[fieldName];
  if (value === undefined || value === null || value === "") return {};
  return others.some((record) => sameCellValue(record[fieldName], value))
    ? {
        [fieldName]:
          uniqueCheckMessage ||
          `This ${fieldName} already exists. Please choose a different value.`,
      }
    : {};
}
