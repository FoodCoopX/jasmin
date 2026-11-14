import { useContext } from "react";
import type { HTMLAttributes } from "react";

import { TotalsRowContext } from "./totalsRowContext";

/**
 * A table body opening with the totals row of ``TotalsRowContext``. The row is
 * no data row, so no sort or search moves it. AntD renders this as the
 * table's body wrapper.
 */
export default function TotalsRowBody({
  children,
  ...props
}: HTMLAttributes<HTMLTableSectionElement>) {
  const row = useContext(TotalsRowContext);
  return (
    <tbody {...props}>
      {row && (
        <tr className="report-table-totals">
          <th
            scope="row"
            colSpan={row.labelColSpan}
            className={
              row.labelFixed
                ? "ant-table-cell ant-table-cell-fix-left ant-table-cell-fix-left-last"
                : "ant-table-cell"
            }
          >
            {row.label}
          </th>
          {row.cells.map((cell, index) => (
            <td
              // A cell's place is its column.
              key={index}
              className={
                cell.className
                  ? `ant-table-cell ${cell.className}`
                  : "ant-table-cell"
              }
            >
              {cell.value}
            </td>
          ))}
        </tr>
      )}
      {children}
    </tbody>
  );
}
