import { Table } from "antd";
import type { TableProps } from "antd";
import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EmptyHint } from "@shared/ui";

import TableSearchInput from "./BasicEditableTable/TableSearchInput";
import TotalsRowBody from "./TotalsRowBody";
import { type TotalsRow, TotalsRowContext } from "./totalsRowContext";
import { useHeldSortOrder } from "./useHeldSortOrder";

/**
 * Lightweight read-only report table: a thin wrapper over AntD ``Table`` that
 * bakes in the shared ``custom-jasmin-table`` class, ``size="small"`` and the
 * subtle-grey ``EmptyHint`` empty state.
 *
 * This is intentionally NOT ``EditableTable``: server-paginated tables and
 * tables with custom action columns (approve / reject / download) belong here,
 * not forced through the full editable grid. Every other AntD ``Table`` prop
 * (``columns`` / ``dataSource`` / ``rowKey`` / ``loading`` / ``pagination`` /
 * ``rowClassName`` / ``locale`` / …) passes straight through.
 */
export interface ReadOnlyReportTableProps<T> extends TableProps<T> {
  /**
   * Message shown (wrapped in ``<EmptyHint>``) when there are no rows. Defaults
   * to the shared "no data" copy. A caller-supplied ``locale.emptyText`` still
   * wins over this.
   */
  emptyText?: ReactNode;
  /**
   * A search box above the table, as the editable table has: it keeps the
   * rows of ``dataSource`` with a column value containing the text — the
   * columns' ``dataIndex`` fields, not what a ``render`` shows.
   */
  searchable?: boolean;
  /**
   * A row above the data rows, such as per-column totals, that no sort or
   * search moves; null shows none for now. It takes over ``components.body``.
   */
  totalsRow?: TotalsRow | null;
  /**
   * Set, a header click sorts the rows once and the order then holds, so a
   * click that changes a sorted value moves no row away from the cursor. The
   * rows are sorted afresh on the next header click, and when this value
   * changes, e.g. to another week. Unset, AntD sorts on every change.
   */
  sortScope?: string | number;
}

export default function ReadOnlyReportTable<T extends object>({
  className = "custom-jasmin-table",
  size = "small",
  emptyText,
  locale,
  searchable = false,
  totalsRow,
  sortScope,
  columns,
  dataSource,
  components,
  rowKey,
  onChange,
  ...rest
}: ReadOnlyReportTableProps<T>) {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState("");
  const { orderedRows, shownColumns, onSortChange } = useHeldSortOrder<T>({
    enabled: sortScope !== undefined,
    scope: sortScope,
    columns,
    rows: dataSource,
    rowKey,
  });

  const shownRows = useMemo(() => {
    const needle = searchText.trim().toLowerCase();
    if (!searchable || !needle || !orderedRows) return orderedRows;
    const fields = (columns ?? []).flatMap((column) =>
      "dataIndex" in column && typeof column.dataIndex === "string"
        ? [column.dataIndex]
        : [],
    );
    return orderedRows.filter((row) =>
      fields.some((field) => {
        const value = (row as Record<string, unknown>)[field];
        return value != null && String(value).toLowerCase().includes(needle);
      }),
    );
  }, [columns, orderedRows, searchText, searchable]);

  const handleChange = useCallback<NonNullable<TableProps<T>["onChange"]>>(
    (pagination, filters, sorter, extra) => {
      if (extra.action === "sort") onSortChange(sorter);
      onChange?.(pagination, filters, sorter, extra);
    },
    [onChange, onSortChange],
  );

  // A new object only when the totals row comes or goes, so AntD keeps the
  // body it renders while the totals change.
  const hasTotalsRow = totalsRow !== undefined;
  const tableComponents = useMemo(
    () =>
      hasTotalsRow
        ? { ...components, body: { wrapper: TotalsRowBody } }
        : components,
    [components, hasTotalsRow],
  );

  const table = (
    <TotalsRowContext.Provider value={totalsRow ?? null}>
      <Table<T>
        className={className}
        size={size}
        locale={{
          emptyText: <EmptyHint>{emptyText ?? t("table.no_data")}</EmptyHint>,
          ...locale,
        }}
        columns={shownColumns}
        dataSource={shownRows}
        components={tableComponents}
        rowKey={rowKey}
        onChange={handleChange}
        {...rest}
      />
    </TotalsRowContext.Provider>
  );
  if (!searchable) return table;
  return (
    <>
      <div className="mb-8">
        <TableSearchInput
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
      </div>
      {table}
    </>
  );
}
