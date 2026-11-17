import ListPDFGenerator from "@features/commissioning/pdfs/exports/ListPDFGenerator";

import type { SaturdayShiftsPDFProps } from "./SaturdayShiftsPDF";

// ``SaturdayShiftsPDF`` is NOT statically imported — see ListPDFGenerator's
// docstring. The lazy factory keeps @react-pdf/renderer + the PDF template
// out of the page's eager bundle.

interface SaturdayShiftsPDFGeneratorProps {
  documentProps: SaturdayShiftsPDFProps;
  isReady: boolean;
  filename: string;
  buttonText: string;
}

export default function SaturdayShiftsPDFGenerator({
  documentProps,
  isReady,
  filename,
  buttonText,
}: SaturdayShiftsPDFGeneratorProps) {
  return (
    <ListPDFGenerator
      data={documentProps.rows}
      isReady={isReady}
      filename={filename}
      buttonText={buttonText}
      documentLoader={() => import("./SaturdayShiftsPDF")}
      documentProps={documentProps}
    />
  );
}
