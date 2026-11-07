import type { TFunction } from "i18next";
import type { PackingModeEnum } from "@shared/api/generated/models";
import type { StationPageData, TenantInfo } from "./DeliveryStationDetailsPDF";
import ListPDFGenerator from "./ListPDFGenerator";

interface DeliveryStationDetailsPDFGeneratorProps {
  pages: StationPageData[] | null;
  packingMode: PackingModeEnum;
  tints: Record<string, number>;
  tenant: TenantInfo;
  filename: string;
  buttonText: string;
  t: TFunction;
}

export default function DeliveryStationDetailsPDFGenerator({
  pages,
  packingMode,
  tints,
  tenant,
  filename,
  buttonText,
  t,
}: DeliveryStationDetailsPDFGeneratorProps) {
  return (
    <ListPDFGenerator
      data={pages}
      isReady={pages !== null && pages.length > 0}
      filename={filename}
      buttonText={buttonText}
      documentLoader={() => import("./DeliveryStationDetailsPDF")}
      documentProps={{
        pages: pages ?? [],
        packingMode,
        tints,
        tenant,
        t,
      }}
    />
  );
}
