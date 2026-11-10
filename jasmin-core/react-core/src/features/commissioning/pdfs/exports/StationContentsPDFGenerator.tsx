import type { TFunction } from "i18next";
import type { StationContentsPage } from "@features/commissioning/utils/stationContents";
import ListPDFGenerator from "./ListPDFGenerator";
import type { TenantInfo } from "./ListPDFSharedComponents";

interface StationContentsPDFGeneratorProps {
  pages: StationContentsPage[] | null;
  tenant: TenantInfo;
  filename: string;
  buttonText: string;
  t: TFunction;
}

export default function StationContentsPDFGenerator({
  pages,
  tenant,
  filename,
  buttonText,
  t,
}: StationContentsPDFGeneratorProps) {
  return (
    <ListPDFGenerator
      data={pages}
      filename={filename}
      buttonText={buttonText}
      documentLoader={() => import("./StationContentsPDF")}
      documentProps={{ pages: pages ?? [], tenant, t }}
    />
  );
}
