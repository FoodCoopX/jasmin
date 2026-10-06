import { useTranslation } from "react-i18next";
import { useVegetableSizeOptions, useUnitOptions } from "@hooks/index";
import type { TableRecord } from "@shared/tables/BasicEditableTable/types";
import {
  MobileCard,
  MobileCardContent,
  MobileCardNote,
  MobileCardTags,
  MobileCardTitle,
} from "./primitives";
import { recordText } from "./recordText";
import { getSizeLabelOrEmpty } from "./sizeLabel";

interface ForecastMobileCardProps {
  record: TableRecord;
  /** Opens the row's edit dialog; absent where the row can't be edited. */
  onEdit?: (record: TableRecord) => void;
}

export function ForecastMobileCard({
  record,
  onEdit,
}: ForecastMobileCardProps) {
  const { t } = useTranslation();
  const { getVegetableSizeLabel } = useVegetableSizeOptions();
  const { getUnitLabel } = useUnitOptions();

  const articleName = recordText(record, "share_article_name");
  const sizeLabel = getSizeLabelOrEmpty(record.size as string, getVegetableSizeLabel);
  const amount = record.amount as number | null | undefined;
  const unitLabel = getUnitLabel(record.unit as string);
  const plotName = recordText(record, "plot_name");
  const bedNumber = record.bed_number as number | null | undefined;
  const noteText = recordText(record, "note");
  const isFinalized = !!record.is_finalized;

  const tags: string[] = [];
  if (record.for_all_harvest_shares) tags.push(t("commissioning.for_shares"));
  if (record.for_all_harvest_shares_fruit)
    tags.push(t("commissioning.for_fruit_shares"));
  if (record.for_all_resellers) tags.push(t("commissioning.for_resellers"));
  if (record.for_all_markets) tags.push(t("commissioning.for_all_markets"));

  const rightSlot =
    amount != null && amount > 0 ? (
      <span style={{ fontWeight: 600 }}>
        {amount} {unitLabel}
      </span>
    ) : null;

  return (
    <MobileCard onClick={onEdit && (() => onEdit(record))} finalized={isFinalized}>
      <MobileCardContent>
        <MobileCardTitle
          name={articleName}
          sizeLabel={sizeLabel}
          finalized={isFinalized}
          rightSlot={rightSlot}
        />
        {(plotName || bedNumber != null) && (
          <div className="text-meta">
            {plotName && (
              <>
                {t("commissioning.plot")}: {plotName}
              </>
            )}
            {plotName && bedNumber != null && ", "}
            {bedNumber != null && (
              <>
                {t("commissioning.bed_number")}: {bedNumber}
              </>
            )}
          </div>
        )}
        {noteText && (
          <MobileCardNote note={noteText} />
        )}
        <MobileCardTags tags={tags} />
      </MobileCardContent>
    </MobileCard>
  );
}
