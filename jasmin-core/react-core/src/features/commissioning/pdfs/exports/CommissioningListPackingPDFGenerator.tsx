import type { TFunction } from "i18next";
import type { CommissioningListPackingPDFProps } from "./CommissioningListPackingPDF";
import ListPDFGenerator from "./ListPDFGenerator";

// ``CommissioningListPackingPDF`` is NOT statically imported — see
// ListPDFGenerator's docstring. The lazy factory keeps
// @react-pdf/renderer + the PDF template out of the page's eager bundle.

interface CommissioningListPackingPDFGeneratorProps {
  groups: CommissioningListPackingPDFProps["groups"] | null;
  /** False while some of the groups' rows are still loading. */
  isReady?: boolean;
  year: number;
  week: number | null;
  dayName: string;
  showSize?: boolean;
  filename: string;
  buttonText: string;
  t: TFunction;
}

export default function CommissioningListPackingPDFGenerator({
  groups,
  isReady,
  year,
  week,
  dayName,
  showSize,
  filename,
  buttonText,
  t,
}: CommissioningListPackingPDFGeneratorProps) {
  return (
    <ListPDFGenerator
      // ``groups`` is already filtered to non-empty share options in the
      // page, so an empty array here means "nothing to export" — disabled.
      data={groups}
      isReady={isReady}
      filename={filename}
      buttonText={buttonText}
      documentLoader={() => import("./CommissioningListPackingPDF")}
      documentProps={{ groups: groups ?? [], year, week, dayName, showSize, t }}
    />
  );
}
