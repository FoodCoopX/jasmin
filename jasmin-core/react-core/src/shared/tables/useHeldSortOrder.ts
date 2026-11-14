import type { TableProps } from "antd";
import type {
  ColumnType,
  CompareFn,
  SorterResult,
} from "antd/es/table/interface";
import type { Key } from "react";
import { useCallback, useMemo, useState } from "react";

interface SortState {
  columnKey: Key;
  order: "ascend" | "descend";
}

type Columns<T> = NonNullable<TableProps<T>["columns"]>;

function compareOf<T>(column: Columns<T>[number]): CompareFn<T> | undefined {
  const { sorter } = column as ColumnType<T>;
  if (typeof sorter === "function") return sorter;
  if (sorter && typeof sorter === "object") return sorter.compare;
  return undefined;
}

function keyOfRow<T>(rowKey: TableProps<T>["rowKey"], row: T): Key {
  if (typeof rowKey === "function") return rowKey(row);
  return (row as Record<string, Key>)[rowKey ?? "key"];
}

/**
 * Sorts a table's rows when a header is clicked, then holds that order: a
 * change to the rows, such as a cross that changes a sorted value, moves no
 * row away from under the cursor. The rows are sorted afresh on the next
 * header click, and when ``scope`` changes (another week, say) once its rows
 * are there. A row the held order doesn't know goes last.
 *
 * AntD would sort on every change of the rows, so the sortable columns are
 * handed to it as sorted elsewhere (``sorter: true``) with their order set
 * here. ``enabled`` false leaves columns and rows to AntD.
 */
export function useHeldSortOrder<T>({
  enabled,
  scope,
  columns,
  rows,
  rowKey,
}: {
  enabled: boolean;
  scope: unknown;
  columns: TableProps<T>["columns"];
  rows: readonly T[] | undefined;
  rowKey: TableProps<T>["rowKey"];
}) {
  const [sort, setSort] = useState<SortState | null>(null);

  const hasRows = (rows?.length ?? 0) > 0;
  const heldOrder = useMemo(() => {
    const column = sort && columns?.find((each) => each.key === sort.columnKey);
    const compare = column && compareOf<T>(column);
    if (!enabled || !sort || !compare || !rows) return null;
    const direction = sort.order === "descend" ? -1 : 1;
    return [...rows]
      .sort((a, b) => direction * compare(a, b, sort.order))
      .map((row) => keyOfRow(rowKey, row));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the order is taken on a header click and for a new scope, not on every change of the rows
  }, [enabled, sort, scope, hasRows]);

  const orderedRows = useMemo(() => {
    if (!heldOrder || !rows) return rows;
    const place = new Map(heldOrder.map((key, index) => [key, index]));
    const placeOf = (row: T) =>
      place.get(keyOfRow(rowKey, row)) ?? heldOrder.length;
    return [...rows].sort((a, b) => placeOf(a) - placeOf(b));
  }, [heldOrder, rowKey, rows]);

  const shownColumns = useMemo(
    () =>
      enabled
        ? columns?.map((column) =>
            compareOf<T>(column)
              ? {
                  ...column,
                  sorter: true,
                  sortOrder:
                    sort && sort.columnKey === column.key ? sort.order : null,
                }
              : column,
          )
        : columns,
    [columns, enabled, sort],
  );

  const onSortChange = useCallback(
    (sorter: SorterResult<T> | SorterResult<T>[]) => {
      const single = Array.isArray(sorter) ? sorter[0] : sorter;
      setSort(
        single?.order && single.columnKey != null
          ? { columnKey: single.columnKey, order: single.order }
          : null,
      );
    },
    [],
  );

  return { orderedRows, shownColumns, onSortChange };
}
