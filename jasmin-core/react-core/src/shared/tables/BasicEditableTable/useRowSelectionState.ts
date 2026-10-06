import type { Key } from "react";
import { useCallback, useEffect, useState } from "react";
import type { TableRecord } from "./types";

/**
 * The ticked rows a table shows and reports. A page that passes
 * `selectedRowKeys` holds the selection, also when it is empty; otherwise the
 * table keeps its own. A ticked row that leaves the table's rows — another
 * week, day or filter, or a deleted row — is dropped from the selection and
 * the page is told, so a bulk action never reaches a row nobody sees ticked.
 * A table that remounts for a new week starts empty and so drops the lot.
 */
export function useRowSelectionState<T extends TableRecord>({
  rows,
  selectedRowKeys,
  onSelectedRowsChange,
}: {
  rows: T[];
  selectedRowKeys: Key[] | undefined;
  onSelectedRowsChange: ((keys: Key[], rows: T[]) => void) | null;
}) {
  const [ownKeys, setOwnKeys] = useState<Key[]>([]);
  const ownsSelection = selectedRowKeys === undefined;
  const selectedKeys = selectedRowKeys ?? ownKeys;

  const changeSelection = useCallback(
    (keys: Key[], selectedRows: T[]) => {
      if (ownsSelection) setOwnKeys(keys);
      onSelectedRowsChange?.(keys, selectedRows);
    },
    [ownsSelection, onSelectedRowsChange],
  );

  useEffect(() => {
    const ticked = rows.filter((row) => selectedKeys.includes(row.key));
    if (ticked.length < selectedKeys.length) {
      changeSelection(
        ticked.map((row) => row.key),
        ticked,
      );
    }
  }, [rows, selectedKeys, changeSelection]);

  return { selectedKeys, changeSelection };
}
