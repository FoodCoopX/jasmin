import type { TFunction } from "i18next";

import type { PackingBoxesMatrixColumn } from "@shared/api/generated/models";

import ListPDFGenerator from "./ListPDFGenerator";
import type { PackingBoxesMatrixPDFProps } from "./PackingBoxesMatrixPDF";

interface PackingBoxesMatrixPDFGeneratorProps {
  columns: PackingBoxesMatrixColumn[] | null;
  data: PackingBoxesMatrixPDFProps["data"] | null;
  week: number | null;
  dayName: string;
  showSize?: boolean;
  /** Render the per-combination count row (default true; off for the
   *  per-share matrix of a farm that uploads its weekly share amounts). */
  showCountRow?: boolean;
  /** A cell's text; see `PackingBoxesMatrixPDFProps.cellText`. */
  cellText?: PackingBoxesMatrixPDFProps["cellText"];
  filename: string;
  buttonText: string;
  t: TFunction;
}

export default function PackingBoxesMatrixPDFGenerator({
  columns,
  data,
  week,
  dayName,
  showSize,
  showCountRow,
  cellText,
  filename,
  buttonText,
  t,
}: PackingBoxesMatrixPDFGeneratorProps) {
  return (
    <ListPDFGenerator
      data={data}
      isReady={!!columns && columns.length > 0}
      filename={filename}
      buttonText={buttonText}
      documentLoader={() => import("./PackingBoxesMatrixPDF")}
      documentProps={{
        columns: columns ?? [],
        data: data ?? [],
        week,
        dayName,
        showSize,
        showCountRow,
        cellText,
        t,
      }}
    />
  );
}
