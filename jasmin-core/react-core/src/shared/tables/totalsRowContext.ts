import { createContext } from "react";
import type { ReactNode } from "react";

/** The row a ``ReadOnlyReportTable`` shows above its data rows. */
export interface TotalsRow {
  label: ReactNode;
  /** How many leading columns the label spans. */
  labelColSpan: number;
  /** Keeps the label in view while the table scrolls sideways, as columns
   *  fixed on the left do; set it when the spanned columns are fixed. */
  labelFixed?: boolean;
  /** One cell per column after the label's. */
  cells: { value: ReactNode; className?: string }[];
}

/** Hands the row to the table body, which AntD renders itself. */
export const TotalsRowContext = createContext<TotalsRow | null>(null);
