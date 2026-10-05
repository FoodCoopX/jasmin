import type { Key } from "react";
import type { TableRecord } from "./types";

// Type-tolerant equality: form inputs hand back strings (an AntD <Input> for a
// numeric column emits "2"), while rows loaded from the API keep numbers
// (`sort_order: 2`). A strict `===` would miss every number-vs-string
// duplicate, so bridge primitives via String() while keeping null/undefined
// never-equal to a real value.
const sameValue = (a: unknown, b: unknown): boolean =>
  a === b || (a != null && b != null && String(a) === String(b));

/**
 * The field error for a row whose `uniqueCheck` fields repeat another row's
 * values, keyed by the first checked field; empty when nothing repeats. Rows
 * the page keeps out of the table (`extraRows`, inactive ones, say) still hold
 * their values, so they count too; for a row the table holds, its own copy
 * carries the edits made here.
 */
export function duplicateErrors<T extends TableRecord>({
  uniqueCheck,
  uniqueCheckMessage,
  rows,
  extraRows = [],
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
  const heldIds = new Set(rows.map((record) => record.id));
  const others = [
    ...rows,
    ...extraRows
      .filter((record) => !heldIds.has(record.id))
      .map((record) => ({ ...record, key: record.id }) as T),
  ].filter((record) => record.key !== key && record.key !== -1);

  if (fieldsToCheck.length > 1) {
    const duplicateExists = others.some((record) =>
      fieldsToCheck.every((fieldName) =>
        sameValue(record[fieldName], row[fieldName]),
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
  return others.some((record) => sameValue(record[fieldName], value))
    ? {
        [fieldName]:
          uniqueCheckMessage ||
          `This ${fieldName} already exists. Please choose a different value.`,
      }
    : {};
}
